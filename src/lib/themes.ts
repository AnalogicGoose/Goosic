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
 * Drive the shared `--glass-blur` radius every glass surface reads. Kept out
 * of `applyVisualTheme` so switching theme never resets the user's chosen
 * blur. Mounted in both the main and floating windows.
 */
/**
 * macOS native-material stops, ordered lightest to heaviest.
 *
 * WebKit exposes Apple's materials to CSS through `-apple-visual-effect` (see
 * the `@supports` tiers in index.css). Both families are real system materials,
 * so the blur slider stops being a CSS radius there and becomes a picker across
 * these stops instead — the user's "how frosted is this" model survives, it just
 * quantizes to what the OS actually offers. Verified against WebKit with
 * `CSS.supports`; note the regular stop is the bare name in both families, as
 * the explicit `-regular` spelling is not a valid value.
 */
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
 * Drive the shared `--glass-blur` radius every glass surface reads. Kept out
 * of `applyVisualTheme` so switching theme never resets the user's chosen
 * blur. Mounted in both the main and floating windows.
 *
 */
export function useGlassBlur(blurPx: number): void {
  useEffect(() => {
    const blur = clampGlassBlur(blurPx);
    document.documentElement.style.setProperty("--glass-blur", `${blur}px`);
    document.documentElement.style.setProperty(
      "--glass-blur-small",
      `${Math.round(blur * (6 / 16) * 100) / 100}px`,
    );
  }, [blurPx]);
}

/**
 * Publish the chosen macOS material. Both family attributes are written
 * unconditionally; the stylesheet's `@supports` tiers decide which one (if
 * either) applies, so this never has to know the macOS version. A platform
 * without either simply ignores both attributes and keeps the CSS blur.
 */
export function useGlassMaterial(material: GlassMaterialId): void {
  useEffect(() => {
    document.documentElement.dataset.glassMaterial = material;
  }, [material]);
}

/** True when WebKit will honour Apple's Liquid Glass material in this page. */
export function supportsNativeLiquidGlass(): boolean {
  return (
    typeof CSS !== "undefined" &&
    CSS.supports("-apple-visual-effect", "-apple-system-glass-material")
  );
}
