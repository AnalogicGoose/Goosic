import { describe, expect, it } from "vitest";
import {
  createConvexRefractionProfile,
  FIGMA_GLASS_FRAME_PAINTS,
  FIGMA_GLASS_PRESET,
  FIGMA_GLASS_REGULAR_PAINTS,
  FIGMA_SPECULAR_ANGLE_DEGREES,
  FIGMA_SPECULAR_RIM_WIDTH,
  superellipseRectSdf,
  WINDOWS_UI_SUPERELLIPSE_K,
} from "./liquid-glass-defs";

describe("FIGMA_GLASS_PRESET", () => {
  it("keeps the exposed Active=True optics values exact", () => {
    expect(FIGMA_GLASS_PRESET).toEqual({
      refraction: 70,
      depth: 30,
      dispersion: 20,
      splay: 20,
    });
  });
});

describe("Figma continuous corners", () => {
  it("uses the round K=1 UI curve for the SVG maps", () => {
    expect(WINDOWS_UI_SUPERELLIPSE_K).toBe(1);
    const radius = 32;
    const diagonal = radius / Math.pow(2, 1 / 2 ** WINDOWS_UI_SUPERELLIPSE_K);
    expect(
      superellipseRectSdf(
        200 - radius + diagonal,
        200 - radius + diagonal,
        200,
        200,
        radius,
        WINDOWS_UI_SUPERELLIPSE_K,
      ),
    ).toBeCloseTo(0, 5);
  });

  it("supports the round K=1 capsule used by the player", () => {
    const radius = 32;
    const diagonal = radius / Math.sqrt(2);
    expect(
      superellipseRectSdf(
        200 - radius + diagonal,
        200 - radius + diagonal,
        200,
        200,
        radius,
        1,
      ),
    ).toBeCloseTo(0, 5);
  });
});

describe("FIGMA_SPECULAR_ANGLE_DEGREES", () => {
  it("uses the supplied fixed light direction", () => {
    expect(FIGMA_SPECULAR_ANGLE_DEGREES).toBe(-101);
  });
});

describe("FIGMA_SPECULAR_RIM_WIDTH", () => {
  it("keeps the highlight in a narrow edge band", () => {
    expect(FIGMA_SPECULAR_RIM_WIDTH).toBe(2.25);
  });
});

describe("FIGMA_GLASS_REGULAR_PAINTS", () => {
  it("keeps the supplied Regular fills and blend modes exact", () => {
    expect(FIGMA_GLASS_REGULAR_PAINTS).toEqual({
      base: "#404040",
      baseOpacity: 0.8,
      baseBlendMode: "luminosity",
      overlay: "#ffffff",
      overlayOpacity: 0.2,
      overlayBlendMode: "overlay",
    });
  });
});

describe("FIGMA_GLASS_FRAME_PAINTS", () => {
  it("keeps the supplied frame fills and blend modes exact", () => {
    expect(FIGMA_GLASS_FRAME_PAINTS).toEqual({
      base: "#101010",
      baseBlendMode: "plus-lighter",
      luminosity: "#ffffff",
      luminosityOpacity: 0.04,
      luminosityBlendMode: "luminosity",
    });
  });
});

describe("createConvexRefractionProfile", () => {
  it("creates a strong edge displacement that settles to neutral inside", () => {
    const profile = createConvexRefractionProfile();

    expect(profile.normalized).toHaveLength(128);
    expect(profile.normalized[0]).toBeCloseTo(1, 2);
    expect(profile.normalized[127]).toBeCloseTo(0, 3);
    expect(profile.maximumDisplacement).toBeGreaterThan(0);
  });

  it("scales physical displacement with refraction strength", () => {
    const soft = createConvexRefractionProfile(35);
    const strong = createConvexRefractionProfile(70);

    expect(soft.maximumDisplacement).toBeGreaterThan(0);
    expect(strong.maximumDisplacement).toBeGreaterThan(
      soft.maximumDisplacement,
    );
  });
});
