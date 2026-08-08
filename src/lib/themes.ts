import { useEffect } from "react";

/**
 * Visual themes are deliberately data, not scattered component classes.
 * A theme is the "child" of the app's visual master component: it owns the
 * semantic color and material tokens while shared components continue to
 * consume `bg-background`, `text-foreground`, `liquid-glass`, etc.
 *
 * There are two themes, both mirrored from the Figma reference (frames
 * "Default theme" and "Modern"). They share one dark/light token palette —
 * the difference the design draws between them is the bottom player bar's
 * arrangement, carried by the `playerLayout` field and consumed by
 * `PlayerBarBottom`.
 */
export type VisualThemeId = "default" | "modern";

/** How the bottom player bar arranges its sections (see Figma frames). */
export type PlayerLayout = "classic" | "modern";

type ThemeTokens = Record<string, string>;

/**
 * The app is dark-only — light mode is deprecated (see `forcedTheme="dark"`
 * in App.tsx). Each theme therefore carries a single dark token set; there
 * is no longer a `light` companion.
 */
export type VisualThemeDefinition = {
  id: VisualThemeId;
  label: string;
  description: string;
  /** Bottom-bar arrangement this theme mounts. */
  playerLayout: PlayerLayout;
  swatches: readonly [string, string, string];
  dark: ThemeTokens;
};

const COMMON_DARK = {
  "--brand-foreground": "oklch(0.985 0 0)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--destructive": "oklch(0.704 0.191 22.216)",
  "--destructive-foreground": "oklch(0.985 0 0)",
  "--border": "oklch(1 0 0 / 10%)",
  "--input": "oklch(1 0 0 / 10%)",
  "--ring": "var(--brand)",
  "--sidebar-border": "oklch(1 0 0 / 10%)",
  "--sidebar-ring": "var(--brand)",
  "--surface": "oklch(0 0 0 / 30%)",
  "--surface-hover": "oklch(0 0 0 / 50%)",
  "--surface-active": "oklch(0 0 0 / 60%)",
  "--hairline": "oklch(1 0 0 / 10%)",
  "--titlebar-hover": "oklch(1 0 0 / 10%)",
};

const MATERIALS = {
  // Shared dark material tokens. Interactive and static surfaces select their
  // own Figma layer stack in glass-surface.ts and index.css.
  // Figma "Medium — Dark" material fill is rgb(26,26,26).
  "--glass-tint-dark": "26 26 26",
  // Figma Fill + Shadow drop shadow (dark).
  "--glass-shadow-dark": "0 18px 48px rgba(0, 0, 0, 0.45)",
  "--app-font-family":
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
  "--radius": "34px",
};

const makeTokens = (values: ThemeTokens): ThemeTokens => ({
  ...MATERIALS,
  ...COMMON_DARK,
  ...values,
});

const NEUTRAL_DARK: ThemeTokens = {
  "--brand": "#fa1f3e",
  "--background": "oklch(0.145 0 0)",
  "--foreground": "oklch(0.985 0 0)",
  "--card": "oklch(0.205 0 0)",
  "--card-foreground": "oklch(0.985 0 0)",
  "--popover": "oklch(0.205 0 0)",
  "--popover-foreground": "oklch(0.985 0 0)",
  "--secondary": "oklch(0.269 0 0)",
  "--secondary-foreground": "oklch(0.985 0 0)",
  "--muted": "oklch(0.269 0 0)",
  "--muted-foreground": "oklch(0.708 0 0)",
  "--accent": "oklch(1 0 0 / 10%)",
  "--accent-foreground": "oklch(0.985 0 0)",
  "--sidebar": "oklch(0.205 0 0)",
  "--sidebar-foreground": "oklch(0.985 0 0)",
  "--sidebar-primary": "var(--brand)",
  "--sidebar-primary-foreground": "var(--brand-foreground)",
  "--sidebar-accent": "oklch(1 0 0 / 10%)",
  "--sidebar-accent-foreground": "oklch(0.985 0 0)",
};

export const VISUAL_THEMES: readonly VisualThemeDefinition[] = [
  {
    id: "default",
    label: "Default",
    description: "Album art and metadata lead, with the transport centered.",
    playerLayout: "classic",
    swatches: ["#fa1f3e", "#19191d", "#f5f5f5"],
    dark: makeTokens(NEUTRAL_DARK),
  },
  {
    id: "modern",
    label: "Modern",
    description:
      "A compact bar: transport on the left, now-playing centered above the scrubber.",
    playerLayout: "modern",
    swatches: ["#fa1f3e", "#19191d", "#f5f5f5"],
    dark: makeTokens(NEUTRAL_DARK),
  },
];

export function isVisualThemeId(value: unknown): value is VisualThemeId {
  return VISUAL_THEMES.some((theme) => theme.id === value);
}

export function getVisualTheme(id: VisualThemeId): VisualThemeDefinition {
  return VISUAL_THEMES.find((theme) => theme.id === id) ?? VISUAL_THEMES[0];
}

function applyVisualTheme(id: VisualThemeId): void {
  const root = document.documentElement;
  const theme = getVisualTheme(id);

  root.dataset.visualTheme = theme.id;
  // Dark-only: light mode is deprecated, so a theme always mounts its dark
  // token set (see `forcedTheme="dark"` in App.tsx).
  for (const [name, value] of Object.entries(theme.dark)) {
    root.style.setProperty(name, value);
  }
}

/** Mount once per native window to apply the selected child theme's tokens. */
export function useVisualTheme(id: VisualThemeId): void {
  useEffect(() => {
    applyVisualTheme(id);
  }, [id]);
}

/** Slider bounds for the shared backdrop blur radius, in pixels. */
export const GLASS_BLUR_MIN = 0;
export const GLASS_BLUR_MAX = 60;
export const GLASS_BLUR_DEFAULT = 16;

export function clampGlassBlur(value: number): number {
  if (!Number.isFinite(value)) return GLASS_BLUR_DEFAULT;
  return Math.round(Math.min(GLASS_BLUR_MAX, Math.max(GLASS_BLUR_MIN, value)));
}

/**
 * Every material WebKit accepts for `-apple-visual-effect`, verified against
 * the running engine with `CSS.supports`. Two families:
 *
 *  - Liquid Glass (macOS 26+): refracting, dynamic, follows the OS.
 *  - Classic: the long-standing HIG blur materials, available much further
 *    back, and still the right pick when a surface wants to sit quieter.
 *
 * Note the regular stop is the *bare* value in both families — the explicit
 * `-regular` spelling is not valid CSS and probes as unsupported.
 */
export const GLASS_MATERIALS = [
  {
    id: "glass-clear",
    group: "Liquid Glass",
    label: "Clear",
    description: "Lightest glass. Most of the backdrop stays visible.",
  },
  {
    id: "glass-regular",
    group: "Liquid Glass",
    label: "Regular",
    description: "Apple's default Liquid Glass.",
  },
  {
    id: "glass-subdued",
    group: "Liquid Glass",
    label: "Subdued",
    description: "Heaviest glass. Mutes the backdrop the most.",
  },
  {
    id: "blur-ultra-thin",
    group: "Classic",
    label: "Ultra thin",
    description: "Barely there. The classic lightest material.",
  },
  {
    id: "blur-thin",
    group: "Classic",
    label: "Thin",
    description: "Light frost, backdrop still legible.",
  },
  {
    id: "blur-regular",
    group: "Classic",
    label: "Regular",
    description: "The standard frosted material.",
  },
  {
    id: "blur-thick",
    group: "Classic",
    label: "Thick",
    description: "Heavy frost. Backdrop reads as colour only.",
  },
  {
    id: "blur-chrome",
    group: "Classic",
    label: "Chrome",
    description: "Densest. Built for toolbars and title bars.",
  },
] as const;

export type GlassMaterialId = (typeof GLASS_MATERIALS)[number]["id"];

/**
 * What each material means to the web renderer.
 *
 * On macOS these ids name a real system material and the OS supplies the
 * optics. Everywhere else the SVG pipeline has to *synthesize* the same stop,
 * so each id needs concrete numbers.
 *
 * Four axes, because the two families behave in opposite directions — which is
 * not obvious until you put all eight side by side over the same album art:
 *
 *  - **Liquid Glass** stays bright and *keeps the backdrop's colour*. Heavier
 *    stops mostly mean more frost; the panel never turns grey. It is emissive
 *    and slightly saturating, which is why it reads as glass over any wallpaper.
 *  - **Classic** progressively *dims and desaturates*. Thick and Chrome are
 *    near-neutral slabs with the colour drained out of them, closer to smoked
 *    perspex than to glass.
 *
 * So a single "how frosted" scalar cannot express both. `luminosity` (white
 * emission) and `shade` (neutral dimming) are separate rather than one signed
 * value because Liquid Glass wants some of each — lifted *and* slightly
 * deepened — while Classic wants shade alone.
 *
 * Calibrated by eye against screenshots of all eight native materials over the
 * same backdrop. A visual match target, not a claim about Apple's internal
 * constants: those are not exposed to CSS, and the only way to read them is off
 * rendered pixels.
 */
export type WebGlassMaterialTokens = {
  /** Backdrop blur radius, in CSS pixels, at the medium/large scale. */
  frost: number;
  /** White emission, in percent. The term a transmissive-only material lacks. */
  luminosity: number;
  /** Neutral dimming, in percent. Carries the Classic family's descent. */
  shade: number;
  /** Backdrop saturation multiplier. Above 1 for glass, below 1 for Classic. */
  saturation: number;
  /**
   * Whether this material bends light at its edge.
   *
   * Only the Liquid Glass family does. The Classic materials are frosted
   * panes, not lenses: macOS renders them as a heavy blur plus an opacity
   * tint, with no displacement at the rim at all. So the family selects the
   * renderer, not merely its parameters — a Classic stop skips the SVG
   * displacement pipeline entirely and resolves to a plain CSS
   * `blur() saturate()` backdrop filter, which is both more faithful and far
   * cheaper than refracting a backdrop that Apple does not refract.
   */
  refraction: boolean;
};

export const WEB_GLASS_MATERIAL_TOKENS: Record<
  GlassMaterialId,
  WebGlassMaterialTokens
> = {
  // Calibrated against the native player bar over album art, 2026-08-07. The
  // whole family is lighter than a first reading of the settings dialog
  // suggested: on macOS the artwork behind Clear stays legible face-by-face,
  // Regular blurs it moderately while keeping its colour, and even Subdued
  // remains translucent — it darkens more than it obscures. Frost is the axis
  // that was consistently too heavy here; do not raise it to make a stop read
  // as "more material", use shade for that, which is what Apple does.
  "glass-clear": {
    frost: 4,
    luminosity: 6,
    shade: 0,
    saturation: 1.1,
    refraction: true,
  },
  "glass-regular": {
    frost: 12,
    luminosity: 10,
    shade: 0,
    saturation: 1.3,
    refraction: true,
  },
  "glass-subdued": {
    frost: 18,
    luminosity: 5,
    shade: 16,
    saturation: 1.1,
    refraction: true,
  },
  // The Classic stops are frosted panes: heavy blur, an opacity tint, no lens.
  // Their frost runs far above the glass family's because the blur is the whole
  // effect rather than one layer of it.
  "blur-ultra-thin": {
    frost: 24,
    luminosity: 4,
    shade: 12,
    saturation: 1.1,
    refraction: false,
  },
  "blur-thin": {
    frost: 40,
    luminosity: 4,
    shade: 20,
    saturation: 0.95,
    refraction: false,
  },
  "blur-regular": {
    frost: 60,
    luminosity: 3,
    shade: 30,
    saturation: 0.8,
    refraction: false,
  },
  "blur-thick": {
    frost: 85,
    luminosity: 3,
    shade: 42,
    saturation: 0.6,
    refraction: false,
  },
  "blur-chrome": {
    frost: 100,
    luminosity: 5,
    shade: 38,
    saturation: 0.45,
    refraction: false,
  },
};

export function webGlassMaterialTokens(id: GlassMaterialId) {
  return (
    WEB_GLASS_MATERIAL_TOKENS[id] ??
    WEB_GLASS_MATERIAL_TOKENS[GLASS_MATERIAL_DEFAULT]
  );
}
export const GLASS_MATERIAL_DEFAULT: GlassMaterialId = "glass-regular";

/** Distinct group names, in declaration order, for rendering menu sections. */
export const GLASS_MATERIAL_GROUPS = [
  ...new Set(GLASS_MATERIALS.map((item) => item.group)),
];

/**
 * Carry a pre-family setting forward. The first cut of this control stored the
 * Liquid Glass stop alone (`clear` / `regular` / `subdued`); those now live
 * under the glass family.
 */
export function migrateGlassMaterialId(value: unknown): GlassMaterialId | null {
  if (isGlassMaterialId(value)) return value;
  if (value === "clear" || value === "regular" || value === "subdued") {
    return `glass-${value}` as GlassMaterialId;
  }
  return null;
}

export function isGlassMaterialId(value: unknown): value is GlassMaterialId {
  return GLASS_MATERIALS.some((item) => item.id === value);
}

/** Descriptor for a material id, falling back to the default if unknown. */
export function getGlassMaterial(
  id: GlassMaterialId,
): (typeof GLASS_MATERIALS)[number] {
  return (
    GLASS_MATERIALS.find((item) => item.id === id) ??
    GLASS_MATERIALS.find((item) => item.id === GLASS_MATERIAL_DEFAULT)!
  );
}

/**
 * Publish the chosen material. Both family attributes are written
 * unconditionally; the stylesheet's `@supports` tiers decide which one (if
 * either) applies, so this never has to know the macOS version. A platform
 * without either simply ignores both attributes and keeps the CSS blur.
 */
export function useGlassMaterial(material: GlassMaterialId): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.glassMaterial = material;
    // The synthesized side of the same choice. Harmless on macOS: the
    // `@supports` block clears the fill the system material already provides.
    const { frost, luminosity, shade } = webGlassMaterialTokens(material);
    root.style.setProperty("--glass-blur", `${frost}px`);
    root.style.setProperty(
      "--glass-blur-small",
      `${Math.round(frost * (6 / 16) * 100) / 100}px`,
    );
    root.style.setProperty("--glass-luminosity", `${luminosity}%`);
    root.style.setProperty("--glass-shade", `${shade}%`);
  }, [material]);
}

/** True when WebKit will honour Apple's Liquid Glass material in this page. */
export function supportsNativeLiquidGlass(): boolean {
  return (
    typeof CSS !== "undefined" &&
    CSS.supports("-apple-visual-effect", "-apple-system-glass-material")
  );
}
