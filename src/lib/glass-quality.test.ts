import { describe, expect, it } from "vitest";
import {
  getGlassResolutionBudget,
  sourceBandLimitSigma,
  type GlassQualityTier,
} from "./glass-quality";

const TIERS: GlassQualityTier[] = ["full", "balanced", "economy"];

describe("getGlassResolutionBudget", () => {
  it("never trades refraction or compositing for performance", () => {
    for (const tier of TIERS) {
      const budget = getGlassResolutionBudget(tier);
      // The whole point of the split: a cheaper tier refracts a coarser
      // backdrop, it does not refract it more coarsely.
      expect(budget.displacementScale).toBeGreaterThanOrEqual(1);
      expect(budget.compositeScale).toBe(1);
    }
  });

  it("reduces only the backdrop and blur resolutions as tiers get cheaper", () => {
    const full = getGlassResolutionBudget("full");
    const balanced = getGlassResolutionBudget("balanced");
    const economy = getGlassResolutionBudget("economy");

    expect(full.sourceScale).toBe(1);
    expect(balanced.sourceScale).toBeLessThan(full.sourceScale);
    expect(economy.sourceScale).toBeLessThan(balanced.sourceScale);
    expect(economy.blurScale).toBeLessThan(full.blurScale);
    expect(economy.displacementScale).toBe(full.displacementScale);
  });
});

describe("sourceBandLimitSigma", () => {
  it("costs nothing at full source resolution", () => {
    expect(sourceBandLimitSigma(1)).toBe(0);
    expect(sourceBandLimitSigma(1.5)).toBe(0);
  });

  it("widens as the backdrop is sampled more coarsely", () => {
    const half = sourceBandLimitSigma(0.5);
    const quarter = sourceBandLimitSigma(0.25);

    expect(half).toBeGreaterThan(0);
    expect(quarter).toBeGreaterThan(half);
  });
});
