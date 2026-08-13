import { describe, expect, it } from "vitest";
import {
  getVisualTheme,
  isVisualThemeId,
  VISUAL_THEMES,
  webGlassMaterialTokens,
} from "@/lib/themes";

describe("visual theme registry", () => {
  it("keeps every child theme on the shared semantic/material contract", () => {
    for (const theme of VISUAL_THEMES) {
      // Dark-only: light mode is deprecated, so themes carry a single dark
      // token set (no `light` companion).
      expect(theme.dark["--brand"]).toBeTruthy();
      // Glass tint is a shared material; blur/opacity are user-driven and
      // deliberately NOT baked into the per-theme token set.
      expect(theme.dark["--glass-tint-dark"]).toBeTruthy();
      expect(theme.dark["--glass-blur"]).toBeUndefined();
      expect(theme.dark["--radius"]).toBe("34px");
    }
  });

  it("exposes exactly the Default and Modern themes", () => {
    expect(VISUAL_THEMES.map((t) => t.id)).toEqual(["default", "modern"]);
    expect(getVisualTheme("default").playerLayout).toBe("classic");
    expect(getVisualTheme("modern").playerLayout).toBe("modern");
  });

  it("validates persisted IDs and falls back safely", () => {
    expect(isVisualThemeId("modern")).toBe(true);
    // Retired ids from older installs must no longer validate.
    expect(isVisualThemeId("ocean")).toBe(false);
    expect(isVisualThemeId("not-a-theme")).toBe(false);
    expect(getVisualTheme("not-a-theme" as never).id).toBe("default");
  });
});

describe("Windows glass material calibration", () => {
  it("keeps Clear nearly transparent at 1px frost", () => {
    expect(webGlassMaterialTokens("glass-clear")).toEqual({
      frost: 1,
      luminosity: 3,
      shade: 0,
      saturation: 1.1,
      sheen: 0,
      frameTint: 100,
      grain: 8,
      lens: { refraction: 30, depth: 20, dispersion: 20, splay: 20 },
    });
  });

  it("keeps Subdued aligned with the native 2560x1440 reference", () => {
    expect(webGlassMaterialTokens("glass-subdued")).toEqual({
      frost: 14,
      luminosity: 2,
      shade: 22,
      saturation: 1.2,
      sheen: 0,
      frameTint: 100,
      grain: 6,
      lens: { refraction: 70, depth: 30, dispersion: 20, splay: 20 },
    });
  });
});
