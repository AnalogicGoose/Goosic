import { describe, expect, it } from "vitest";
import {
  createConvexRefractionProfile,
  displacementRasterScale,
  FIGMA_GLASS_PRESET,
} from "./liquid-glass-defs";

/**
 * Where each destination sample reads from, in bezel widths. Refraction is
 * only well behaved while this is increasing: a decreasing run means two
 * destinations swap their source order, and the bezel renders a mirrored
 * sweep of the panel instead of a compressed one.
 */
function sourcePositions(
  normalized: Float32Array,
  maximumDisplacement: number,
): number[] {
  const last = normalized.length - 1;
  return Array.from(normalized, (value, index) => {
    return index / last + value * maximumDisplacement;
  });
}

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

describe("createConvexRefractionProfile", () => {
  it("settles to neutral at the inner end of the bezel", () => {
    const profile = createConvexRefractionProfile();

    expect(profile.normalized).toHaveLength(256);
    expect(profile.normalized[255]).toBeCloseTo(0, 3);
  });

  it("peaks just inside the rim rather than on it", () => {
    const { normalized } = createConvexRefractionProfile();
    const peak = normalized.indexOf(
      normalized.reduce((a, b) => Math.max(a, b), 0),
    );

    // Fresnel transmittance goes to zero at grazing incidence, so the
    // outermost sample bends less than the band just inside it. That rolloff
    // is what keeps the boundary continuous with the neutral field outside.
    expect(normalized[0]).toBeGreaterThan(0);
    expect(normalized[0]).toBeLessThan(1);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(normalized.length * 0.1);
  });

  it("compresses the sampled backdrop without folding it over", () => {
    const profile = createConvexRefractionProfile();
    const source = sourcePositions(
      profile.normalized,
      profile.maximumDisplacement,
    );

    for (let i = 1; i < source.length; i += 1) {
      expect(source[i]).toBeGreaterThanOrEqual(source[i - 1] - 1e-6);
    }
  });

  it("holds the peak displacement inside the bezel it belongs to", () => {
    // Expressed in bezel widths. Anything at or above 1 would reach past the
    // band and, on a short surface like the player bar, past the surface.
    for (const refraction of [20, 50, 70, 100]) {
      const { maximumDisplacement } = createConvexRefractionProfile(refraction);
      expect(maximumDisplacement).toBeGreaterThan(0);
      expect(maximumDisplacement).toBeLessThan(1);
    }
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

describe("displacementRasterScale", () => {
  it("keeps a wide, short surface at full density", () => {
    // The player bar. A uniform `min(1, 512/w, 512/h)` cap resolved this at
    // 0.28, leaving ~8 texels to describe a 30px bezel on the short axis.
    expect(displacementRasterScale(1800, 88, 30, 1)).toBe(1);
  });

  it("never rasterizes finer than the requested density", () => {
    expect(displacementRasterScale(44, 44, 21, 1)).toBe(1);
    expect(displacementRasterScale(1800, 88, 30, 2)).toBe(2);
  });

  it("keeps the bezel resolved when the texel budget bites", () => {
    const scale = displacementRasterScale(1400, 900, 30, 1);

    expect(scale).toBeLessThan(1);
    // The budget may coarsen the field, but not past the point where the
    // bezel stops being described — that is the quality this tier protects.
    expect(scale * 30).toBeGreaterThanOrEqual(24);
  });
});
