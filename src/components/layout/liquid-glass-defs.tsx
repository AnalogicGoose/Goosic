import { useEffect, useRef } from "react";
import { isWindowsWebview } from "@/lib/platform";
import { useSettingsStore } from "@/lib/store/settings";
import { webGlassMaterialTokens } from "@/lib/themes";

const SVG_NS = "http://www.w3.org/2000/svg";
// Only the explicit Active=True material gets the WebView2 lens. Static
// glass is a separate Shadow -> Fill construction and never registers here.
const GLASS_SELECTOR = ".glass-material-interactive";
const LIQUID_GLASS_SURFACE_EVENT = "goosic:register-liquid-glass-surface";

// Figma Glass preset supplied by the product owner. Keep this as the single
// optics source of truth for players, menus, popovers, and dialogs.
export const FIGMA_GLASS_PRESET = {
  refraction: 70,
  depth: 30,
  dispersion: 20,
  splay: 20,
} as const;

const SMALL_GLASS_FROST_RATIO = 6 / 16;

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
// feImage stretches the vector field to the panel's exact dimensions, so
// Full-window rasters only waste memory. Bound map resolution and resize
// history: sixteen worst-case displacement maps total roughly
// 16 MiB of raw RGBA data before PNG compression.
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

function roundedRectSdf(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): number {
  const qx = Math.abs(x - width / 2) - (width / 2 - radius);
  const qy = Math.abs(y - height / 2) - (height / 2 - radius);
  // `Math.sqrt` of the sum of squares rather than `Math.hypot`: hypot guards
  // against intermediate overflow, which cannot happen for raster coordinates,
  // and it costs several times as much. This runs a few million times per map.
  const outerX = qx > 0 ? qx : 0;
  const outerY = qy > 0 ? qy : 0;
  const outer = Math.sqrt(outerX * outerX + outerY * outerY);
  return outer + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * Fraction of the panel's short side occupied by the lens band.
 *
 * The reference shader normalizes its SDF by `min(width, height)` and remaps
 * the inner 30% of that, so the band is *proportional* to the surface rather
 * than a fixed pixel depth. A constant band is what made a wide player bar and
 * a small menu look like different materials.
 */
const LENS_BAND = 0.3;

/**
 * Ceiling on the lens band, in CSS pixels. Without it a tall dialog gets a band
 * most of its height deep and never shows a flat middle; macOS keeps large
 * surfaces mostly flat with the optics confined to the rim.
 */
const MAX_LENS_BAND_PX = 34;

/**
 * Displacement texels per CSS pixel, and the ceiling on one map.
 *
 * The old uniform `min(1, 512/w, 512/h)` cap was the source of the visible
 * blocking: a 1200px-wide panel was described by a 512px-wide field, and
 * feImage stretched each texel back out to more than two CSS pixels. Resolution
 * now follows the display, and only a total-texel budget bounds it — a bound
 * large panels reach far later than a hard 512 did.
 */
const MAX_MAP_TEXELS = 1_400_000;

/**
 * One neutral displacement texel, packed little-endian as ABGR: r=g=b=128
 * (no offset on either axis) with an opaque alpha.
 */
const NEUTRAL_TEXEL = 0xff808080;

let scratchX: Float32Array = new Float32Array(0);
let scratchY: Float32Array = new Float32Array(0);

/** Grow-only scratch buffers for one map's traced vector field. */
function scratchFields(size: number): [Float32Array, Float32Array] {
  if (scratchX.length < size) {
    scratchX = new Float32Array(size);
    scratchY = new Float32Array(size);
  }
  return [scratchX, scratchY];
}

function displacementRasterScale(width: number, height: number): number {
  const ratio =
    typeof window === "undefined" ? 1 : (window.devicePixelRatio ?? 1);
  const density = Number.isFinite(ratio) ? Math.min(2, Math.max(1, ratio)) : 1;
  const budget = Math.sqrt(MAX_MAP_TEXELS / Math.max(1, width * height));
  return Math.max(0.5, Math.min(density, budget));
}

/**
 * Lens strength at a point, from its inset into the panel.
 *
 * `inset` is the SDF depth normalized by the panel's short side, so the band is
 * proportional to the surface. Returns 0 through the flat interior and rises to
 * 1 at the rim along a circular profile (`1 - sqrt(1 - d^2)`) — the same curve
 * used to describe a lens surface in optics, flat through the middle and
 * turning over sharply at the edge.
 */
export function lensDisplacementFactor(inset: number): number {
  const edgeness = 1 - Math.min(1, Math.max(0, inset / LENS_BAND));
  if (edgeness <= 0) return 0;
  return 1 - Math.sqrt(Math.max(0, 1 - edgeness * edgeness));
}

function createMaps(
  width: number,
  height: number,
  radius: number,
): MaterialMaps {
  // feImage scales this raster back to the exact CSS-pixel size. The radius is
  // scaled with it so the corner fillets stay circular while it does so.
  const rasterScale = displacementRasterScale(width, height);
  const rasterWidth = Math.max(2, Math.round(width * rasterScale));
  const rasterHeight = Math.max(2, Math.round(height * rasterScale));
  const rasterRadius = Math.max(1, radius * rasterScale);
  const halfWidth = rasterWidth / 2;
  const halfHeight = rasterHeight / 2;
  const shortSide = Math.min(rasterWidth, rasterHeight);
  // The lens band, in raster texels. Proportional to the surface so a chip and
  // a dialog read as the same material, but capped in absolute terms: past a
  // point a bigger panel means more flat glass in the middle, not a wider
  // bezel, which is what keeps a large surface's interior readable.
  const bandWidth = Math.max(
    2,
    Math.min(LENS_BAND * shortSide, MAX_LENS_BAND_PX * rasterScale),
  );

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
  // The interior is neutral by construction, so fill the whole buffer with the
  // neutral texel in one memset and only compute the rim. Writing 128/128/128
  // per channel plus an opaque alpha is a single 32-bit pattern, which lets a
  // 1.4M-texel map skip 1.4M iterations of per-channel assignment.
  new Uint32Array(displacementImage.data.buffer).fill(NEUTRAL_TEXEL);

  // Two passes: trace the vector field in floating point, then quantize it.
  // Quantizing per texel against a guessed peak is what produced visible steps
  // — the peak has to be known before anything is written to 8 bits.
  //
  // The buffers are reused across calls rather than allocated per map: at the
  // texel budget a fresh pair is ~11 MB that has to be allocated and zeroed
  // every time a surface resizes. The encode pass zeroes each entry as it
  // consumes it, so they are always handed back all-zero.
  const [fieldX, fieldY] = scratchFields(rasterWidth * rasterHeight);
  let peak = 0;

  // Only the band carries a displacement, and a texel can only be within
  // `bandWidth` of the boundary if it is within `bandWidth` of one of the four
  // sides. Walking the ring instead of the full raster is exact for a rounded
  // rectangle, and skips the SDF entirely across the interior — which is most
  // of a large panel.
  const ring = Math.ceil(bandWidth) + 2;
  const visitRow = (y: number, fromX: number, toX: number) => {
    for (let x = fromX; x < toX; x += 1) {
      const index = y * rasterWidth + x;
      let sumX = 0;
      let sumY = 0;

      // Supersample the field inside each texel. The profile turns over fastest
      // exactly at the rim, so one sample per texel aliases the steepest part
      // of the optic — the frost cannot recover detail the field never had, and
      // the result is the stair-stepped edge. Averaging a 2x2 grid antialiases
      // the vector field itself, before it is ever quantized.
      for (let sub = 0; sub < 4; sub += 1) {
        const sampleX = x + (sub % 2 === 0 ? 0.25 : 0.75);
        const sampleY = y + (sub < 2 ? 0.25 : 0.75);
        const distance = roundedRectSdf(
          sampleX,
          sampleY,
          rasterWidth,
          rasterHeight,
          rasterRadius,
        );
        if (distance >= 0) continue;

        // Inset expressed in bands: 0 at the rim, 1 at the inner edge of the
        // lens. Everything deeper is flat interior.
        const inset = (-distance / bandWidth) * LENS_BAND;
        const lens = lensDisplacementFactor(inset);
        if (lens <= 0) continue;

        // Direction: radial, but in *aspect-normalized* space. A plain radial
        // field from the centre is what the reference shader uses, and it is
        // continuous everywhere — unlike the SDF gradient, which is
        // axis-aligned along the straight runs and radial only inside the
        // corner fillets, so it breaks visibly at those four seams. But on a
        // wide surface a plain radial direction points sideways near the ends,
        // where the nearest edge is above or below; dividing by the
        // half-extents first makes the field elliptical, so it stays
        // perpendicular to whichever edge is actually close. On a square
        // surface the two are identical.
        const aspectX = (sampleX - halfWidth) / halfWidth;
        const aspectY = (sampleY - halfHeight) / halfHeight;
        const length = Math.sqrt(aspectX * aspectX + aspectY * aspectY) || 1;
        // Magnitude scales with the band, not with the panel. The reference
        // shader multiplies by `glassSize * 0.5`, which is fine for the 120x80
        // panel it demonstrates on but means up to 360px of shift on a 720px
        // player bar — the bezel folds through the middle and the bar pinches
        // into a bowtie. The band is the glass's physical thickness, and that
        // is what sets how far it can bend light.
        //
        // Negative: the rim samples from *inside* the panel, compressing the
        // interior into the bezel, which is what a lens does and what the
        // reference means by `fragCoord - offset`. Sampling outward instead
        // pulls in content from beyond the panel that matches nothing next to
        // it, and the mismatch reads as a hard line where the effect starts.
        sumX -= (lens * bandWidth * aspectX) / length;
        sumY -= (lens * bandWidth * aspectY) / length;
      }

      const displacementX = sumX / 4;
      const displacementY = sumY / 4;
      if (displacementX === 0 && displacementY === 0) continue;
      fieldX[index] = displacementX;
      fieldY[index] = displacementY;
      peak = Math.max(peak, Math.abs(displacementX), Math.abs(displacementY));
    }
  };

  const topRows = Math.min(ring, rasterHeight);
  const bottomStart = Math.max(topRows, rasterHeight - ring);
  for (let y = 0; y < topRows; y += 1) visitRow(y, 0, rasterWidth);
  for (let y = bottomStart; y < rasterHeight; y += 1)
    visitRow(y, 0, rasterWidth);
  // The middle rows only need their two ends.
  const sideWidth = Math.min(ring, rasterWidth);
  for (let y = topRows; y < bottomStart; y += 1) {
    visitRow(y, 0, sideWidth);
    if (rasterWidth - ring > sideWidth)
      visitRow(y, rasterWidth - ring, rasterWidth);
  }

  // An 8-bit channel gives 127 levels per direction, so a large panel's peak
  // displacement lands several CSS pixels apart per level. Ordered dithering
  // spreads that quantization error across neighbouring texels, which the
  // frost then averages out — without it the field bands into the visible
  // terraces the flat-contrast backdrop exposes.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const encode = (value: number, x: number, y: number): number => {
    if (peak <= 0) return 128;
    const dither = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
    return Math.min(
      255,
      Math.max(0, Math.round(128 + (value / peak) * 127 + dither)),
    );
  };

  // Only the band was traced, so only the band needs encoding — everything
  // else is already the neutral texel from the memset above.
  const encodeRow = (y: number, fromX: number, toX: number) => {
    for (let x = fromX; x < toX; x += 1) {
      const index = y * rasterWidth + x;
      const displacementX = fieldX[index];
      const displacementY = fieldY[index];
      if (displacementX === 0 && displacementY === 0) continue;
      fieldX[index] = 0;
      fieldY[index] = 0;
      const offset = index * 4;
      displacementImage.data[offset] = encode(displacementX, x, y);
      displacementImage.data[offset + 1] = encode(displacementY, x, y);
    }
  };
  for (let y = 0; y < topRows; y += 1) encodeRow(y, 0, rasterWidth);
  for (let y = bottomStart; y < rasterHeight; y += 1)
    encodeRow(y, 0, rasterWidth);
  for (let y = topRows; y < bottomStart; y += 1) {
    encodeRow(y, 0, sideWidth);
    if (rasterWidth - ring > sideWidth)
      encodeRow(y, rasterWidth - ring, rasterWidth);
  }

  displacementContext.putImageData(displacementImage, 0, 0);
  const maps = {
    displacement: displacementCanvas.toDataURL("image/png"),
    // The field is traced in raster texels; feImage stretches it back to the
    // panel's CSS size, so the peak converts with it.
    maximumDisplacement: peak / rasterScale,
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
): MaterialMaps {
  const cached = mapCache.get(key);
  if (cached) {
    // Refresh insertion order so the first entry remains the least used.
    mapCache.delete(key);
    mapCache.set(key, cached);
    return cached;
  }

  const maps = createMaps(width, height, radius);
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
  saturation: number,
): void {
  const filter = svgElement("filter");
  setAttributes(filter, {
    id,
    x: -blurLevel * 3,
    y: -blurLevel * 3,
    width: width + blurLevel * 6,
    height: height + blurLevel * 6,
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    colorInterpolationFilters: "sRGB",
  });
  const blur = svgElement("feGaussianBlur");
  setAttributes(blur, {
    in: "SourceGraphic",
    stdDeviation: blurLevel,
    result: "blurred_frost",
  });
  // Saturation is part of what distinguishes the two material families, not a
  // decoration: Liquid Glass keeps the backdrop's colour (slightly boosted),
  // while the Classic stops drain it toward neutral. Applied to the frosted
  // backdrop before displacement so the refracted rim carries the same colour
  // treatment as the panel interior.
  const saturate = svgElement("feColorMatrix");
  setAttributes(saturate, {
    in: "blurred_frost",
    type: "saturate",
    values: saturation,
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
  const baseScale = maps.maximumDisplacement * refractionLevel;
  const channelSplay =
    maps.maximumDisplacement *
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

  filter.append(blur, saturate, displacementImage);
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
  // The chosen material drives the shader's Gaussian blur: on macOS the id
  // names a real system material, and here it selects the frost that
  // synthesizes the same stop. Held in a ref so the observer effect (mounted
  // once) always reads the live value without being torn down and rebuilt.
  const glassMaterial = useSettingsStore((s) => s.glassMaterial);
  const { frost, saturation, refraction } =
    webGlassMaterialTokens(glassMaterial);
  const blurRef = useRef(frost);
  blurRef.current = frost;
  const saturationRef = useRef(saturation);
  saturationRef.current = saturation;
  const refractionRef = useRef(refraction);
  refractionRef.current = refraction;
  // Set by the observer effect; lets a material change force a re-measure of
  // every live glass panel so the new frost is baked into fresh filters.
  const remeasureAllRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    remeasureAllRef.current?.();
  }, [frost, saturation, refraction]);

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
      const refracts = refractionRef.current;
      const saturation = saturationRef.current;
      const geometry = `${isSmall ? "small" : "regular"}-${width}x${height}r${Math.round(radius)}b${blurLevel}s${saturation}${refracts ? "r" : "f"}`;
      if (registration.geometry === geometry) return;
      registration.geometry = geometry;

      // A Classic material is a frosted pane, not a lens: macOS gives it a
      // heavy blur and an opacity tint with no edge displacement. Resolving it
      // to a plain CSS backdrop filter is both the faithful rendering and the
      // cheap one — no displacement raster, no per-surface SVG filter, nothing
      // to invalidate on resize.
      if (!refracts) {
        const plain = `blur(${blurLevel}px) saturate(${saturation})`;
        element.style.setProperty("--liquid-glass-filter", plain);
        element.style.setProperty("backdrop-filter", plain);
        element.style.setProperty("-webkit-backdrop-filter", plain);
        element.dataset.liquidGlassReady = "true";
        if (registration.filterId) {
          defs.querySelector(`#${CSS.escape(registration.filterId)}`)?.remove();
          registration.filterId = null;
        }
        return;
      }
      // createConvexRefractionProfile already consumes Figma's 70% value;
      // applying another 0.7 multiplier would attenuate it twice.
      const refractionLevel = 1;
      // Raster maps stay cached in 8px buckets (feImage stretches them the
      // last few pixels), but the filter geometry itself is exact — a bucket
      // rounded below the panel size leaves an unmapped displacement strip.
      const key = geometryKey(width, height, radius);
      const [size, radiusPart] = key.split("r");
      const [mapWidth, mapHeight] = size.split("x").map(Number);
      const maps = getCachedMaps(key, mapWidth, mapHeight, Number(radiusPart));
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
        saturation,
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
