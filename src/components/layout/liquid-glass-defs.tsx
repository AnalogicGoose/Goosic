import { useEffect, useRef } from "react";
import {
  getGlassResolutionBudget,
  MAX_MAP_TEXELS,
  MIN_BEZEL_TEXELS,
  sourceBandLimitSigma,
  type GlassResolutionBudget,
} from "@/lib/glass-quality";
import { isWindowsWebview } from "@/lib/platform";
import { useSettingsStore } from "@/lib/store/settings";
import { clampGlassBlur } from "@/lib/themes";

const SVG_NS = "http://www.w3.org/2000/svg";
// Only the explicit Active=True material gets the WebView2 lens. Static
// glass is a separate Shadow -> Fill construction and never registers here.
const GLASS_SELECTOR = ".glass-material-interactive";
const LIQUID_GLASS_SURFACE_EVENT = "goosic:register-liquid-glass-surface";
const PROFILE_SAMPLES = 255;

// Figma Glass preset supplied by the product owner. Keep this as the single
// optics source of truth for players, menus, popovers, and dialogs.
export const FIGMA_GLASS_PRESET = {
  refraction: 70,
  depth: 30,
  dispersion: 20,
  splay: 20,
} as const;

const SMALL_GLASS_FROST_RATIO = 6 / 16;

/** Refractive index at full strength. Optical glass sits around 1.5. */
const GLASS_INDEX_RANGE = 0.72;
/**
 * Glass depth at full strength, as a multiple of the bezel width. The bevel
 * fillet occupies the top `1.0` of it; anything above that is the straight
 * sidewall, which deepens the bend without moving where it peaks.
 */
const GLASS_THICKNESS_RANGE = 0.25;
/**
 * Floor on d(source)/d(destination) across the bezel.
 *
 * The traced displacement wants to compress the backdrop harder than one
 * destination pixel per source pixel near the rim. Left alone that inverts the
 * sampled image — the derivative of `position + displacement` goes negative and
 * the bezel shows a mirrored sweep of the panel interior instead of a
 * compressed one. A real lens resolves that as a caustic; a single-sample
 * displacement map cannot, so the profile is limited to a 5:1 squeeze instead.
 */
const MIN_SAMPLE_SLOPE = 0.2;
/** Sub-samples per profile bin, so the near-vertical rim is area-averaged. */
const RIM_SUPERSAMPLES = 4;

type RefractionProfile = {
  /**
   * Displacement at each sample from the outer edge (index 0) to the inner end
   * of the bezel, as a fraction of `maximumDisplacement`.
   */
  normalized: Float32Array;
  /** Peak displacement, in bezel widths. Multiply by the bezel's CSS size. */
  maximumDisplacement: number;
};

type SurfaceRegistration = {
  frame: number | null;
  resizeObserver: ResizeObserver;
  filterId: string | null;
  geometry: string | null;
};

type MaterialMaps = {
  displacement: string;
  maximumDisplacement: number;
};

const mapCache = new Map<string, MaterialMaps>();
const MAX_CACHED_MAPS = 16;

/**
 * Lets a surface that mounts inside a fullscreen/portal layer request its
 * dimension-matched SVG filter directly. MutationObserver remains the normal
 * path for every other material surface.
 */
export function registerLiquidGlassSurface(element: HTMLElement): void {
  window.dispatchEvent(
    new CustomEvent<HTMLElement>(LIQUID_GLASS_SURFACE_EVENT, {
      detail: element,
    }),
  );
}

/** Height of the bevel fillet, 0 at the outer rim to 1 at the flat top. */
function convexSquircle(x: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  return Math.pow(1 - Math.pow(1 - clamped, 4), 0.25);
}

/** Analytic slope of `convexSquircle`; diverges at the rim, zero at the top. */
function convexSquircleSlope(x: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  const inverse = 1 - clamped;
  const base = 1 - Math.pow(inverse, 4);
  if (base <= 0) return Number.POSITIVE_INFINITY;
  return Math.pow(inverse, 3) / Math.pow(base, 0.75);
}

/**
 * Unpolarized Fresnel transmittance for an air -> glass interface. At the rim
 * the bevel is close to vertical, the ray hits it at grazing incidence, and
 * almost all of the light reflects rather than refracts. Weighting by
 * transmittance is what rolls the displacement off to nothing at the boundary,
 * instead of the singularity an unweighted trace produces there.
 */
function fresnelTransmittance(
  cosIncidence: number,
  refractiveIndex: number,
): number {
  const eta = 1 / refractiveIndex;
  const k = 1 - eta * eta * (1 - cosIncidence * cosIncidence);
  if (k <= 0) return 0;
  const cosRefracted = Math.sqrt(k);
  const sPolarized =
    (cosIncidence - refractiveIndex * cosRefracted) /
    (cosIncidence + refractiveIndex * cosRefracted);
  const pPolarized =
    (refractiveIndex * cosIncidence - cosRefracted) /
    (refractiveIndex * cosIncidence + cosRefracted);
  return 1 - (sPolarized * sPolarized + pPolarized * pPolarized) / 2;
}

/**
 * Lateral distance, in bezel widths, that an orthogonal viewing ray travels
 * sideways between entering the bevel at `position` and reaching the backdrop
 * under the glass. Positive means inward: the bezel shows backdrop from
 * further inside the panel, which is what makes the rim read as a lens.
 *
 * The glass depth under the entry point varies with the bevel height, so the
 * shift vanishes at both ends of the band — a constant depth instead puts the
 * entire displacement into the outermost texel, where the surface normal is
 * near-horizontal and the trace diverges.
 */
function traceBevelRay(
  position: number,
  refractiveIndex: number,
  thicknessRatio: number,
): number {
  if (position <= 0) return 0;
  const depth = thicknessRatio - 1 + convexSquircle(position);
  const slope = convexSquircleSlope(position);
  if (!Number.isFinite(slope)) return 0;
  const length = Math.hypot(slope, 1);
  // Surface normal of the bevel: up and outward, so the refracted ray tilts
  // inward and the sampled backdrop is pulled toward the panel centre.
  const normalX = -slope / length;
  const normalY = 1 / length;
  const cosIncidence = normalY;
  const eta = 1 / refractiveIndex;
  const k = 1 - eta * eta * (1 - cosIncidence * cosIncidence);
  if (k <= 0) return 0;
  const coefficient = eta * cosIncidence - Math.sqrt(k);
  const rayX = coefficient * normalX;
  const rayY = coefficient * normalY - eta;
  if (rayY >= 0) return 0;
  const lateral = depth * (rayX / -rayY);
  return lateral * fresnelTransmittance(cosIncidence, refractiveIndex);
}

/**
 * Trace one radial slice of the bevel into a displacement profile for the
 * 8-bit SVG map: sample positions from the outer rim inward, area-average the
 * rim where the trace changes fastest, then limit the result so the sampled
 * backdrop compresses without folding over on itself.
 */
export function createConvexRefractionProfile(
  refraction: number = FIGMA_GLASS_PRESET.refraction,
): RefractionProfile {
  const strength = Math.min(100, Math.max(0, refraction)) / 100;
  const refractiveIndex = 1 + strength * GLASS_INDEX_RANGE;
  const thicknessRatio = 1 + strength * GLASS_THICKNESS_RANGE;
  const step = 1 / PROFILE_SAMPLES;

  const traced = new Float64Array(PROFILE_SAMPLES + 1);
  for (let i = 0; i <= PROFILE_SAMPLES; i += 1) {
    let total = 0;
    for (let sub = 0; sub < RIM_SUPERSAMPLES; sub += 1) {
      const offset = (sub + 0.5) / RIM_SUPERSAMPLES - 0.5;
      const position = Math.min(1, Math.max(0, (i + offset) * step));
      total += traceBevelRay(position, refractiveIndex, thicknessRatio);
    }
    traced[i] = Math.max(0, total / RIM_SUPERSAMPLES);
  }

  // `source[i]` is the bezel position that destination sample `i` reads from.
  // Sweeping inward-to-outward with a floor on the step keeps that mapping
  // strictly increasing, so the refracted image can never reverse direction.
  const source = new Float64Array(PROFILE_SAMPLES + 1);
  source[PROFILE_SAMPLES] = 1;
  for (let i = PROFILE_SAMPLES - 1; i >= 0; i -= 1) {
    const destination = i * step;
    source[i] = Math.max(
      destination,
      Math.min(
        destination + traced[i],
        source[i + 1] - MIN_SAMPLE_SLOPE * step,
      ),
    );
  }

  const normalized = new Float32Array(PROFILE_SAMPLES + 1);
  let maximumDisplacement = 0;
  for (let i = 0; i <= PROFILE_SAMPLES; i += 1) {
    const displacement = source[i] - i * step;
    normalized[i] = displacement;
    maximumDisplacement = Math.max(maximumDisplacement, displacement);
  }
  if (maximumDisplacement > 0) {
    for (let i = 0; i <= PROFILE_SAMPLES; i += 1) {
      normalized[i] /= maximumDisplacement;
    }
  }
  return { normalized, maximumDisplacement };
}

type SurfaceSample = {
  /** Signed distance to the rounded-rect boundary; negative inside. */
  distance: number;
  /** Unit outward normal of the boundary at this point. */
  normalX: number;
  normalY: number;
};

/**
 * Signed distance and exact outward normal of a rounded rectangle.
 *
 * The normal is analytic rather than a finite difference of the distance
 * field: inside the corner fillet it is radial, along the straight runs it is
 * axis-aligned, and it stays exact right up to the boundary. A central
 * difference blurs the two regimes into each other across its sample width,
 * which is what bent the displacement the wrong way in the corners.
 */
function roundedRectSdf(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): SurfaceSample {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const offsetX = x - halfWidth;
  const offsetY = y - halfHeight;
  const signX = offsetX < 0 ? -1 : 1;
  const signY = offsetY < 0 ? -1 : 1;
  const qx = Math.abs(offsetX) - (halfWidth - radius);
  const qy = Math.abs(offsetY) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const distance = outside + Math.min(Math.max(qx, qy), 0) - radius;

  if (qx > 0 && qy > 0) {
    const length = outside || 1;
    return {
      distance,
      normalX: (signX * qx) / length,
      normalY: (signY * qy) / length,
    };
  }
  if (qx > qy) return { distance, normalX: signX, normalY: 0 };
  return { distance, normalX: 0, normalY: signY };
}

function sampleProfile(profile: Float32Array, x: number): number {
  const position = Math.min(1, Math.max(0, x)) * PROFILE_SAMPLES;
  const lower = Math.floor(position);
  const upper = Math.min(PROFILE_SAMPLES, lower + 1);
  const mix = position - lower;
  return profile[lower] * (1 - mix) + profile[upper] * mix;
}

/**
 * Box-average the profile over one texel's worth of the bezel. The traced
 * displacement climbs from nothing to its peak within the first texel or two,
 * so point-sampling it lands somewhere arbitrary on that ramp and leaves a
 * one-texel ring that neither feImage's interpolation nor the frost can hide.
 */
function sampleProfileFiltered(
  profile: Float32Array,
  x: number,
  texelWidth: number,
): number {
  const offset = texelWidth / 3;
  return (
    (sampleProfile(profile, x - offset) +
      sampleProfile(profile, x) +
      sampleProfile(profile, x + offset)) /
    3
  );
}

/**
 * Texels per CSS pixel for one surface's displacement field.
 *
 * Resolution is driven by the bezel, not by the panel: the field is flat
 * everywhere except the band the bezel occupies, so a wide player bar needs no
 * more texels across its length than a menu does, but it needs just as many
 * across its 30px edge. The bezel floor therefore outranks the texel budget —
 * this is the resolution the user asked never to be traded for performance.
 */
export function displacementRasterScale(
  width: number,
  height: number,
  bezelWidth: number,
  requested: number,
): number {
  const budgeted = Math.sqrt(MAX_MAP_TEXELS / Math.max(1, width * height));
  const bezelFloor = MIN_BEZEL_TEXELS / Math.max(1, bezelWidth);
  return Math.min(
    requested,
    Math.max(Math.min(requested, budgeted), bezelFloor),
  );
}

function createMaps(
  width: number,
  height: number,
  radius: number,
  budget: GlassResolutionBudget,
): MaterialMaps {
  // The bezel is a fixed CSS-pixel band, narrowed only when the panel is too
  // small to contain it. Its width in CSS pixels sets the physical scale of
  // the whole optic, so it is resolved before any rasterization decision.
  const bezelWidth = Math.max(
    1,
    Math.min(FIGMA_GLASS_PRESET.depth, Math.min(width, height) / 2 - 1),
  );
  // feImage stretches this raster back to the panel's exact CSS size; a
  // uniform scale keeps the corner fillets circular while it does so.
  const rasterScale = displacementRasterScale(
    width,
    height,
    bezelWidth,
    budget.displacementScale,
  );
  const rasterWidth = Math.max(2, Math.round(width * rasterScale));
  const rasterHeight = Math.max(2, Math.round(height * rasterScale));
  const rasterRadius = Math.max(1, radius * rasterScale);
  const rasterBezel = Math.max(1, bezelWidth * rasterScale);
  const texelWidth = 1 / rasterBezel;
  const profile = createConvexRefractionProfile();

  const displacementCanvas = document.createElement("canvas");
  displacementCanvas.width = rasterWidth;
  displacementCanvas.height = rasterHeight;
  const displacementContext = displacementCanvas.getContext("2d");
  if (!displacementContext) {
    throw new Error("Canvas 2D is unavailable for Liquid Glass maps");
  }
  const displacementImage = displacementContext.createImageData(
    rasterWidth,
    rasterHeight,
  );

  for (let y = 0; y < rasterHeight; y += 1) {
    for (let x = 0; x < rasterWidth; x += 1) {
      const offset = (y * rasterWidth + x) * 4;
      const surface = roundedRectSdf(
        x + 0.5,
        y + 0.5,
        rasterWidth,
        rasterHeight,
        rasterRadius,
      );
      const distanceFromEdge = -surface.distance;
      let red = 128;
      let green = 128;

      if (distanceFromEdge >= 0 && distanceFromEdge < rasterBezel) {
        const magnitude = sampleProfileFiltered(
          profile.normalized,
          distanceFromEdge / rasterBezel,
          texelWidth,
        );
        // feDisplacementMap reads the channel as `value/255 - 0.5`, so the
        // neutral point sits half a level above 127.5. Encoding around 127.5
        // and rounding keeps the flat interior at a true zero offset.
        red = Math.round(127.5 - surface.normalX * magnitude * 127.5);
        green = Math.round(127.5 - surface.normalY * magnitude * 127.5);
      }

      displacementImage.data[offset] = red;
      displacementImage.data[offset + 1] = green;
      displacementImage.data[offset + 2] = 128;
      displacementImage.data[offset + 3] = 255;
    }
  }

  displacementContext.putImageData(displacementImage, 0, 0);
  const maps = {
    displacement: displacementCanvas.toDataURL("image/png"),
    // The profile is expressed in bezel widths, so the optic scales with the
    // CSS-pixel bezel and not with whatever resolution the raster landed on.
    maximumDisplacement: profile.maximumDisplacement * bezelWidth,
  };
  // Release the temporary backing store now instead of waiting for renderer
  // GC after every resize or newly opened glass surface.
  displacementCanvas.width = 1;
  displacementCanvas.height = 1;
  return maps;
}

function getCachedMaps(
  key: string,
  width: number,
  height: number,
  radius: number,
  budget: GlassResolutionBudget,
): MaterialMaps {
  const cached = mapCache.get(key);
  if (cached) {
    // Refresh insertion order so the first entry remains the least used.
    mapCache.delete(key);
    mapCache.set(key, cached);
    return cached;
  }

  const maps = createMaps(width, height, radius, budget);
  mapCache.set(key, maps);
  while (mapCache.size > MAX_CACHED_MAPS) {
    const oldestKey = mapCache.keys().next().value;
    if (oldestKey === undefined) break;
    mapCache.delete(oldestKey);
  }
  return maps;
}

function svgElement(name: string): SVGElement {
  return document.createElementNS(SVG_NS, name);
}

function setAttributes(
  element: Element,
  attributes: Record<string, string | number>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
}

function appendFilter(
  defs: SVGDefsElement,
  id: string,
  width: number,
  height: number,
  maps: MaterialMaps,
  blurLevel: number,
  refractionLevel: number,
  budget: GlassResolutionBudget,
): void {
  const maximumDisplacement = maps.maximumDisplacement * refractionLevel;
  // Backdrop sampled below full resolution is realised as the band-limit that
  // the resample would have applied. Gaussians compose, so it folds into the
  // frost instead of costing a second blur pass.
  const frost = Math.hypot(blurLevel, sourceBandLimitSigma(budget.sourceScale));
  // The region has to cover both what the frost reaches for and what the
  // refraction reaches for. Anything a displaced sample lands on outside it
  // reads as transparent black, which is what turned the player bar's bottom
  // bezel into a hard inverted band.
  const margin = Math.ceil(
    Math.max(frost * 3 * budget.blurScale, maximumDisplacement + frost),
  );
  const filter = svgElement("filter");
  setAttributes(filter, {
    id,
    x: -margin,
    y: -margin,
    width: width + margin * 2,
    height: height + margin * 2,
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    colorInterpolationFilters: "sRGB",
  });
  const blur = svgElement("feGaussianBlur");
  setAttributes(blur, {
    in: "SourceGraphic",
    stdDeviation: frost,
    result: "blurred_source",
  });
  // Both maps overdraw the panel by 1px per side: layout sizes can be
  // fractional while offsetWidth/Height round down, and any backdrop pixel
  // left outside the displacement map is treated as (0,0) — a huge negative
  // displacement that renders as a hard garbage seam.
  const displacementImage = svgElement("feImage");
  setAttributes(displacementImage, {
    href: maps.displacement,
    x: -1,
    y: -1,
    width: width + 2,
    height: height + 2,
    preserveAspectRatio: "none",
    result: "displacement_map",
  });
  // feDisplacementMap offsets by `scale * (channel/255 - 0.5)`, so a channel
  // at either extreme moves the sample by half the scale. Deriving the scale
  // from the peak displacement — rather than using it as the scale directly —
  // is what keeps one 8-bit level worth well under a pixel: at the default
  // preset a level is ~0.09px, where it used to be ~2px and every gradient in
  // the map showed up as a visible step.
  const baseScale = maximumDisplacement * 2;
  const channelSplay =
    baseScale *
    (FIGMA_GLASS_PRESET.dispersion / 100) *
    (FIGMA_GLASS_PRESET.splay / 100);

  // Figma exposes dispersion and splay as separate Glass-effect values. SVG
  // has no native chromatic-dispersion primitive, so the faithful web
  // equivalent is three copies of the same refracted backdrop with slightly
  // separated displacement scales, then recombine their RGB channels.
  const appendChannel = (
    channel: "red" | "green" | "blue",
    scale: number,
    matrix: string,
  ) => {
    const displaced = svgElement("feDisplacementMap");
    setAttributes(displaced, {
      in: "blurred_source",
      in2: "displacement_map",
      scale,
      xChannelSelector: "R",
      yChannelSelector: "G",
      result: `${channel}_displaced`,
    });
    const isolate = svgElement("feColorMatrix");
    setAttributes(isolate, {
      in: `${channel}_displaced`,
      type: "matrix",
      values: matrix,
      result: `${channel}_channel`,
    });
    filter.append(displaced, isolate);
  };

  filter.append(blur, displacementImage);
  appendChannel(
    "red",
    baseScale + channelSplay,
    "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  );
  appendChannel(
    "green",
    baseScale,
    "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  );
  appendChannel(
    "blue",
    Math.max(0, baseScale - channelSplay),
    "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
  );
  const redGreen = svgElement("feBlend");
  setAttributes(redGreen, {
    in: "red_channel",
    in2: "green_channel",
    mode: "screen",
    result: "red_green",
  });
  const dispersed = svgElement("feBlend");
  setAttributes(dispersed, {
    in: "red_green",
    in2: "blue_channel",
    mode: "screen",
    result: "dispersed",
  });
  filter.append(redGreen, dispersed);
  defs.append(filter);
}

function geometryKey(width: number, height: number, radius: number): string {
  // Buckets avoid regenerating hundreds of near-identical raster maps during
  // resize; the maps are stretched by feImage to each panel's exact size.
  return `${Math.max(8, Math.round(width / 8) * 8)}x${Math.max(8, Math.round(height / 8) * 8)}r${Math.max(1, Math.round(radius))}`;
}

/**
 * Invisible SVG host plus a Windows-only observer. Every glass panel receives
 * a filter generated for its measured dimensions; fixed filter images do not
 * resize automatically when used as Chromium backdrop filters.
 */
export function LiquidGlassDefs() {
  const defsRef = useRef<SVGDefsElement>(null);
  // The Glass-blur slider drives the shader's Gaussian blur. Held in a ref so
  // the observer effect (mounted once) always reads the live value without
  // being torn down and rebuilt on every slider tick.
  const glassBlur = useSettingsStore((s) => s.glassBlur);
  const blurRef = useRef(glassBlur);
  blurRef.current = clampGlassBlur(glassBlur);
  // Set by the observer effect; lets the slider force a re-measure of every
  // live glass panel so the new blur is baked into fresh per-surface filters.
  const remeasureAllRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    remeasureAllRef.current?.();
  }, [glassBlur]);

  useEffect(() => {
    if (!isWindowsWebview() || !defsRef.current) return;
    const defs = defsRef.current;
    const registrations = new Map<HTMLElement, SurfaceRegistration>();

    let filterSequence = 0;

    const measure = (element: HTMLElement) => {
      const registration = registrations.get(element);
      if (!registration) return;
      registration.frame = null;
      // Layout size, never getBoundingClientRect(): menus and popovers mount
      // mid `zoom-in-95` enter animation, and a transformed rect bakes that
      // shrunken scale into the filter geometry — the maps end short of the
      // panel's real edges and the glass shows a hard seam. offsetWidth/Height
      // ignore transforms, and the ResizeObserver re-measures real layout
      // changes.
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (width < 2 || height < 2) return;
      const computed = getComputedStyle(element);
      const radius = Math.min(
        Math.max(1, Number.parseFloat(computed.borderTopLeftRadius) || 34),
        width / 2,
        height / 2,
      );
      const isSmall = element.classList.contains("glass-material-small");
      // Figma uses a 6px frost radius for small controls and 16px for both
      // medium and large panels. Preserve that ratio when the shared slider
      // changes the regular radius.
      const blurLevel =
        blurRef.current * (isSmall ? SMALL_GLASS_FROST_RATIO : 1);
      const geometry = `${isSmall ? "small" : "regular"}-${width}x${height}r${Math.round(radius)}b${blurLevel}`;
      if (registration.geometry === geometry) return;
      registration.geometry = geometry;
      // createConvexRefractionProfile already consumes Figma's 70% value;
      // applying another 0.7 multiplier would attenuate it twice.
      const refractionLevel = 1;
      const budget = getGlassResolutionBudget();
      // Raster maps stay cached in 8px buckets (feImage stretches them the
      // last few pixels), but the filter geometry itself is exact — a bucket
      // rounded below the panel size leaves an unmapped displacement strip.
      const geometryPart = geometryKey(width, height, radius);
      const [size, radiusPart] = geometryPart.split("r");
      const [mapWidth, mapHeight] = size.split("x").map(Number);
      // Displacement texel density is part of the raster's identity: a cached
      // map from another density describes the same bezel at the wrong
      // resolution.
      const key = `${geometryPart}d${budget.displacementScale}`;
      const maps = getCachedMaps(
        key,
        mapWidth,
        mapHeight,
        Number(radiusPart),
        budget,
      );
      // Fresh id per geometry change: swapping the url() reference is the
      // repaint signal Chromium reliably honors for backdrop filters. The
      // superseded per-surface filter is dropped right after, so defs holds
      // one filter per live glass panel even through continuous resizes.
      filterSequence += 1;
      const id = `liquid-glass-s${filterSequence}`;
      appendFilter(
        defs,
        id,
        width,
        height,
        maps,
        blurLevel,
        refractionLevel,
        budget,
      );
      const filterValue = `url("#${id}")`;
      element.style.setProperty("--liquid-glass-filter", filterValue);
      // WebView2 can stop resolving a custom-property-backed backdrop filter
      // when a fullscreen scroll compositor is swapped in. Write the exact
      // generated SVG URL to the real properties as well so Queue cannot
      // silently fall back to `none`.
      element.style.setProperty("backdrop-filter", filterValue);
      element.style.setProperty("-webkit-backdrop-filter", filterValue);
      element.dataset.liquidGlassReady = "true";
      if (registration.filterId) {
        defs.querySelector(`#${CSS.escape(registration.filterId)}`)?.remove();
      }
      registration.filterId = id;
    };

    const scheduleMeasure = (element: HTMLElement) => {
      const registration = registrations.get(element);
      if (!registration || registration.frame !== null) return;
      registration.frame = requestAnimationFrame(() => measure(element));
    };
    const register = (element: HTMLElement) => {
      if (registrations.has(element)) return;
      const resizeObserver = new ResizeObserver(() => scheduleMeasure(element));
      registrations.set(element, {
        frame: null,
        resizeObserver,
        filterId: null,
        geometry: null,
      });
      resizeObserver.observe(element);
      scheduleMeasure(element);
    };
    const unregister = (element: HTMLElement) => {
      const registration = registrations.get(element);
      if (!registration) return;
      registration.resizeObserver.disconnect();
      if (registration.frame !== null) cancelAnimationFrame(registration.frame);
      if (registration.filterId) {
        defs.querySelector(`#${CSS.escape(registration.filterId)}`)?.remove();
      }
      element.style.removeProperty("--liquid-glass-filter");
      element.style.removeProperty("backdrop-filter");
      element.style.removeProperty("-webkit-backdrop-filter");
      delete element.dataset.liquidGlassReady;
      registrations.delete(element);
    };
    const scan = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(GLASS_SELECTOR)) register(node as HTMLElement);
      node
        .querySelectorAll<HTMLElement>(GLASS_SELECTOR)
        .forEach((element) => register(element));
    };
    const unscan = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(GLASS_SELECTOR)) unregister(node as HTMLElement);
      node
        .querySelectorAll<HTMLElement>(GLASS_SELECTOR)
        .forEach((element) => unregister(element));
    };

    scan(document.body);

    const registerRequestedSurface = (event: Event) => {
      const element = (event as CustomEvent<HTMLElement>).detail;
      if (!(element instanceof HTMLElement) || !element.matches(GLASS_SELECTOR))
        return;
      const registration = registrations.get(element);
      if (registration) {
        // Queue swaps a large compositing subtree below fullscreen controls.
        // Chromium can drop an unchanged backdrop-filter during that swap, so
        // force a new SVG filter id whenever this surface requests one.
        registration.geometry = null;
        scheduleMeasure(element);
        return;
      }
      register(element);
    };
    window.addEventListener(
      LIQUID_GLASS_SURFACE_EVENT,
      registerRequestedSurface,
    );

    // Re-run every live surface's measurement (geometry reset forces a fresh
    // filter) so a Glass-blur slider change repaints the shader immediately.
    remeasureAllRef.current = () => {
      for (const [element, registration] of registrations) {
        registration.geometry = null;
        scheduleMeasure(element);
      }
    };

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(scan);
        mutation.removedNodes.forEach(unscan);
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      remeasureAllRef.current = null;
      mutationObserver.disconnect();
      window.removeEventListener(
        LIQUID_GLASS_SURFACE_EVENT,
        registerRequestedSurface,
      );
      for (const [element, registration] of registrations) {
        registration.resizeObserver.disconnect();
        if (registration.frame !== null)
          cancelAnimationFrame(registration.frame);
        if (registration.filterId) {
          defs.querySelector(`#${CSS.escape(registration.filterId)}`)?.remove();
        }
        element.style.removeProperty("--liquid-glass-filter");
        element.style.removeProperty("backdrop-filter");
        element.style.removeProperty("-webkit-backdrop-filter");
        delete element.dataset.liquidGlassReady;
      }
      registrations.clear();
    };
  }, []);

  if (!isWindowsWebview()) return null;
  return (
    <svg
      width="0"
      height="0"
      aria-hidden
      className="pointer-events-none absolute"
      colorInterpolationFilters="sRGB"
    >
      <defs ref={defsRef} />
    </svg>
  );
}
