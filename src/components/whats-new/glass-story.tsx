import { useEffect, useState } from "react";
import {
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  DIALOG_GLASS_SURFACE_CLASS,
  GLASS_SURFACE_CLASS,
  INTERACTIVE_GLASS_CONTROL_CLASS,
  MENU_GLASS_SURFACE_CLASS,
  PLAYER_GLASS_SURFACE_CLASS,
} from "@/components/ui/glass-surface";
import { PlayerBarBottom } from "@/components/layout/player-bar-bottom";
import {
  ArtworkField,
  ArtworkSweep,
  StoryCopy,
  StorySection,
  StoryStage,
  useSectionActive,
} from "@/components/whats-new/story-stage";
import {
  useContrastArtwork,
  useShowcaseArtwork,
} from "@/components/whats-new/use-showcase-artwork";
import { cn } from "@/lib/utils";

/**
 * The feature story for the Liquid Glass release.
 *
 * Every surface on this screen is the production material: the same classes
 * from `glass-surface.ts` that the real player, sidebar, and menus use, over
 * real cover art. Nothing here recreates the effect, and nothing here is a
 * screenshot, because the entire claim being made is that the shipped
 * material is worth looking at.
 */
export function GlassStory({ onClose }: { onClose: () => void }) {
  const artwork = useShowcaseArtwork(12);
  const contrast = useContrastArtwork(5);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-black">
      <div
        // Always opens on the hero. The browser will otherwise carry a
        // restored scroll offset into a container it has seen before, and the
        // story would start halfway through its own argument.
        ref={(node) => {
          if (node) node.scrollTop = 0;
        }}
        className="app-scroll h-full w-full overflow-y-auto overflow-x-hidden"
      >
        <Hero artwork={artwork} />
        <BehindIt artwork={artwork} />
        <Refraction artwork={contrast} />
        <Colour artwork={contrast} />
        <Player artwork={artwork} />
        <Surfaces artwork={artwork} />
        <Closing onClose={onClose} />
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cn(
          INTERACTIVE_GLASS_CONTROL_CLASS,
          "absolute right-6 top-6 z-20 grid size-10 place-items-center rounded-full text-white/80 transition-colors hover:text-white",
        )}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

/**
 * A large floating slab over a full field of artwork. The headline sits on
 * the material rather than beside it, which makes the first thing the user
 * sees a demonstration that the glass stays readable over moving colour.
 */
function Hero({ artwork }: { artwork: string[] }) {
  const [ref, active] = useSectionActive<HTMLDivElement>();
  const reduceMotion = useReducedMotion();

  return (
    <div ref={ref}>
      <StorySection className="min-h-[100svh]">
        <ArtworkField
          artwork={artwork}
          active={active}
          columns={4}
          speed={160}
          className="opacity-90"
        />
        {/* Holds the edges of the field back so the slab's rim stays the
            brightest thing in the frame, and takes enough off the centre for
            the headline to carry. Still far from opaque: the material has to
            have colour left to pick up, or the hero argues against itself. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.42)_15%,rgba(0,0,0,0.9)_82%)]" />

        {active ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: reduceMotion ? 0 : 1.4,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={cn(
              DIALOG_GLASS_SURFACE_CLASS,
              "z-10 flex w-[min(46rem,84vw)] flex-col items-center gap-6 px-12 py-16 text-center",
            )}
          >
            <h1 className="text-[clamp(2.75rem,7vw,5.25rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)]">
              Liquid Glass
              <span className="block text-white/70">Refined for Goosic.</span>
            </h1>
            <p className="max-w-md text-pretty text-[clamp(1rem,1.6vw,1.2rem)] leading-relaxed text-white/85 drop-shadow-[0_1px_10px_rgba(0,0,0,0.7)]">
              A more expressive material that bends, softens, and responds to
              the music behind it.
            </p>
          </motion.div>
        ) : null}
      </StorySection>
    </div>
  );
}

/** The material reacting to a wall of covers travelling past it. */
function BehindIt({ artwork }: { artwork: string[] }) {
  const [ref, active] = useSectionActive<HTMLDivElement>();

  return (
    <div ref={ref}>
      <StorySection>
        <StoryCopy
          title="Made from what's behind it."
          body={
            <>
              Every surface responds to the colour, light and artwork beneath
              it.
            </>
          }
        />

        <StoryStage className="mt-20 h-[42vh] min-h-[18rem]">
          <ArtworkField
            artwork={artwork}
            active={active}
            direction="left"
            speed={70}
          />
          {active ? (
            <div
              className={cn(
                GLASS_SURFACE_CLASS,
                "z-10 h-[62%] w-[min(52rem,88vw)]",
              )}
            />
          ) : null}
        </StoryStage>
      </StorySection>
    </div>
  );
}

/**
 * A single cover crossing a pill's boundary. Sized and paced so the eye can
 * follow one edge: the artwork bends as it enters, softens through the body,
 * and lights the rim on the way out.
 */
function Refraction({ artwork }: { artwork: string[] }) {
  const [ref, active] = useSectionActive<HTMLDivElement>();

  return (
    <div ref={ref}>
      <StorySection>
        <StoryCopy title="Light bends differently now." />

        {/* The ambient wash is clipped by the stage, so without a fade its
            top and bottom read as a hard-edged rectangle of colour. */}
        <StoryStage className="mt-20 h-[46vh] min-h-[20rem] [mask-image:linear-gradient(to_bottom,transparent,#000_16%,#000_84%,transparent)]">
          <ArtworkSweep
            artwork={artwork}
            active={active}
            size={420}
            duration={20}
          />
          {active ? (
            <div
              className={cn(
                PLAYER_GLASS_SURFACE_CLASS,
                "z-10 h-44 w-[min(38rem,84vw)]",
              )}
            />
          ) : null}
        </StoryStage>
      </StorySection>
    </div>
  );
}

/** Strongly different artwork under one surface, one cover at a time. */
function Colour({ artwork }: { artwork: string[] }) {
  const [ref, active] = useSectionActive<HTMLDivElement>();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || reduceMotion || artwork.length < 2) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % artwork.length),
      4200,
    );
    return () => window.clearInterval(id);
  }, [active, reduceMotion, artwork.length]);

  return (
    <div ref={ref}>
      <StorySection>
        <StoryCopy
          title="Never just grey."
          body="Liquid Glass takes on the character of whatever is underneath."
        />

        <StoryStage className="mt-20 h-[48vh] min-h-[22rem]">
          <div className="absolute inset-0 grid place-items-center" aria-hidden>
            <AnimatePresence initial={false}>
              <motion.img
                key={artwork[index] ?? index}
                src={artwork[index]}
                alt=""
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 1.6,
                  ease: "easeInOut",
                }}
                className="absolute aspect-square h-full rounded-[3rem] object-cover"
              />
            </AnimatePresence>
          </div>

          {active ? (
            <div
              className={cn(
                GLASS_SURFACE_CLASS,
                "z-10 h-[70%] w-[min(30rem,80vw)]",
              )}
            />
          ) : null}
        </StoryStage>
      </StorySection>
    </div>
  );
}

/**
 * The real player component, presented larger than life over artwork. It
 * reads from the live playback store, so what the user sees here is the
 * player they actually use, showing whatever they were last listening to.
 * Input is disabled: this is a presentation of the component, and a second
 * live transport would fight the one docked at the bottom of the app.
 */
function Player({ artwork }: { artwork: string[] }) {
  const [ref, active] = useSectionActive<HTMLDivElement>();

  return (
    <div ref={ref}>
      <StorySection>
        <StoryCopy title="Designed around your music." />

        <StoryStage className="mt-20 h-[44vh] min-h-[20rem]">
          <ArtworkField
            artwork={artwork}
            active={active}
            direction="left"
            speed={90}
          />
          {active ? (
            // The player positions itself absolutely against the shell's
            // content column and reads `--shell-inset` for its left edge, so
            // presenting it standalone means handing it an equivalent box
            // rather than restyling the component.
            <div
              className="pointer-events-none relative z-10 h-32 w-[min(72rem,94vw)] [--shell-inset:0px]"
              aria-hidden
            >
              <PlayerBarBottom presentation />
            </div>
          ) : null}
        </StoryStage>
      </StorySection>
    </div>
  );
}

/** The surfaces the material covers, one at a time rather than all at once. */
const SURFACE_SEQUENCE = [
  {
    label: "Sidebar",
    render: () => (
      <div
        className={cn(
          GLASS_SURFACE_CLASS,
          "flex h-[26rem] w-64 flex-col gap-2 p-5",
        )}
      >
        <span className="px-2 pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-white/55">
          Browse
        </span>
        {["Home", "Explore", "Search", "Library"].map((item, i) => (
          <div
            key={item}
            className={cn(
              "rounded-xl px-3 py-2.5 text-sm text-white/85",
              i === 0 && "bg-white/15 text-white",
            )}
          >
            {item}
          </div>
        ))}
      </div>
    ),
  },
  {
    label: "Menu",
    render: () => (
      <div
        className={cn(
          MENU_GLASS_SURFACE_CLASS,
          "flex w-64 flex-col gap-1 p-2",
        )}
      >
        {["Play next", "Add to queue", "Go to album", "Share"].map((item) => (
          <div
            key={item}
            className="rounded-lg px-3 py-2 text-sm text-white/90"
          >
            {item}
          </div>
        ))}
      </div>
    ),
  },
  {
    label: "Controls",
    render: () => (
      <div className="flex items-center gap-5">
        {[SkipBackIcon, PlayIcon, SkipForwardIcon].map((Icon, i) => (
          <div
            key={i}
            className={cn(
              INTERACTIVE_GLASS_CONTROL_CLASS,
              i === 1 ? "size-24" : "size-16",
              "grid place-items-center rounded-full text-white/85",
            )}
          >
            <Icon className={i === 1 ? "size-9" : "size-6"} />
          </div>
        ))}
      </div>
    ),
  },
  {
    label: "Panel",
    render: () => (
      <div
        className={cn(
          DIALOG_GLASS_SURFACE_CLASS,
          "h-[22rem] w-[min(34rem,86vw)]",
        )}
      />
    ),
  },
] as const;

function Surfaces({ artwork }: { artwork: string[] }) {
  const [ref, active] = useSectionActive<HTMLDivElement>();
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active || reduceMotion) return;
    const id = window.setInterval(
      () => setStep((s) => (s + 1) % SURFACE_SEQUENCE.length),
      3800,
    );
    return () => window.clearInterval(id);
  }, [active, reduceMotion]);

  const surface = SURFACE_SEQUENCE[step];

  return (
    <div ref={ref}>
      <StorySection>
        <StoryCopy title="One material, everywhere." />

        <StoryStage className="mt-20 h-[52vh] min-h-[26rem]">
          <ArtworkField
            artwork={artwork}
            active={active}
            direction="left"
            speed={140}
          />
          {/* These surfaces carry their own labels, unlike the bare panels
              earlier in the story, so the field behind them is held back far
              enough for that text to read through a near-clear material. */}
          <div className="pointer-events-none absolute inset-0 bg-black/55" />
          <AnimatePresence mode="wait">
            {active ? (
              <motion.div
                key={surface.label}
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -18 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.9,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="z-10"
              >
                {surface.render()}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </StoryStage>
      </StorySection>
    </div>
  );
}

function Closing({ onClose }: { onClose: () => void }) {
  return (
    <StorySection className="min-h-[70svh]">
      <StoryCopy
        title="Turn it up."
        body="Liquid Glass is on by default. Change the material any time in Settings."
      />
      <button
        type="button"
        onClick={onClose}
        className={cn(
          INTERACTIVE_GLASS_CONTROL_CLASS,
          "z-10 mt-12 rounded-full px-8 py-3.5 text-sm font-medium text-white",
        )}
      >
        Back to Goosic
      </button>
    </StorySection>
  );
}
