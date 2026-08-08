/**
 * Resolution policy for the Windows Liquid Glass pipeline.
 *
 * The glass renderer has four independent resolutions, and conflating them is
 * what makes a "quality" slider destroy the optics:
 *
 *  1. **Displacement** — the refraction vector field. Its texel density decides
 *     how precisely the bezel's curvature is described. Lowering it does not
 *     make the glass cheaper to composite (the field is rasterized once and
 *     cached); it only makes the refraction blocky.
 *  2. **Source** — the resolution at which the backdrop behind the glass is
 *     sampled. This is the only input that is re-read every frame, so it is the
 *     one worth reducing under load.
 *  3. **Blur** — the working extent of the frost pass.
 *  4. **Composite** — the resolution the glass surface itself is drawn at.
 *     Always the display resolution; reducing it is what makes glass look
 *     pixelated rather than merely soft.
 *
 * A tier may only reduce (2) and (3). `displacementScale` and `compositeScale`
 * are held at full quality in every tier by design — the refraction algorithm,
 * its edge behaviour, and the final compositing stay identical no matter how
 * cheap the tier is, and only the background being refracted gets coarser.
 */

export type GlassQualityTier = "full" | "balanced" | "economy";

export type GlassResolutionBudget = {
  /**
   * Texels per CSS pixel for the refraction/displacement vector field. Scaled
   * up by the display's device pixel ratio, never down by a tier.
   */
  displacementScale: number;
  /**
   * Fraction of full resolution at which the backdrop is sampled by the glass.
   * The per-frame performance knob.
   */
  sourceScale: number;
  /** Fraction of the full 3σ blur margin kept as the frost's working extent. */
  blurScale: number;
  /** The glass surface always composites at display resolution. */
  compositeScale: 1;
};

const TIERS: Record<
  GlassQualityTier,
  Omit<GlassResolutionBudget, "compositeScale">
> = {
  full: { displacementScale: 1, sourceScale: 1, blurScale: 1 },
  balanced: { displacementScale: 1, sourceScale: 0.5, blurScale: 0.85 },
  economy: { displacementScale: 1, sourceScale: 0.25, blurScale: 0.7 },
};

let activeTier: GlassQualityTier = "full";

/** Swap the active tier. Surfaces pick it up on their next re-measure. */
export function setGlassQualityTier(tier: GlassQualityTier): void {
  activeTier = tier;
}

export function getGlassQualityTier(): GlassQualityTier {
  return activeTier;
}

/**
 * Device pixel ratio the displacement field is rasterized at. Capped at 2:
 * beyond that the field is already smoother than the 8-bit channel encoding
 * can express, so the extra texels only cost memory.
 */
function displayScale(): number {
  const ratio =
    typeof window === "undefined" ? 1 : (window.devicePixelRatio ?? 1);
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(2, Math.max(1, ratio));
}

export function getGlassResolutionBudget(
  tier: GlassQualityTier = activeTier,
): GlassResolutionBudget {
  const preset = TIERS[tier];
  return {
    ...preset,
    displacementScale: preset.displacementScale * displayScale(),
    compositeScale: 1,
  };
}

/**
 * Upper bound on displacement-field texels for one surface. Only a backstop
 * against a full-screen dialog allocating tens of megabytes — `MIN_BEZEL_TEXELS`
 * outranks it, because a coarse bezel is a visible defect while a larger raster
 * is a one-off cost paid on geometry change and then cached.
 */
export const MAX_MAP_TEXELS = 640_000;

/**
 * Texels the field must keep across the bezel band regardless of surface size.
 * The old uniform `min(1, 512/w, 512/h)` cap tied the short axis to the long
 * one: a 1800x88 player bar was rasterized at 512x25, leaving roughly eight
 * texels to describe a 30px bezel before feImage stretched them back out. That
 * is what made the top and bottom edges stair-step.
 */
export const MIN_BEZEL_TEXELS = 24;

/**
 * Extra Gaussian σ that band-limits the backdrop to `sourceScale` of full
 * resolution.
 *
 * Chromium exposes no way to rasterize a `backdrop-filter`'s input at a chosen
 * resolution (`filterRes` was removed and is not coming back), so a reduced
 * source resolution is realised as the band-limit that resampling would have
 * applied. It folds into the frost blur — Gaussians compose — so it costs no
 * extra filter primitive, and the refraction downstream then reads a genuinely
 * lower-frequency backdrop. σ ≈ 0.4 texels is the effective width of a box
 * downsample followed by a bilinear upsample.
 */
export function sourceBandLimitSigma(sourceScale: number): number {
  if (!Number.isFinite(sourceScale) || sourceScale >= 1) return 0;
  const scale = Math.max(0.05, sourceScale);
  return 0.4 * Math.sqrt(1 / (scale * scale) - 1);
}
