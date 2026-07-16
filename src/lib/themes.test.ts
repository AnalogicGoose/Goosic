import { describe, expect, it } from "vitest";
import { getVisualTheme, isVisualThemeId, VISUAL_THEMES } from "@/lib/themes";

describe("visual theme registry", () => {
  it("keeps every child theme on the shared semantic/material contract", () => {
    for (const theme of VISUAL_THEMES) {
      expect(theme.light["--brand"]).toBeTruthy();
      expect(theme.dark["--brand"]).toBeTruthy();
      expect(theme.light["--glass-blur"]).toBe("26px");
      expect(theme.dark["--glass-blur"]).toBe("26px");
      expect(theme.light["--radius"]).toBe("34px");
      expect(theme.dark["--radius"]).toBe("34px");
    }
  });

  it("validates persisted IDs and falls back safely", () => {
    expect(isVisualThemeId("ocean")).toBe(true);
    expect(isVisualThemeId("not-a-theme")).toBe(false);
    expect(getVisualTheme("not-a-theme" as never).id).toBe("goosic");
  });
});
