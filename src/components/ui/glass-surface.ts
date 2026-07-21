import { isLinuxWebview } from "@/lib/platform";

/** The two material constructions exposed by the Figma component set. */
export type GlassMaterialVariant = "interactive" | "static";

/**
 * Figma uses a 6px Glass radius for small controls and 16px for medium and
 * large panels. Geometry remains owned by the consumer (`rounded-*`).
 */
export type GlassMaterialScale = "small" | "medium" | "large";

type GlassSurfaceOptions = {
  variant?: GlassMaterialVariant;
  scale?: GlassMaterialScale;
  player?: boolean;
};

const LINUX_SURFACE_FALLBACK =
  "relative isolate border-border bg-background/90 text-foreground shadow-[0_8px_48px_rgba(0,0,0,0.45)]";

/**
 * Build the canonical material marker classes without coupling geometry or
 * content styling to the optical implementation in index.css.
 */
export function glassSurfaceClass({
  variant = "interactive",
  scale = "medium",
  player = false,
}: GlassSurfaceOptions = {}): string {
  if (isLinuxWebview()) return LINUX_SURFACE_FALLBACK;

  return [
    "relative isolate liquid-glass glass-material text-foreground",
    `glass-material-${variant}`,
    `glass-material-${scale}`,
    player ? "liquid-glass-player" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Full adaptive/refraction material for navigational and control surfaces. */
export const GLASS_SURFACE_CLASS = glassSurfaceClass();

/** Figma Active=False: Shadow -> Fill, with no Glass Effect layer. */
export const STATIC_GLASS_SURFACE_CLASS = glassSurfaceClass({
  variant: "static",
});

/** Active=True small-control material used by primary actions. */
export const INTERACTIVE_GLASS_CONTROL_CLASS = glassSurfaceClass({
  scale: "small",
});

/** Active=False small-control material used by secondary actions. */
export const STATIC_GLASS_CONTROL_CLASS = glassSurfaceClass({
  variant: "static",
  scale: "small",
});

/** Player geometry uses the large semantic scale (16px Glass radius). */
export const PLAYER_GLASS_SURFACE_CLASS = glassSurfaceClass({
  scale: "large",
  player: true,
});

/** Static large-panel material used by the low-cost floating WebView path. */
export const STATIC_PLAYER_GLASS_SURFACE_CLASS = glassSurfaceClass({
  variant: "static",
  scale: "large",
  player: true,
});

/** Menus/popovers use the medium semantic scale (16px Glass radius). */
export const MENU_GLASS_SURFACE_CLASS = glassSurfaceClass({ scale: "medium" });

/** Dialogs share the large-panel construction from the Figma specimen. */
export const DIALOG_GLASS_SURFACE_CLASS = glassSurfaceClass({ scale: "large" });
