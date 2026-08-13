import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * True while the section occupies enough of the viewport to be the one the
 * user is actually looking at.
 *
 * Every live surface in this story runs a full backdrop filter over moving
 * artwork, which is the most expensive thing the renderer does. Gating on
 * this lets each section mount its material only while it is on screen, so
 * the page pays for one or two surfaces rather than a dozen.
 */
export function useSectionActive<T extends Element>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      // Generous margin: the material should already be settled by the time
      // the section is scrolled into view, never assembling itself in front
      // of the user.
      { rootMargin: "40% 0px 40% 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, active] as const;
}

/**
 * One full-height beat of the story. Sections are deliberately tall and
 * mostly empty: the composition is the artwork and the material, and the
 * copy is a caption on it rather than the subject.
 */
export function StorySection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative flex min-h-[92svh] w-full flex-col items-center justify-center overflow-hidden px-8 py-24",
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * The story's typography. One idea per section, so the headline carries the
 * meaning and the body line is optional support that stays short.
 */
export function StoryCopy({
  eyebrow,
  title,
  body,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  body?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: reduceMotion ? 0 : 1.1, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "pointer-events-none relative z-10 flex max-w-2xl flex-col gap-5",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow ? (
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-white/45">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="text-balance text-[clamp(2.25rem,5.2vw,4rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.55)]">
        {title}
      </h2>
      {body ? (
        <p className="text-pretty text-[clamp(1rem,1.5vw,1.2rem)] font-normal leading-relaxed text-white/80 drop-shadow-[0_1px_14px_rgba(0,0,0,0.85)]">
          {body}
        </p>
      ) : null}
    </motion.div>
  );
}

/**
 * The lit band a section performs in.
 *
 * Keeping the artwork inside a bounded stage rather than bleeding it edge to
 * edge is what buys the story its breathing room: the copy gets calm dark
 * space to sit in, and the material gets a bright, busy backdrop to visibly
 * react to. Deliberately free of transforms, because a transformed ancestor
 * would become the backdrop root and cut the glass off from the artwork it is
 * supposed to be sampling.
 */
export function StoryStage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A slowly drifting wall of covers, sized so a single cover is larger than
 * the material sitting over it. That size matters: the point of the story is
 * that the glass takes colour and structure from what is behind it, and a
 * field of small thumbnails averages out to grey before it ever reaches the
 * surface.
 */
export function ArtworkField({
  artwork,
  active,
  columns = 4,
  direction = "up",
  speed = 90,
  className,
}: {
  artwork: string[];
  active: boolean;
  columns?: number;
  direction?: "up" | "left";
  speed?: number;
  className?: string;
}) {
  // Trimmed to a whole number of rows: the loop translates exactly half the
  // track, which only lands back on itself when both halves are the same
  // shape. A ragged final row would make the wrap visibly jump.
  const perRow = direction === "up" ? columns : 3;
  const trimmed = artwork.slice(
    0,
    Math.max(perRow, Math.floor(artwork.length / perRow) * perRow),
  );

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      aria-hidden
    >
      {direction === "up" ? (
        <VerticalField tiles={trimmed} active={active} columns={columns} speed={speed} />
      ) : (
        <>
          <HorizontalRow
            tiles={trimmed}
            active={active}
            speed={speed}
            className="top-0 h-1/2"
          />
          {/* Second row drifts slower and starts offset, so the wall reads as
              depth rather than as one sliding sheet. */}
          <HorizontalRow
            tiles={[...trimmed.slice(2), ...trimmed.slice(0, 2)]}
            active={active}
            speed={speed * 1.45}
            className="bottom-0 h-1/2"
          />
        </>
      )}
    </div>
  );
}

/**
 * Fills the frame rather than tiling to intrinsic size. Rows are sized by the
 * track (`grid-auto-rows: 1fr` over a 200% height) instead of by the covers,
 * which is what guarantees the material always has artwork under it: a field
 * that runs out mid-section leaves the glass sitting on black, with nothing
 * to refract and nothing to prove.
 */
function VerticalField({
  tiles,
  active,
  columns,
  speed,
}: {
  tiles: string[];
  active: boolean;
  columns: number;
  speed: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="absolute inset-x-0 top-0 grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: "1fr",
        height: "200%",
      }}
      animate={active && !reduceMotion ? { y: ["0%", "-50%"] } : { y: "0%" }}
      transition={{ duration: speed, ease: "linear", repeat: Infinity }}
    >
      {[...tiles, ...tiles].map((url, i) => (
        <Tile key={`${url}-${i}`} url={url} />
      ))}
    </motion.div>
  );
}

function HorizontalRow({
  tiles,
  active,
  speed,
  className,
}: {
  tiles: string[];
  active: boolean;
  speed: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const doubled = [...tiles, ...tiles];
  return (
    <div className={cn("absolute inset-x-0 overflow-hidden", className)}>
      {/* Width comes from the covers, not from a percentage of the section:
          a percentage track makes every tile as tall as the row and as narrow
          as the count demands, which crops square artwork into strips. */}
      <motion.div
        className="flex h-full w-max"
        animate={active && !reduceMotion ? { x: ["0%", "-50%"] } : { x: "0%" }}
        transition={{ duration: speed, ease: "linear", repeat: Infinity }}
      >
        {doubled.map((url, i) => (
          <Tile
            key={`${url}-${i}`}
            url={url}
            className="aspect-square h-full shrink-0"
          />
        ))}
      </motion.div>
    </div>
  );
}

/**
 * The gap lives in padding rather than in `gap`, so translating the track by
 * exactly 50% lands cover-on-cover. A grid `gap` leaves half a gutter
 * unaccounted for at the wrap and the loop visibly stutters once per cycle.
 */
function Tile({
  url,
  className,
  style,
}: {
  url: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("p-2", className)} style={style}>
      <div className="h-full w-full overflow-hidden rounded-[1.4rem] bg-white/5">
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
    </div>
  );
}

/**
 * One artwork crossing a surface's boundary, for the sections that are about
 * the edge rather than the body. Travels far enough past both sides that the
 * cover is fully clear of the material at each end of the sweep, so the
 * viewer sees the transition into and out of the glass, not just the middle.
 */
export function ArtworkSweep({
  artwork,
  active,
  size = 420,
  duration = 18,
  className,
}: {
  artwork: string[];
  active: boolean;
  size?: number;
  duration?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  // Advance the cover once per sweep so the surface is asked to react to a
  // genuinely different palette each pass rather than the same one forever.
  useEffect(() => {
    if (!active || reduceMotion || artwork.length < 2) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % artwork.length),
      duration * 1000,
    );
    return () => window.clearInterval(id);
  }, [active, reduceMotion, artwork.length, duration]);

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
    >
      {/* Ambient wash from the same cover. Without it the surface spends most
          of the sweep over pure black, which reads as a dark panel rather than
          as glass: there is no colour for it to pick up and no gradient for
          the edge to bend. Same image, so this stays the artwork's own colour
          rather than invented decoration. */}
      <motion.img
        key={`bloom-${index}`}
        src={artwork[index] ?? artwork[0]}
        alt=""
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.45 }}
        transition={{ duration: reduceMotion ? 0 : 1.2 }}
        className="absolute left-1/2 top-1/2 h-[190%] w-[120%] -translate-x-1/2 -translate-y-1/2 scale-110 object-cover blur-[64px]"
      />

      <motion.div
        className="absolute top-1/2 overflow-hidden rounded-[2rem] shadow-[0_30px_90px_rgba(0,0,0,0.5)]"
        style={{ width: size, height: size, marginTop: -size / 2 }}
        initial={{ left: "-25%" }}
        animate={
          active && !reduceMotion ? { left: ["-25%", "105%"] } : { left: "36%" }
        }
        transition={{ duration, ease: "linear", repeat: Infinity }}
      >
        <img
          src={artwork[index] ?? artwork[0]}
          alt=""
          className="h-full w-full object-cover"
        />
      </motion.div>
    </div>
  );
}
