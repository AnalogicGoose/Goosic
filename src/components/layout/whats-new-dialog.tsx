import { useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReleaseNotes, useWhatsNewStore } from "@/lib/store/whats-new";
import { resolveWhatsNewEntry } from "@/lib/whats-new-remote";
import { hasGlassStory } from "@/lib/whats-new-story";
import { GlassStory } from "@/components/whats-new/glass-story";
import { GlassStoryCard } from "@/components/whats-new/glass-story-card";
import { APP_ICON } from "@/lib/branding";

/**
 * The post-update What's New screen: a hero banner, the title and
 * release date, and a scrollable list of changes grouped into sections.
 * Opened automatically once per release (see `useWhatsNewOnUpdate`) and
 * manually from the About dialog. Closed with the X, a click outside,
 * or Escape, so it carries no footer button of its own.
 */
export function WhatsNewDialog() {
  const open = useWhatsNewStore((s) => s.open);
  const setOpen = useWhatsNewStore((s) => s.setOpen);
  const version = useWhatsNewStore((s) => s.version);
  // What GitHub says about this version wins; the bundled entry covers a
  // release whose body carries no authored notes, and an offline launch.
  const releases = useReleaseNotes();
  const entry = resolveWhatsNewEntry(version, releases);
  // Releases whose headline is a visual change get a feature story instead of
  // a change list. The card below is the entry point; opening it hands the
  // whole screen over, so the dialog steps aside rather than sitting behind.
  const [storyOpen, setStoryOpen] = useState(false);
  const story = hasGlassStory(entry?.version);

  // `?story=1` opens the feature story and `?story=card` its entry point.
  // Reaching either normally means shipping a version bump or walking the
  // About dialog, too slow a loop for a screen that is almost entirely visual.
  const [devCard, setDevCard] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const requested = new URLSearchParams(window.location.search).get("story");
    if (requested === "1") setStoryOpen(true);
    else if (requested === "card") setDevCard(true);
  }, []);

  if (story && entry) {
    return (
      <>
        <Dialog
          open={(open || devCard) && !storyOpen}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setStoryOpen(false);
              setDevCard(false);
            }
          }}
        >
          <DialogContent className="max-w-lg overflow-hidden p-0">
            <DialogTitle className="sr-only">
              Liquid Glass, refined.
            </DialogTitle>
            <DialogDescription className="sr-only">
              A new material experience for Goosic, in version {entry.version}.
            </DialogDescription>
            <GlassStoryCard onOpen={() => setStoryOpen(true)} />
          </DialogContent>
        </Dialog>
        {storyOpen ? (
          <GlassStory
            onClose={() => {
              setStoryOpen(false);
              setOpen(false);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <Dialog open={open && !!entry} onOpenChange={setOpen}>
      {entry ? (
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden p-0">
          {/* Hero: bundled image if the entry has one, else a branded
              gradient so the screen never looks broken. Fixed height
              (not aspect-ratio): an aspect-ratio flex child mis-sizes
              the column under max-height and lets the dialog outgrow
              the viewport. */}
          <div className="relative h-[190px] w-full shrink-0 overflow-hidden">
            {entry.image ? (
              <img
                src={entry.image}
                alt=""
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-background">
                <img
                  src={APP_ICON}
                  alt=""
                  className="size-16 opacity-90 drop-shadow-md"
                />
              </div>
            )}
          </div>

          <div className="shrink-0 px-6 pb-4 pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <DialogTitle className="text-xl font-bold leading-none">
                What's New
              </DialogTitle>
              {entry.date ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {entry.date}
                </span>
              ) : null}
            </div>
            <DialogDescription className="sr-only">
              Release notes for Goosic version {entry.version}
            </DialogDescription>
          </div>

          <div className="app-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-0">
            {entry.sections.map((section, i) => (
              <div key={i} className="flex flex-col gap-2">
                {section.heading ? (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {section.heading}
                  </h3>
                ) : null}
                {section.body ? (
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
                    {/* Release bodies keep their paragraph breaks, and their
                        links arrive as bare URLs that have to wrap inside a
                        narrow dialog rather than widen it. */}
                    <p className="whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">
                      {section.body}
                    </p>
                  </div>
                ) : section.items ? (
                  <ul className="flex flex-col gap-2">
                    {section.items.map((item, j) => (
                      <li
                        key={j}
                        className="flex gap-2.5 text-sm leading-snug text-foreground/90"
                      >
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="min-w-0 break-words">{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {section.alert ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm leading-relaxed text-amber-800 dark:text-amber-200">
                      {section.alert}
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
