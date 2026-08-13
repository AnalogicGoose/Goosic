import { useEffect, useRef } from "react";
import { isWindowsWebview } from "@/lib/platform";
import { useSettingsStore } from "@/lib/store/settings";
import { webGlassMaterialTokens, type GlassLensTokens } from "@/lib/themes";

const SVG_NS = "http://www.w3.org/2000/svg";
// Only the explicit Active=True material gets the WebView2 lens. Static
// glass is a separate Shadow -> Fill construction and never registers here.
const GLASS_SELECTOR = ".glass-material-interactive";
const LIQUID_GLASS_SURFACE_EVENT = "goosic:register-liquid-glass-surface";
const AIR_REFRACTIVE_INDEX = 1;
const PROFILE_SAMPLES = 127;
export const WINDOWS_UI_SUPERELLIPSE_K = 1;

// Figma Glass preset supplied by the product owner. Keep this as the single
// optics source of truth for players, menus, popovers, and dialogs.
export const FIGMA_GLASS_PRESET = {
  refraction: 30,
  depth: 20,
  dispersion: 20,
  splay: 20,
} as const;

/**
 * Which stages average colour in linear light rather than gamma-encoded sRGB.
 *
 * SVG filters default to `linearRGB`; this pipeline overrides everything to
 * `sRGB`, which is correct for the displacement and specular stages because
 * those maps carry *data* — a map's channel values are vectors, and a gamma
 * transform corrupts them. It is not obviously correct for the stages that
 * average real colour.
 *
 * Averaging gamma-encoded values averages encoded numbers rather than light,
 * which darkens midtones and desaturates, so the backdrop bleeds through grey
 * and flat. Apple composites its materials in linear light via CoreAnimation,
 * which is why more of the artwork's colour survives the same nominal blur.
 *
 *  - `srgb`  production baseline; nothing opts out.
 *  - `frost` blur and the saturation that follows it only.
 *  - `full`  the above plus the colour blends that recombine and paint the
 *            material. The map stages stay sRGB in every mode.
 *
 * A real perceptual change: it shifts every colour calibrated against the sRGB
 * result, so it is a deliberate switch rather than a default.
 */
export type GlassColorSpaceMode = "srgb" | "frost" | "full";

/**
 * Refraction reads the *unblurred* backdrop and is confined to the bezel.
 *
 * Production refracts an already-frosted texture, so the lens has no
 * high-frequency detail left to bend. Feeding it the raw backdrop restores that,
 * but only if the contribution is spatially weighted: a controlled test mixing
 * the sharp branch uniformly at 50% dissolved the frost entirely and the surface
 * read as a tinted transparent overlay rather than glass.
 *
 * So the body stays frost-dominated and the refracted branch is masked to the
 * bezel, giving centre = frost, bezel = frost + refraction, extreme edge =
 * strongest displacement and chromatic separation.
 */

/* -------------------------------------------------------------------------- */
/* Renderer variant selector                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The four renderer configurations under comparison. One switch, so a variant
 * can be changed in a single place instead of keeping two flags in sync.
 *
 *   A  production baseline — sRGB, refraction bends the already-frosted texture
 *   B  frost-only linearRGB — blur and its saturation in linear light
 *   C  full linearRGB + bezel-masked refraction of the raw backdrop
 *   D  sRGB + bezel-masked refraction — isolates architecture from colour space
 *
 * B and D exist to separate the two contributions: if C wins, D says whether it
 * was the pass architecture and B says whether it was the colour space.
 */
export type GlassRendererVariant =
  | "A"
  | "B"
  | "C"
  | "D"
  | "D0"
  | "D1"
  | "D2"
  | "D3";

type GlassVariantConfig = {
  colorSpace: GlassColorSpaceMode;
  bezel: boolean;
  /**
   * Pre-blur on the refraction branch, as a fraction of the frost radius.
   *
   * 0 samples the raw backdrop, which reads as a sharp copy of the background
   * pasted into the bezel. Native refraction carries more spatial information
   * than the frost body but is still inside the same material, so the branch
   * wants a light low-pass — less than the frost, more than nothing. Expressed
   * against the frost radius so it scales with the material rather than being
   * an absolute that only suits one stop.
   */
  preBlur: number;
  /**
   * Low-frequency colour wash, 0-100. 0 disables the branch entirely.
   *
   * Broad background colour bleeding into the material is what gives native
   * glass its dirty, smoky character. Deliberately not more grey opacity —
   * that is what washed Windows out in the first place. This carries colour
   * only.
   */
  wash: number;
};

const GLASS_VARIANTS: Record<GlassRendererVariant, GlassVariantConfig> = {
  A: { colorSpace: "srgb", bezel: false, preBlur: 0, wash: 0 },
  B: { colorSpace: "frost", bezel: false, preBlur: 0, wash: 0 },
  C: { colorSpace: "full", bezel: true, preBlur: 0, wash: 0 },
  // D is the experimental baseline; D0 is the same thing under its test name.
  D: { colorSpace: "srgb", bezel: true, preBlur: 0, wash: 0 },
  D0: { colorSpace: "srgb", bezel: true, preBlur: 0, wash: 0 },
  D1: { colorSpace: "srgb", bezel: true, preBlur: 0.25, wash: 0 },
  D2: { colorSpace: "srgb", bezel: true, preBlur: 0.5, wash: 0 },
  // Pairs the lighter pre-blur with the wash. Swap in D2's ratio here once the
  // D1/D2 comparison settles which softening is right.
  D3: { colorSpace: "srgb", bezel: true, preBlur: 0.25, wash: 18 },
};

/**
 * Extra blur for the colour-wash branch, in CSS pixels on top of the frost it
 * already carries. Large on purpose: the branch exists to survive only broad
 * colour regions, and it reuses the frost intermediate rather than re-reading
 * the backdrop, so the radii compose instead of costing a second full chain.
 *
 * EXPERIMENTAL — not an Apple/Figma value.
 */
export const GLASS_COLOR_WASH_BLUR = 24;

/**
 * Pinned variant, used when the dev selector is unavailable — a packaged build,
 * or any non-DEV bundle. Edit this one line to bake a variant into a release.
 */
const GLASS_VARIANT_DEFAULT: GlassRendererVariant = "A";

const GLASS_VARIANT_KEY = "goosic:glass-variant";

/**
 * Dev-only runtime override, mirroring the platform override in
 * `src/lib/platform.ts`. Switching renderers by editing source means a rebuild,
 * and HMR does not reliably rebuild glass filters, so the comparison is driven
 * by URL instead:
 *
 *   ?glass=C     select and persist a variant
 *   ?glass=auto  clear the override
 *
 * The choice persists in localStorage, so every subsequent reload keeps it and
 * the URL itself records which variant produced a screenshot. Never consulted
 * in a production build.
 */
function readGlassVariant(): GlassRendererVariant | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const isVariant = (v: string | null): v is GlassRendererVariant =>
    v !== null && Object.prototype.hasOwnProperty.call(GLASS_VARIANTS, v);
  try {
    const requested = new URLSearchParams(window.location.search)
      .get("glass")
      ?.toUpperCase();
    if (requested === "AUTO") {
      window.localStorage.removeItem(GLASS_VARIANT_KEY);
      return null;
    }
    if (isVariant(requested ?? null)) {
      window.localStorage.setItem(GLASS_VARIANT_KEY, requested as string);
      return requested as GlassRendererVariant;
    }
    const stored = window.localStorage.getItem(GLASS_VARIANT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

export const GLASS_RENDERER_VARIANT: GlassRendererVariant =
  readGlassVariant() ?? GLASS_VARIANT_DEFAULT;

export const GLASS_COLOR_SPACE_MODE: GlassColorSpaceMode =
  GLASS_VARIANTS[GLASS_RENDERER_VARIANT].colorSpace;
export const GLASS_BEZEL_REFRACTION: boolean =
  GLASS_VARIANTS[GLASS_RENDERER_VARIANT].bezel;
export const GLASS_REFRACTION_PREBLUR_RATIO: number =
  GLASS_VARIANTS[GLASS_RENDERER_VARIANT].preBlur;
export const GLASS_COLOR_WASH_STRENGTH: number =
  GLASS_VARIANTS[GLASS_RENDERER_VARIANT].wash;

if (import.meta.env.DEV && typeof window !== "undefined") {
  // Printed so a screenshot can always be traced back to a configuration.
  console.info(
    `[glass] variant ${GLASS_RENDERER_VARIANT} — colour space: ${GLASS_COLOR_SPACE_MODE}, bezel: ${GLASS_BEZEL_REFRACTION}, refraction pre-blur: ${GLASS_REFRACTION_PREBLUR_RATIO}x frost, colour wash: ${GLASS_COLOR_WASH_STRENGTH}`,
  );
}

/**
 * Hardening curve applied to the bezel mask.
 *
 * EXPERIMENTAL — not an Apple/Figma value, and deliberately not folded into the
 * material specification. It came from a first pass on the synthetic bench and
 * needs calibrating on the real Windows renderer. The mask itself is derived
 * from the existing displacement map rather than any new geometry; this only
 * shapes how quickly its contribution ramps up toward the edge.
 */
export const GLASS_BEZEL_MASK_EXPONENT = 0.6;

export const FIGMA_GLASS_FRAME_PAINTS = {
  base: "#101010",
  baseBlendMode: "plus-lighter",
  luminosity: "#ffffff",
  luminosityOpacity: 0.04,
  luminosityBlendMode: "luminosity",
} as const;

export const FIGMA_GLASS_REGULAR_PAINTS = {
  base: "#333333",
  baseOpacity: 0,
  baseBlendMode: "luminosity",
  overlay: "#ffffff",
  overlayOpacity: 0.2,
  overlayBlendMode: "overlay",
} as const;

const SMALL_GLASS_FROST_RATIO = 6 / 16;

type RefractionProfile = {
  normalized: Float32Array;
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
  specular: string;
  maximumDisplacement: number;
};

const mapCache = new Map<string, MaterialMaps>();
// feImage stretches the vector field to the panel's exact dimensions, so
// Full-window rasters only waste memory. Bound map resolution and resize
// history: sixteen worst-case displacement maps total roughly
// 16 MiB of raw RGBA data before PNG compression.
// 512px keeps ultra-wide player maps tall enough for a clean optical edge;
// small menus remain native-resolution.
const MAX_MAP_RASTER_SIZE = 512;
const MAX_CACHED_MAPS = 16;
export const FIGMA_SPECULAR_ANGLE_DEGREES = -101;
export const FIGMA_SPECULAR_RIM_WIDTH = 2.25;
const SPECULAR_LIGHT_ANGLE = (FIGMA_SPECULAR_ANGLE_DEGREES * Math.PI) / 180;
const SPECULAR_LIGHT_X = Math.cos(SPECULAR_LIGHT_ANGLE);
const SPECULAR_LIGHT_Y = Math.sin(SPECULAR_LIGHT_ANGLE);

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

function convexSquircle(x: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  return Math.pow(1 - Math.pow(1 - clamped, 4), 0.25);
}

/**
 * Sample one radial slice of a convex-squircle bezel, derive its surface
 * normal, refract an orthogonal ray from air into glass with Snell's law, then
 * normalize the lateral displacement for an 8-bit SVG displacement map.
 */
export function createConvexRefractionProfile(
  refraction: number = FIGMA_GLASS_PRESET.refraction,
): RefractionProfile {
  const strength = Math.min(100, Math.max(0, refraction)) / 100;
  const glassRefractiveIndex = 1 + strength * 4;
  const glassThickness = 10 + strength * 190;
  const raw = new Float32Array(PROFILE_SAMPLES + 1);
  let maximumDisplacement = 0;

  for (let i = 0; i <= PROFILE_SAMPLES; i += 1) {
    const x = i / PROFILE_SAMPLES;
    const delta = 0.001;
    const y1 = convexSquircle(Math.max(0, x - delta));
    const y2 = convexSquircle(Math.min(1, x + delta));
    const derivative = (y2 - y1) / (2 * delta);
    const normalLength = Math.hypot(derivative, 1);
    const normalX = -derivative / normalLength;
    const normalY = -1 / normalLength;
    const dot = normalY;
    const eta = AIR_REFRACTIVE_INDEX / glassRefractiveIndex;
    const k = 1 - eta * eta * (1 - dot * dot);

    if (k > 0) {
      const coefficient = eta * dot + Math.sqrt(k);
      const refractedX = -coefficient * normalX;
      const refractedY = eta - coefficient * normalY;
      const displacement =
        Math.abs(refractedY) > 0.0001
          ? Math.abs((refractedX / refractedY) * glassThickness)
          : 0;
      raw[i] = displacement;
      maximumDisplacement = Math.max(maximumDisplacement, displacement);
    }
  }

  const normalized = raw.map((value) =>
    maximumDisplacement > 0 ? value / maximumDisplacement : 0,
  );
  return { normalized, maximumDisplacement };
}

export function superellipseRectSdf(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  superellipseK: number = WINDOWS_UI_SUPERELLIPSE_K,
): number {
  const qx = Math.abs(x - width / 2) - (width / 2 - radius);
  const qy = Math.abs(y - height / 2) - (height / 2 - radius);
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  const exponent = 2 ** superellipseK;
  const superellipseDistance = Math.pow(
    outsideX ** exponent + outsideY ** exponent,
    1 / exponent,
  );
  return superellipseDistance + Math.min(Math.max(qx, qy), 0) - radius;
}

function sampleProfile(profile: Float32Array, x: number): number {
  const position = Math.min(1, Math.max(0, x)) * PROFILE_SAMPLES;
  const lower = Math.floor(position);
  const upper = Math.min(PROFILE_SAMPLES, lower + 1);
  const mix = position - lower;
  return profile[lower] * (1 - mix) + profile[upper] * mix;
}

function createMaps(
  width: number,
  height: number,
  radius: number,
  superellipseK: number,
  lens: GlassLensTokens,
): MaterialMaps {
  // feImage scales this capped raster back to the exact CSS-pixel size. The
  // radius is scaled with it so the bezel stays physically consistent.
  const rasterScale = Math.min(
    1,
    MAX_MAP_RASTER_SIZE / width,
    MAX_MAP_RASTER_SIZE / height,
  );
  const rasterWidth = Math.max(2, Math.round(width * rasterScale));
  const rasterHeight = Math.max(2, Math.round(height * rasterScale));
  // Floored at 0, not 1: a square surface must stay square in the raster too,
  // or the corners keep a 1px round the element does not have.
  const rasterRadius = Math.max(0, radius * rasterScale);
  const maximumDepth = Math.max(1, Math.min(rasterWidth, rasterHeight) / 2 - 1);
  const bezelWidth = Math.min(
    maximumDepth,
    lens.depth * rasterScale,
  );
  const profile = createConvexRefractionProfile(lens.refraction);
  const specularRimWidth = Math.max(1, FIGMA_SPECULAR_RIM_WIDTH * rasterScale);

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
  const specularImage = displacementContext.createImageData(
    rasterWidth,
    rasterHeight,
  );
  const epsilon = 0.75;

  for (let y = 0; y < rasterHeight; y += 1) {
    for (let x = 0; x < rasterWidth; x += 1) {
      const offset = (y * rasterWidth + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      const sdf = superellipseRectSdf(
        px,
        py,
        rasterWidth,
        rasterHeight,
        rasterRadius,
        superellipseK,
      );
      const distanceFromEdge = -sdf;
      let red = 128;
      let green = 128;
      let specularAlpha = 0;

      if (distanceFromEdge >= 0 && distanceFromEdge < bezelWidth) {
        const outwardX =
          superellipseRectSdf(
            px + epsilon,
            py,
            rasterWidth,
            rasterHeight,
            rasterRadius,
            superellipseK,
          ) -
          superellipseRectSdf(
            px - epsilon,
            py,
            rasterWidth,
            rasterHeight,
            rasterRadius,
            superellipseK,
          );
        const outwardY =
          superellipseRectSdf(
            px,
            py + epsilon,
            rasterWidth,
            rasterHeight,
            rasterRadius,
            superellipseK,
          ) -
          superellipseRectSdf(
            px,
            py - epsilon,
            rasterWidth,
            rasterHeight,
            rasterRadius,
            superellipseK,
          );
        const normalLength = Math.hypot(outwardX, outwardY) || 1;
        const inwardX = -outwardX / normalLength;
        const inwardY = -outwardY / normalLength;
        const magnitude = sampleProfile(
          profile.normalized,
          distanceFromEdge / bezelWidth,
        );
        red = Math.round(128 + inwardX * magnitude * 127);
        green = Math.round(128 + inwardY * magnitude * 127);

        // The article uses a second, dedicated map for the fixed -101° light.
        // Its alpha follows the rounded-bezel normal, so the glint bends with
        // the surface instead of looking like a uniform CSS border.
        const alignment = Math.max(
          0,
          -inwardX * SPECULAR_LIGHT_X + -inwardY * SPECULAR_LIGHT_Y,
        );
        // Keep the rim independent from the much deeper refraction profile.
        // Reusing that profile here produces a broad gradient across tall
        // surfaces instead of a highlight confined to the glass edge.
        const rim = Math.max(0, 1 - distanceFromEdge / specularRimWidth);
        specularAlpha = Math.round(255 * Math.pow(rim, 1.35) * alignment ** 2);
      }

      displacementImage.data[offset] = red;
      displacementImage.data[offset + 1] = green;
      displacementImage.data[offset + 2] = 128;
      displacementImage.data[offset + 3] = 255;
      specularImage.data[offset] = 255;
      specularImage.data[offset + 1] = 255;
      specularImage.data[offset + 2] = 255;
      specularImage.data[offset + 3] = specularAlpha;
    }
  }

  displacementContext.putImageData(displacementImage, 0, 0);
  const specularCanvas = document.createElement("canvas");
  specularCanvas.width = rasterWidth;
  specularCanvas.height = rasterHeight;
  const specularContext = specularCanvas.getContext("2d");
  if (!specularContext) {
    throw new Error("Canvas 2D is unavailable for Liquid Glass highlights");
  }
  specularContext.putImageData(specularImage, 0, 0);
  const maps = {
    displacement: displacementCanvas.toDataURL("image/png"),
    specular: specularCanvas.toDataURL("image/png"),
    // feImage already stretches the lower-resolution vector field to the
    // panel's exact CSS size. Scaling displacement again by 1/rasterScale
    // pulls the optical edge far inside large player surfaces.
    maximumDisplacement: profile.maximumDisplacement,
  };
  // Release the temporary backing store now instead of waiting for renderer
  // GC after every resize or newly opened glass surface.
  displacementCanvas.width = 1;
  displacementCanvas.height = 1;
  specularCanvas.width = 1;
  specularCanvas.height = 1;
  return maps;
}

function getCachedMaps(
  key: string,
  width: number,
  height: number,
  radius: number,
  superellipseK: number,
  lens: GlassLensTokens,
): MaterialMaps {
  const cached = mapCache.get(key);
  if (cached) {
    // Refresh insertion order so the first entry remains the least used.
    mapCache.delete(key);
    mapCache.set(key, cached);
    return cached;
  }

  const maps = createMaps(width, height, radius, superellipseK, lens);
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
  applyRegularPaints: boolean,
  materialLuminosity: number,
  materialShade: number,
  lens: GlassLensTokens,
  grain: number,
  frameTint: number,
  sheen: number,
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
    "color-interpolation-filters": "sRGB",
  });
  // Declared per-primitive: the filter as a whole stays sRGB so the map stages
  // keep their vector channels intact, and only the stages that average real
  // colour opt out.
  const frostSpace =
    GLASS_COLOR_SPACE_MODE === "srgb" ? "sRGB" : "linearRGB";
  const mixSpace = GLASS_COLOR_SPACE_MODE === "full" ? "linearRGB" : "sRGB";

  // When the wash branch is active it owns the final `dispersed` name and the
  // frost/refraction composite lands in an intermediate instead.
  const bodyResult = GLASS_COLOR_WASH_STRENGTH > 0 ? "body_mix" : "dispersed";

  const blur = svgElement("feGaussianBlur");
  setAttributes(blur, {
    in: "SourceGraphic",
    stdDeviation: blurLevel,
    "color-interpolation-filters": frostSpace,
    result: "blurred_frost",
  });
  const saturate = svgElement("feColorMatrix");
  setAttributes(saturate, {
    // Saturation follows the frost: boosting chroma in a different space than
    // the blur averaged in would re-introduce the cast the switch removes.
    "color-interpolation-filters": frostSpace,
    in: "blurred_frost",
    type: "saturate",
    values: saturation,
    result: "blurred_source",
  });

  // The refraction branch's input. Production bends the frosted texture, which
  // has no high-frequency detail left; the bezel path bends the raw backdrop
  // (saturation matched so only sharpness differs between the branches).
  const refractionSource = GLASS_BEZEL_REFRACTION ? "raw_source" : "blurred_source";
  if (GLASS_BEZEL_REFRACTION) {
    // A light low-pass ahead of the lens. Sampling the raw backdrop makes the
    // bezel read as a sharp copy of the background pasted in; the refraction
    // should still carry more spatial information than the frost body, but
    // belong to the same material. Scaled off the frost radius so it tracks
    // the material rather than being an absolute tuned to one stop.
    const preBlurAmount = blurLevel * GLASS_REFRACTION_PREBLUR_RATIO;
    let refractionInput = "SourceGraphic";
    if (preBlurAmount > 0) {
      const preBlur = svgElement("feGaussianBlur");
      setAttributes(preBlur, {
        in: "SourceGraphic",
        stdDeviation: preBlurAmount,
        "color-interpolation-filters": frostSpace,
        result: "refraction_preblur",
      });
      filter.append(preBlur);
      refractionInput = "refraction_preblur";
    }
    const rawSaturate = svgElement("feColorMatrix");
    setAttributes(rawSaturate, {
      "color-interpolation-filters": frostSpace,
      in: refractionInput,
      type: "saturate",
      values: saturation,
      result: "raw_source",
    });
    filter.append(rawSaturate);
  }
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
    (lens.dispersion / 100) *
    (lens.splay / 100);

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
      in: refractionSource,
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
    "color-interpolation-filters": mixSpace,
    result: "red_green",
  });
  const dispersed = svgElement("feBlend");
  setAttributes(dispersed, {
    in: "red_green",
    in2: "blue_channel",
    mode: "screen",
    "color-interpolation-filters": mixSpace,
    // Named `refracted` when the bezel path owns the recombination below, so
    // everything downstream keeps consuming a single `dispersed` result either
    // way and the two architectures stay swappable.
    result: GLASS_BEZEL_REFRACTION ? "refracted" : bodyResult,
  });
  filter.append(redGreen, dispersed);

  if (GLASS_BEZEL_REFRACTION) {
    // The bezel weight is already encoded in the displacement map: it sits at
    // the neutral 128 outside the bezel and deviates inside, so a table
    // transfer of [1, 0, 1] is |x - 0.5| — the deviation magnitude, and
    // therefore how hard the lens is bending at that pixel. No second geometry
    // representation, no extra raster; this reuses the map the SDF already
    // produced for displacement.
    const deviation = svgElement("feComponentTransfer");
    setAttributes(deviation, { in: "displacement_map", result: "bezel_deviation" });
    const devR = svgElement("feFuncR");
    setAttributes(devR, { type: "table", tableValues: "1 0 1" });
    const devG = svgElement("feFuncG");
    setAttributes(devG, { type: "table", tableValues: "1 0 1" });
    const devB = svgElement("feFuncB");
    setAttributes(devB, { type: "table", tableValues: "0 0" });
    deviation.append(devR, devG, devB);

    // Fold the two deviation channels into alpha — the displacement is a 2D
    // vector, so either axis bending counts toward the weight.
    const toAlpha = svgElement("feColorMatrix");
    setAttributes(toAlpha, {
      in: "bezel_deviation",
      type: "matrix",
      values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2 2 0 0 0",
      result: "bezel_alpha",
    });
    const shape = svgElement("feComponentTransfer");
    setAttributes(shape, { in: "bezel_alpha", result: "bezel_mask" });
    const shapeA = svgElement("feFuncA");
    setAttributes(shapeA, {
      type: "gamma",
      amplitude: 1,
      exponent: GLASS_BEZEL_MASK_EXPONENT,
      offset: 0,
    });
    shape.append(shapeA);

    const edgeOptics = svgElement("feComposite");
    setAttributes(edgeOptics, {
      in: "refracted",
      in2: "bezel_mask",
      operator: "in",
      result: "edge_optics",
    });
    // Frost owns the body; the refracted branch only ever adds where the mask
    // says the lens is working. A uniform mix of the two dissolves the frost.
    const spatial = svgElement("feBlend");
    setAttributes(spatial, {
      in: "edge_optics",
      in2: "blurred_source",
      mode: "normal",
      "color-interpolation-filters": mixSpace,
      result: bodyResult,
    });
    filter.append(deviation, toAlpha, shape, edgeOptics, spatial);
  }

  if (GLASS_COLOR_WASH_STRENGTH > 0) {
    // Broad background colour bleeding into the surface — the dirty, smoky
    // character native glass has and a clean blur does not. Reuses the frost
    // intermediate rather than re-reading the backdrop, so the radii compose
    // and this costs one more blur rather than a second full chain.
    const wash = svgElement("feGaussianBlur");
    setAttributes(wash, {
      in: "blurred_source",
      stdDeviation: GLASS_COLOR_WASH_BLUR,
      "color-interpolation-filters": frostSpace,
      result: "wash_blur",
    });
    const washAlpha = svgElement("feComponentTransfer");
    setAttributes(washAlpha, { in: "wash_blur", result: "wash" });
    const washFunc = svgElement("feFuncA");
    setAttributes(washFunc, {
      type: "linear",
      slope: GLASS_COLOR_WASH_STRENGTH / 100,
    });
    washAlpha.append(washFunc);
    // `color` takes hue and saturation from the wash and keeps the body's
    // luminance. That is the whole point: it contaminates with colour without
    // laying grey over the surface, which is what washed Windows out before.
    const contaminated = svgElement("feBlend");
    setAttributes(contaminated, {
      in: "wash",
      in2: bodyResult,
      mode: "color",
      "color-interpolation-filters": mixSpace,
      result: "dispersed",
    });
    filter.append(wash, washAlpha, contaminated);
  }
  const specularImage = svgElement("feImage");
  setAttributes(specularImage, {
    href: maps.specular,
    x: -1,
    y: -1,
    width: width + 2,
    height: height + 2,
    preserveAspectRatio: "none",
    result: "specular_layer",
  });
  const specularSaturated = svgElement("feComposite");
  setAttributes(specularSaturated, {
    in: "dispersed",
    in2: "specular_layer",
    operator: "in",
    result: "specular_saturated",
  });
  const specularFaded = svgElement("feComponentTransfer");
  setAttributes(specularFaded, {
    in: "specular_layer",
    result: "specular_faded",
  });
  const specularAlpha = svgElement("feFuncA");
  setAttributes(specularAlpha, { type: "linear", slope: 0.48 });
  specularFaded.append(specularAlpha);
  const withSaturation = svgElement("feBlend");
  setAttributes(withSaturation, {
    in: "specular_saturated",
    in2: "dispersed",
    mode: "normal",
    result: "with_saturation",
  });
  // Figma frame paints, composited after the glass effect. `arithmetic` with
  // k2=1 is the SVG equivalent of Plus Lighter: it adds the frame colour to the
  // refracted pixels without replacing them with an opaque dark fill.
  //
  // k3 scales that addition rather than being pinned at 1, which is what makes
  // the frame colour's weight adjustable. At k3=1 the surface takes a flat
  // +16/255 everywhere — enough to read as noticeably less see-through than the
  // same material on macOS while every other value matches.
  const frameBase = svgElement("feFlood");
  setAttributes(frameBase, {
    "flood-color": FIGMA_GLASS_FRAME_PAINTS.base,
    x: 0,
    y: 0,
    width,
    height,
    result: "frame_base",
  });
  const withFrameBase = svgElement("feComposite");
  setAttributes(withFrameBase, {
    in: "with_saturation",
    in2: "frame_base",
    operator: "arithmetic",
    k2: 1,
    k3: frameTint / 100,
    result: "with_frame_base",
  });
  const frameLuminosity = svgElement("feFlood");
  setAttributes(frameLuminosity, {
    "flood-color": FIGMA_GLASS_FRAME_PAINTS.luminosity,
    "flood-opacity": FIGMA_GLASS_FRAME_PAINTS.luminosityOpacity,
    x: 0,
    y: 0,
    width,
    height,
    result: "frame_luminosity",
  });
  const withFramePaints = svgElement("feBlend");
  setAttributes(withFramePaints, {
    in: "frame_luminosity",
    in2: "with_frame_base",
    mode: FIGMA_GLASS_FRAME_PAINTS.luminosityBlendMode,
    result: "with_frame_paints",
  });
  const primitives = [
    specularImage,
    specularSaturated,
    specularFaded,
    withSaturation,
    frameBase,
    withFrameBase,
    frameLuminosity,
    withFramePaints,
  ];
  let paintedResult = "with_frame_paints";

  if (sheen > 0) {
    // The white overlay, lifted out of the Regular-only paint block so every
    // stop can dial it. `overlay` against white doubles the darks and drives
    // the highlights to white, so this is the term that decides how much of the
    // backdrop's tonal range survives.
    const sheenLayer = svgElement("feFlood");
    setAttributes(sheenLayer, {
      "flood-color": FIGMA_GLASS_REGULAR_PAINTS.overlay,
      "flood-opacity": sheen / 100,
      x: 0,
      y: 0,
      width,
      height,
      result: "sheen",
    });
    const withSheen = svgElement("feBlend");
    setAttributes(withSheen, {
      in: "sheen",
      in2: paintedResult,
      mode: FIGMA_GLASS_REGULAR_PAINTS.overlayBlendMode,
      result: "with_sheen",
    });
    primitives.push(sheenLayer, withSheen);
    paintedResult = "with_sheen";
  }

  if (applyRegularPaints) {
    // Figma lists the Regular paints top-to-bottom. Composite the lower 80%
    // #404040 Luminosity paint first, then the 20% white Overlay paint.
    const regularBase = svgElement("feFlood");
    setAttributes(regularBase, {
      "flood-color": FIGMA_GLASS_REGULAR_PAINTS.base,
      "flood-opacity": FIGMA_GLASS_REGULAR_PAINTS.baseOpacity,
      x: 0,
      y: 0,
      width,
      height,
      result: "regular_base",
    });
    const withRegularBase = svgElement("feBlend");
    setAttributes(withRegularBase, {
      in: "regular_base",
      in2: "with_frame_paints",
      mode: FIGMA_GLASS_REGULAR_PAINTS.baseBlendMode,
      result: "with_regular_base",
    });
    primitives.push(regularBase, withRegularBase);
    paintedResult = "with_regular_base";
  }

  if (materialShade > 0 || materialLuminosity > 0) {
    // Retains the backdrop's colour but moves its luminance: shade composites
    // black over the frame paints, luminosity mixes back toward white. This is
    // every refractive stop's brightness control, not just Subdued's — it was
    // gated on that one material, which left Clear and Regular with no way to
    // match their macOS counterparts however their tokens were set.
    const materialShadeLayer = svgElement("feFlood");
    setAttributes(materialShadeLayer, {
      "flood-color": "#000000",
      "flood-opacity": materialShade / 100,
      x: 0,
      y: 0,
      width,
      height,
      result: "material_shade",
    });
    const withMaterialShade = svgElement("feBlend");
    setAttributes(withMaterialShade, {
      in: "material_shade",
      in2: "with_frame_paints",
      mode: "normal",
      result: "with_material_shade",
    });
    const materialLuminosityLayer = svgElement("feFlood");
    setAttributes(materialLuminosityLayer, {
      "flood-color": "#ffffff",
      "flood-opacity": materialLuminosity / 100,
      x: 0,
      y: 0,
      width,
      height,
      result: "material_luminosity",
    });
    const withMaterialPaints = svgElement("feBlend");
    setAttributes(withMaterialPaints, {
      in: "material_luminosity",
      in2: "with_material_shade",
      mode: "luminosity",
      result: "with_material_paints",
    });
    primitives.push(
      materialShadeLayer,
      withMaterialShade,
      materialLuminosityLayer,
      withMaterialPaints,
    );
    paintedResult = "with_material_paints";
  }

  if (grain > 0) {
    // The surface texture, composited over the finished material but under the
    // specular rim — the highlight is a reflection off the pane, so it sits on
    // top of the grain rather than being roughened by it.
    //
    // fractalNoise rather than turbulence: it is the smoother, more even of the
    // two, which is what reads as ground glass instead of static. The noise is
    // desaturated first, or its RGB channels show as colour speckle, and its
    // alpha carries the strength so the blend stays a texture rather than a
    // grey wash.
    const grainNoise = svgElement("feTurbulence");
    setAttributes(grainNoise, {
      type: "fractalNoise",
      baseFrequency: 0.8,
      numOctaves: 3,
      stitchTiles: "stitch",
      result: "grain_noise",
    });
    const grainMono = svgElement("feColorMatrix");
    setAttributes(grainMono, {
      in: "grain_noise",
      type: "saturate",
      values: 0,
      result: "grain_mono",
    });
    const grainStrength = svgElement("feComponentTransfer");
    setAttributes(grainStrength, { in: "grain_mono", result: "grain" });
    const grainAlpha = svgElement("feFuncA");
    setAttributes(grainAlpha, { type: "linear", slope: grain / 100 });
    grainStrength.append(grainAlpha);
    const withGrain = svgElement("feBlend");
    setAttributes(withGrain, {
      in: "grain",
      in2: paintedResult,
      mode: "overlay",
      result: "with_grain",
    });
    primitives.push(grainNoise, grainMono, grainStrength, withGrain);
    paintedResult = "with_grain";
  }

  // Specular is the final optical layer. Putting material paints after this
  // rim suppresses it on Windows, while Apple's material keeps the highlight
  // visibly above its tint and luminosity layers.
  const withSpecular = svgElement("feBlend");
  setAttributes(withSpecular, {
    in: "specular_faded",
    in2: paintedResult,
    mode: "normal",
  });
  primitives.push(withSpecular);

  filter.append(...primitives);
  defs.append(filter);
}

function geometryKey(
  width: number,
  height: number,
  radius: number,
  superellipseK: number,
  lens: GlassLensTokens,
): string {
  // Buckets avoid regenerating hundreds of near-identical raster maps during
  // resize; the maps are stretched by feImage to each panel's exact size.
  //
  // The lens belongs in the key: the maps are built from its refraction and
  // depth, so without it two materials with different lenses collide on one
  // cached raster and the second silently renders with the first's optics.
  return `${Math.max(8, Math.round(width / 8) * 8)}x${Math.max(8, Math.round(height / 8) * 8)}r${Math.max(1, Math.round(radius))}k${superellipseK}l${lens.refraction}-${lens.depth}`;
}

/**
 * Invisible SVG host plus a Windows-only observer. Every glass panel receives
 * a filter generated for its measured dimensions; fixed filter images do not
 * resize automatically when used as Chromium backdrop filters.
 */
export function LiquidGlassDefs() {
  const defsRef = useRef<SVGDefsElement>(null);
  // Keep the v0.5.8 optics while letting the current material picker select
  // frost, saturation, and whether this surface is a refractive Liquid Glass
  // stop or a cheaper Classic blur stop.
  const glassMaterial = useSettingsStore((s) => s.glassMaterial);
  const tokens = webGlassMaterialTokens(glassMaterial);
  const { frost, saturation, lens } = tokens;
  const material = {
    ...tokens,
    applyRegularPaints: glassMaterial === "glass-regular",
  };
  const materialRef = useRef(material);
  materialRef.current = material;
  const remeasureAllRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    remeasureAllRef.current?.();
  }, [frost, saturation, lens, glassMaterial]);

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
      // `|| 34` treated a legitimate zero radius as a missing one, because
      // parseFloat("0px") is falsy — so a square surface (the flush sidebar)
      // still had its displacement and specular maps built around the old 34px
      // card, and the highlight traced a shape the element no longer had. Only
      // an unparseable value should fall back. The floor is 0 rather than 1 for
      // the same reason; `superellipseRectSdf` divides by nothing and degrades
      // to a sharp-cornered rect.
      const parsedRadius = Number.parseFloat(computed.borderTopLeftRadius);
      const radius = Math.min(
        Math.max(0, Number.isFinite(parsedRadius) ? parsedRadius : 34),
        width / 2,
        height / 2,
      );
      const isSmall = element.classList.contains("glass-material-small");
      const superellipseK = element.classList.contains("liquid-glass-player")
        ? 1
        : WINDOWS_UI_SUPERELLIPSE_K;
      // Figma uses a 6px frost radius for small controls and 16px for both
      // medium and large panels. Preserve that ratio when the shared slider
      // changes the regular radius.
      const material = materialRef.current;
      const blurLevel =
        material.frost * (isSmall ? SMALL_GLASS_FROST_RATIO : 1);
      // Every input the filter is built from belongs here. Anything omitted is
      // a value the user can change while this early-return keeps the old
      // filter on screen — which is exactly why the lens and the luminance
      // pair used to look inert.
      const lensKey = material.lens
        ? `${material.lens.refraction}-${material.lens.depth}-${material.lens.dispersion}-${material.lens.splay}`
        : "none";
      const geometry = `${isSmall ? "small" : "regular"}-${width}x${height}r${Math.round(radius)}b${blurLevel}v${GLASS_RENDERER_VARIANT}${GLASS_BEZEL_REFRACTION ? `z${GLASS_BEZEL_MASK_EXPONENT}` : ''}s${material.saturation}l${lensKey}${material.applyRegularPaints ? "p" : "n"}d${material.luminosity}-${material.shade}g${material.grain}t${material.frameTint}h${material.sheen}`;
      if (registration.geometry === geometry) return;
      registration.geometry = geometry;

      if (!material.lens) {
        const plain = `blur(${blurLevel}px) saturate(${material.saturation})`;
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
      const lens = material.lens;
      const key = geometryKey(width, height, radius, superellipseK, lens);
      const [size, radiusPart] = key.split("r");
      const [mapWidth, mapHeight] = size.split("x").map(Number);
      const maps = getCachedMaps(
        key,
        mapWidth,
        mapHeight,
        Number(radiusPart.split("k")[0]),
        superellipseK,
        lens,
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
        material.saturation,
        material.applyRegularPaints,
        material.luminosity,
        material.shade,
        lens,
        material.grain,
        material.frameTint,
        material.sheen,
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
