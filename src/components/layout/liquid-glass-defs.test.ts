import { describe, expect, it } from "vitest";
import {
  FIGMA_GLASS_PRESET,
  lensDisplacementFactor,
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

describe("lensDisplacementFactor", () => {
  it("bends light only at the rim and leaves the interior flat", () => {
    // Inset is the SDF depth over the panel's short side, so anything past the
    // 30% band is interior and must pass the backdrop through untouched.
    expect(lensDisplacementFactor(0)).toBeCloseTo(1, 5);
    expect(lensDisplacementFactor(0.3)).toBe(0);
    expect(lensDisplacementFactor(0.5)).toBe(0);
  });

  it("rises monotonically toward the edge", () => {
    const samples = [0.25, 0.2, 0.15, 0.1, 0.05, 0].map(lensDisplacementFactor);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it("stays flat through the middle before turning over at the edge", () => {
    // The circular profile is what keeps the panel readable: half way into the
    // band it has spent well under half its displacement.
    expect(lensDisplacementFactor(0.15)).toBeLessThan(0.15);
    expect(lensDisplacementFactor(0.03)).toBeGreaterThan(0.5);
  });

  it("clamps inputs from outside the surface", () => {
    expect(lensDisplacementFactor(-1)).toBeCloseTo(1, 5);
    expect(lensDisplacementFactor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
