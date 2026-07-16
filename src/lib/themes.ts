import { useEffect } from "react";

/**
 * Visual themes are deliberately data, not scattered component classes.
 * A theme is the "child" of the app's visual master component: it owns the
 * semantic color and material tokens while shared components continue to
 * consume `bg-background`, `text-foreground`, `liquid-glass`, etc.
 */
export type VisualThemeId = "goosic" | "ocean" | "sunset" | "mono";

type ThemeTokens = Record<string, string>;

export type VisualThemeDefinition = {
  id: VisualThemeId;
  label: string;
  description: string;
  swatches: readonly [string, string, string];
  light: ThemeTokens;
  dark: ThemeTokens;
};

const COMMON_LIGHT = {
  "--brand-foreground": "oklch(0.985 0 0)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--destructive": "oklch(0.577 0.245 27.325)",
  "--destructive-foreground": "oklch(0.985 0 0)",
  "--border": "oklch(0.922 0 0)",
  "--input": "oklch(0.922 0 0)",
  "--ring": "var(--brand)",
  "--sidebar-border": "oklch(0.922 0 0)",
  "--sidebar-ring": "var(--brand)",
  "--surface": "oklch(1 0 0 / 55%)",
  "--surface-hover": "oklch(1 0 0 / 70%)",
  "--surface-active": "oklch(1 0 0 / 85%)",
  "--hairline": "oklch(0 0 0 / 12%)",
  "--titlebar-hover": "oklch(0 0 0 / 7%)",
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
  "--glass-blur": "26px",
  "--glass-saturation": "190%",
  "--glass-brightness": "1.04",
  "--glass-bg-light": "rgba(255, 255, 255, 0.55)",
  "--glass-bg-dark": "rgba(32, 32, 36, 0.52)",
  "--glass-border-light": "rgba(255, 255, 255, 0.45)",
  "--glass-border-dark": "rgba(255, 255, 255, 0.18)",
  "--glass-shadow-light": "0 12px 48px rgba(0, 0, 0, 0.28)",
  "--glass-shadow-dark": "0 12px 48px rgba(0, 0, 0, 0.5)",
  "--glass-player-light": "rgba(255, 255, 255, 0.10)",
  "--glass-player-dark": "rgba(32, 32, 36, 0.10)",
  "--app-font-family":
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
  "--radius": "34px",
};

const makeTokens = (
  mode: "light" | "dark",
  values: ThemeTokens,
): ThemeTokens => ({
  ...MATERIALS,
  ...(mode === "light" ? COMMON_LIGHT : COMMON_DARK),
  ...values,
});

export const VISUAL_THEMES: readonly VisualThemeDefinition[] = [
  {
    id: "goosic",
    label: "Goosic",
    description: "The original red accent and neutral glass material.",
    swatches: ["#fa1f3e", "#19191d", "#f5f5f5"],
    light: makeTokens("light", {
      "--brand": "#fa1f3e",
      "--background": "oklch(1 0 0)",
      "--foreground": "oklch(0.145 0 0)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.145 0 0)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.145 0 0)",
      "--secondary": "oklch(0.97 0 0)",
      "--secondary-foreground": "oklch(0.205 0 0)",
      "--muted": "oklch(0.97 0 0)",
      "--muted-foreground": "oklch(0.556 0 0)",
      "--accent": "oklch(0.97 0 0)",
      "--accent-foreground": "oklch(0.205 0 0)",
      "--sidebar": "oklch(0.985 0 0)",
      "--sidebar-foreground": "oklch(0.145 0 0)",
      "--sidebar-primary": "var(--brand)",
      "--sidebar-primary-foreground": "var(--brand-foreground)",
      "--sidebar-accent": "oklch(0.97 0 0)",
      "--sidebar-accent-foreground": "oklch(0.205 0 0)",
    }),
    dark: makeTokens("dark", {
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
    }),
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Cool cyan accents with a deep blue glass atmosphere.",
    swatches: ["#19b7d8", "#10232e", "#e8fbff"],
    light: makeTokens("light", {
      "--brand": "#0891b2",
      "--background": "oklch(0.98 0.012 215)",
      "--foreground": "oklch(0.2 0.03 220)",
      "--card": "oklch(0.99 0.008 215)",
      "--card-foreground": "oklch(0.2 0.03 220)",
      "--popover": "oklch(0.99 0.008 215)",
      "--popover-foreground": "oklch(0.2 0.03 220)",
      "--secondary": "oklch(0.94 0.025 210)",
      "--secondary-foreground": "oklch(0.25 0.04 220)",
      "--muted": "oklch(0.94 0.025 210)",
      "--muted-foreground": "oklch(0.48 0.04 220)",
      "--accent": "oklch(0.93 0.045 205)",
      "--accent-foreground": "oklch(0.22 0.05 220)",
      "--sidebar": "oklch(0.96 0.025 215)",
      "--sidebar-foreground": "oklch(0.2 0.03 220)",
      "--sidebar-primary": "var(--brand)",
      "--sidebar-primary-foreground": "var(--brand-foreground)",
      "--sidebar-accent": "oklch(0.93 0.045 205)",
      "--sidebar-accent-foreground": "oklch(0.22 0.05 220)",
      "--glass-bg-light": "rgba(225, 249, 255, 0.58)",
      "--glass-border-light": "rgba(120, 215, 235, 0.42)",
    }),
    dark: makeTokens("dark", {
      "--brand": "#22d3ee",
      "--background": "oklch(0.14 0.035 220)",
      "--foreground": "oklch(0.96 0.02 210)",
      "--card": "oklch(0.19 0.04 220)",
      "--card-foreground": "oklch(0.96 0.02 210)",
      "--popover": "oklch(0.19 0.04 220)",
      "--popover-foreground": "oklch(0.96 0.02 210)",
      "--secondary": "oklch(0.25 0.05 220)",
      "--secondary-foreground": "oklch(0.96 0.02 210)",
      "--muted": "oklch(0.25 0.05 220)",
      "--muted-foreground": "oklch(0.72 0.04 210)",
      "--accent": "oklch(0.32 0.07 215 / 70%)",
      "--accent-foreground": "oklch(0.98 0.01 210)",
      "--sidebar": "oklch(0.17 0.045 220)",
      "--sidebar-foreground": "oklch(0.96 0.02 210)",
      "--sidebar-primary": "var(--brand)",
      "--sidebar-primary-foreground": "var(--brand-foreground)",
      "--sidebar-accent": "oklch(0.32 0.07 215 / 70%)",
      "--sidebar-accent-foreground": "oklch(0.98 0.01 210)",
      "--glass-bg-dark": "rgba(10, 33, 45, 0.58)",
      "--glass-border-dark": "rgba(128, 229, 244, 0.24)",
      "--glass-player-dark": "rgba(10, 33, 45, 0.10)",
    }),
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm coral and violet accents for a softer atmosphere.",
    swatches: ["#f97362", "#321d2e", "#fff0e7"],
    light: makeTokens("light", {
      "--brand": "#e85d4a",
      "--background": "oklch(0.985 0.012 45)",
      "--foreground": "oklch(0.2 0.025 340)",
      "--card": "oklch(0.995 0.008 45)",
      "--card-foreground": "oklch(0.2 0.025 340)",
      "--popover": "oklch(0.995 0.008 45)",
      "--popover-foreground": "oklch(0.2 0.025 340)",
      "--secondary": "oklch(0.95 0.025 45)",
      "--secondary-foreground": "oklch(0.28 0.04 340)",
      "--muted": "oklch(0.95 0.025 45)",
      "--muted-foreground": "oklch(0.5 0.04 340)",
      "--accent": "oklch(0.94 0.05 35)",
      "--accent-foreground": "oklch(0.25 0.04 340)",
      "--sidebar": "oklch(0.97 0.02 40)",
      "--sidebar-foreground": "oklch(0.2 0.025 340)",
      "--sidebar-primary": "var(--brand)",
      "--sidebar-primary-foreground": "var(--brand-foreground)",
      "--sidebar-accent": "oklch(0.94 0.05 35)",
      "--sidebar-accent-foreground": "oklch(0.25 0.04 340)",
      "--glass-bg-light": "rgba(255, 242, 233, 0.58)",
      "--glass-border-light": "rgba(245, 145, 122, 0.38)",
    }),
    dark: makeTokens("dark", {
      "--brand": "#fb7185",
      "--background": "oklch(0.14 0.035 340)",
      "--foreground": "oklch(0.97 0.015 45)",
      "--card": "oklch(0.2 0.045 340)",
      "--card-foreground": "oklch(0.97 0.015 45)",
      "--popover": "oklch(0.2 0.045 340)",
      "--popover-foreground": "oklch(0.97 0.015 45)",
      "--secondary": "oklch(0.27 0.055 340)",
      "--secondary-foreground": "oklch(0.97 0.015 45)",
      "--muted": "oklch(0.27 0.055 340)",
      "--muted-foreground": "oklch(0.74 0.04 35)",
      "--accent": "oklch(0.34 0.08 350 / 70%)",
      "--accent-foreground": "oklch(0.99 0.01 45)",
      "--sidebar": "oklch(0.18 0.05 340)",
      "--sidebar-foreground": "oklch(0.97 0.015 45)",
      "--sidebar-primary": "var(--brand)",
      "--sidebar-primary-foreground": "var(--brand-foreground)",
      "--sidebar-accent": "oklch(0.34 0.08 350 / 70%)",
      "--sidebar-accent-foreground": "oklch(0.99 0.01 45)",
      "--glass-bg-dark": "rgba(49, 27, 43, 0.58)",
      "--glass-border-dark": "rgba(255, 158, 150, 0.24)",
      "--glass-player-dark": "rgba(49, 27, 43, 0.10)",
    }),
  },
  {
    id: "mono",
    label: "Mono",
    description: "A quiet monochrome interface that lets album art lead.",
    swatches: ["#a1a1aa", "#18181b", "#fafafa"],
    light: makeTokens("light", {
      "--brand": "#52525b",
      "--background": "oklch(0.985 0 0)",
      "--foreground": "oklch(0.2 0 0)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.2 0 0)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.2 0 0)",
      "--secondary": "oklch(0.94 0 0)",
      "--secondary-foreground": "oklch(0.25 0 0)",
      "--muted": "oklch(0.94 0 0)",
      "--muted-foreground": "oklch(0.5 0 0)",
      "--accent": "oklch(0.91 0 0)",
      "--accent-foreground": "oklch(0.2 0 0)",
      "--sidebar": "oklch(0.95 0 0)",
      "--sidebar-foreground": "oklch(0.2 0 0)",
      "--sidebar-primary": "var(--brand)",
      "--sidebar-primary-foreground": "var(--brand-foreground)",
      "--sidebar-accent": "oklch(0.91 0 0)",
      "--sidebar-accent-foreground": "oklch(0.2 0 0)",
    }),
    dark: makeTokens("dark", {
      "--brand": "#d4d4d8",
      "--background": "oklch(0.12 0 0)",
      "--foreground": "oklch(0.96 0 0)",
      "--card": "oklch(0.18 0 0)",
      "--card-foreground": "oklch(0.96 0 0)",
      "--popover": "oklch(0.18 0 0)",
      "--popover-foreground": "oklch(0.96 0 0)",
      "--secondary": "oklch(0.25 0 0)",
      "--secondary-foreground": "oklch(0.96 0 0)",
      "--muted": "oklch(0.25 0 0)",
      "--muted-foreground": "oklch(0.7 0 0)",
      "--accent": "oklch(0.34 0 0 / 70%)",
      "--accent-foreground": "oklch(0.98 0 0)",
      "--sidebar": "oklch(0.16 0 0)",
      "--sidebar-foreground": "oklch(0.96 0 0)",
      "--sidebar-primary": "var(--brand)",
      "--sidebar-primary-foreground": "var(--brand-foreground)",
      "--sidebar-accent": "oklch(0.34 0 0 / 70%)",
      "--sidebar-accent-foreground": "oklch(0.98 0 0)",
      "--glass-bg-dark": "rgba(28, 28, 31, 0.58)",
      "--glass-border-dark": "rgba(255, 255, 255, 0.22)",
    }),
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
  const isDark = root.classList.contains("dark");
  const tokens = isDark ? theme.dark : theme.light;

  root.dataset.visualTheme = theme.id;
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
}

/**
 * Mount once per native window. Watching the next-themes class is important:
 * changing Light/Dark must reapply the selected child theme's mode tokens too.
 */
export function useVisualTheme(id: VisualThemeId): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => applyVisualTheme(id);
    const observer = new MutationObserver(apply);

    apply();
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [id]);
}
