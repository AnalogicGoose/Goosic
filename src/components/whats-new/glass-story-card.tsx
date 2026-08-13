import { ArrowRightIcon } from "lucide-react";
import { GLASS_SURFACE_CLASS } from "@/components/ui/glass-surface";
import { ArtworkField } from "@/components/whats-new/story-stage";
import { useShowcaseArtwork } from "@/components/whats-new/use-showcase-artwork";
import { cn } from "@/lib/utils";

/**
 * The entry point into the Liquid Glass story.
 *
 * The preview is the live material over real covers rather than a still,
 * which costs one small surface and makes the card itself the argument for
 * opening the story.
 */
export function GlassStoryCard({ onOpen }: { onOpen: () => void }) {
  const artwork = useShowcaseArtwork(8);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col text-left"
    >
      <div className="relative h-56 w-full overflow-hidden bg-black">
        <ArtworkField artwork={artwork} active columns={3} speed={90} />
        <div className="pointer-events-none absolute inset-0 bg-black/30" />
        <div className="absolute inset-0 grid place-items-center">
          <div
            className={cn(
              GLASS_SURFACE_CLASS,
              "grid h-24 w-[72%] place-items-center rounded-[1.5rem]",
            )}
          >
            <span className="text-lg font-semibold tracking-[-0.02em] text-white">
              Liquid Glass
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between gap-4 px-6 pb-6 pt-5">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-semibold leading-tight tracking-[-0.02em]">
            Liquid Glass, refined.
          </h2>
          <p className="text-sm text-muted-foreground">
            A new material experience for Goosic.
          </p>
        </div>
        <span className="mb-0.5 flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary">
          Take a look
          <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
