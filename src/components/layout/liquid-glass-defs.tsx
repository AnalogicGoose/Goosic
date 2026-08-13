import { useEffect, useRef } from "react";
import { isWindowsWebview } from "@/lib/platform";
import { useSettingsStore } from "@/lib/store/settings";
import { webGlassMaterialTokens } from "@/lib/themes";

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
  refraction: 70,
  depth: 30,
  dispersion: 20,
  splay: 20,
} as const;

export const FIGMA_GLASS_FRAME_PAINTS = {
  base: "#101010",
  baseBlendMode: "plus-lighter",
  luminosity: "#ffffff",
  luminosityOpacity: 0.04,
  luminosityBlendMode: "luminosity",
} as const;

export const FIGMA_GLASS_REGULAR_PAINTS = {
  base: "#404040",
  baseOpacity: 0.8,
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
    FIGMA_GLASS_PRESET.depth * rasterScale,
  );
  const profile = createConvexRefractionProfile();
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
): MaterialMaps {
  const cached = mapCache.get(key);
  if (cached) {
    // Refresh insertion order so the first entry remains the least used.
    mapCache.delete(key);
    mapCache.set(key, cached);
    return cached;
  }

  const maps = createMaps(width, height, radius, superellipseK);
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
  applySubduedPaints: boolean,
  subduedLuminosity: number,
  subduedShade: number,
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
  // k2=k3=1 is the SVG equivalent of Plus Lighter: it adds #101010 to the
  // refracted pixels without replacing them with an opaque dark fill.
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
    k3: 1,
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
    redGreen,
    dispersed,
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
    const regularOverlay = svgElement("feFlood");
    setAttributes(regularOverlay, {
      "flood-color": FIGMA_GLASS_REGULAR_PAINTS.overlay,
      "flood-opacity": FIGMA_GLASS_REGULAR_PAINTS.overlayOpacity,
      x: 0,
      y: 0,
      width,
      height,
      result: "regular_overlay",
    });
    const withRegularPaints = svgElement("feBlend");
    setAttributes(withRegularPaints, {
      in: "regular_overlay",
      in2: "with_regular_base",
      mode: FIGMA_GLASS_REGULAR_PAINTS.overlayBlendMode,
      result: "with_regular_paints",
    });
    primitives.push(
      regularBase,
      withRegularBase,
      regularOverlay,
      withRegularPaints,
    );
    paintedResult = "with_regular_paints";
  }

  if (applySubduedPaints) {
    // Native Subdued retains the backdrop's colour but lowers its luminance.
    // Apply the material's shade after the common frame paints, then restore
    // only its small luminosity term; extra frost alone produced the milky
    // Windows bar seen beside the native 2560x1440 reference.
    const subduedShadeLayer = svgElement("feFlood");
    setAttributes(subduedShadeLayer, {
      "flood-color": "#000000",
      "flood-opacity": subduedShade / 100,
      x: 0,
      y: 0,
      width,
      height,
      result: "subdued_shade",
    });
    const withSubduedShade = svgElement("feBlend");
    setAttributes(withSubduedShade, {
      in: "subdued_shade",
      in2: "with_frame_paints",
      mode: "normal",
      result: "with_subdued_shade",
    });
    const subduedLuminosityLayer = svgElement("feFlood");
    setAttributes(subduedLuminosityLayer, {
      "flood-color": "#ffffff",
      "flood-opacity": subduedLuminosity / 100,
      x: 0,
      y: 0,
      width,
      height,
      result: "subdued_luminosity",
    });
    const withSubduedPaints = svgElement("feBlend");
    setAttributes(withSubduedPaints, {
      in: "subdued_luminosity",
      in2: "with_subdued_shade",
      mode: "luminosity",
      result: "with_subdued_paints",
    });
    primitives.push(
      subduedShadeLayer,
      withSubduedShade,
      subduedLuminosityLayer,
      withSubduedPaints,
    );
    paintedResult = "with_subdued_paints";
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
): string {
  // Buckets avoid regenerating hundreds of near-identical raster maps during
  // resize; the maps are stretched by feImage to each panel's exact size.
  return `${Math.max(8, Math.round(width / 8) * 8)}x${Math.max(8, Math.round(height / 8) * 8)}r${Math.max(1, Math.round(radius))}k${superellipseK}`;
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
  const { frost, saturation, refraction } = tokens;
  const material = {
    ...tokens,
    applyRegularPaints: glassMaterial === "glass-regular",
    applySubduedPaints: glassMaterial === "glass-subdued",
  };
  const materialRef = useRef(material);
  materialRef.current = material;
  const remeasureAllRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    remeasureAllRef.current?.();
  }, [frost, saturation, refraction, glassMaterial]);

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
      const geometry = `${isSmall ? "small" : "regular"}-${width}x${height}r${Math.round(radius)}b${blurLevel}s${material.saturation}${material.refraction ? "r" : "f"}${material.applyRegularPaints ? "p" : "n"}${material.applySubduedPaints ? `d${material.luminosity}-${material.shade}` : ""}`;
      if (registration.geometry === geometry) return;
      registration.geometry = geometry;

      if (!material.refraction) {
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
      const key = geometryKey(width, height, radius, superellipseK);
      const [size, radiusPart] = key.split("r");
      const [mapWidth, mapHeight] = size.split("x").map(Number);
      const maps = getCachedMaps(
        key,
        mapWidth,
        mapHeight,
        Number(radiusPart.split("k")[0]),
        superellipseK,
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
        material.applySubduedPaints,
        material.luminosity,
        material.shade,
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
