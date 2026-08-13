import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INTERACTIVE_GLASS_CONTROL_CLASS } from "@/components/ui/glass-surface";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { isMacOSWebview } from "@/lib/platform";
import { cn } from "@/lib/utils";

// Caption-bar nav buttons. These stay flat (`ghost`): the material belongs to
// the frame around them, so giving each button its own would stack glass on
// glass. `rounded-full` keeps hover/press states concentric with that frame.
const NAV_BTN_CLS =
  "size-7 rounded-full text-foreground/70 transition-transform duration-150 ease-out hover:text-foreground active:scale-95";

/**
 * The caption-bar controls read as one grouped frame rather than loose icons,
 * the way a system toolbar groups paired actions. The seam splits the two jobs
 * in the cluster -- the sidebar toggle on one side, history navigation on the
 * other -- so the grouping carries meaning instead of just boxing things in.
 */
const NAV_SEAM_CLS = "mx-0.5 my-1.5 w-px self-stretch bg-foreground/15";

// Plain-vite dev in a regular browser has no Tauri backend —
// `getCurrentWindow()` throws on missing `__TAURI_INTERNALS__`, which
// used to crash the whole shell through the router's error boundary.
// Window controls are meaningless in a browser tab anyway.
const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const USES_NATIVE_MACOS_TITLEBAR = IS_TAURI && isMacOSWebview();

/**
 * Cross-platform title bar. Windows and Linux keep Goosic's custom caption
 * buttons, while macOS uses Tauri's native overlay title bar so AppKit owns
 * the real traffic lights. The shared HTML strip still supplies navigation
 * and a drag region on every platform.
 *
 * Both AppKit's native close control and Goosic's custom close button go
 * through the Rust `WindowEvent::CloseRequested` handler, which either hides
 * the window into the tray (default) or quits, per the "Close to tray" choice
 * in Settings. "Quit Goosic" there, and the tray's own Quit item, always
 * terminate the process regardless of that setting.
 */
export function TopBar() {
  const router = useRouter();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!IS_TAURI || USES_NATIVE_MACOS_TITLEBAR) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    win.isMaximized().then((m) => {
      if (!cancelled) setMaximized(m);
    });
    // Mirrors the cancelled-flag pattern used in audio-engine / app-shell:
    // `.onResized` is async, so its `.then` may resolve AFTER cleanup ran
    // in StrictMode's mount → unmount → remount cycle. Without the flag the
    // listener leaks twice and we get duplicated maximized-state updates.
    win
      .onResized(() => {
        win.isMaximized().then((m) => {
          if (!cancelled) setMaximized(m);
        });
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const win = () => getCurrentWindow();

  return (
    <>
      <header
        data-tauri-drag-region
        className="relative z-30 flex h-9 shrink-0 select-none items-center"
      >
        <div
          className={cn(
            INTERACTIVE_GLASS_CONTROL_CLASS,
            "glass-button ml-2 flex items-center rounded-full p-0.5",
            // Clear AppKit's traffic lights when it owns the title bar.
            USES_NATIVE_MACOS_TITLEBAR && "ml-[76px]",
          )}
        >
          <SidebarTrigger className={NAV_BTN_CLS} />

          <span aria-hidden className={NAV_SEAM_CLS} />

          <Button
            variant="ghost"
            size="icon"
            className={NAV_BTN_CLS}
            onClick={() => router.history.back()}
            aria-label="Back"
          >
            <ArrowLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={NAV_BTN_CLS}
            onClick={() => router.history.forward()}
            aria-label="Forward"
          >
            <ArrowRightIcon />
          </Button>
        </div>

        {/* Drag spacer — fills remaining width so the user can grab
            almost anywhere in the bar to move the window. */}
        <div data-tauri-drag-region className="h-full flex-1" />

        {!USES_NATIVE_MACOS_TITLEBAR && (
          <div className="flex h-full items-center">
            <button
              type="button"
              onClick={() => win().minimize()}
              aria-label="Minimize"
              className="flex h-full w-11 items-center justify-center text-foreground/85 transition-colors hover:bg-titlebar-hover"
            >
              <MinimizeGlyph />
            </button>
            <button
              type="button"
              onClick={() => win().toggleMaximize()}
              aria-label={maximized ? "Restore" : "Maximize"}
              className="flex h-full w-11 items-center justify-center text-foreground/85 transition-colors hover:bg-titlebar-hover"
            >
              {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
            </button>
            <button
              type="button"
              onClick={() => win().close()}
              aria-label="Close"
              className="flex h-full w-11 items-center justify-center text-foreground/85 transition-colors hover:bg-[#c42b1c] hover:text-white"
            >
              <CloseGlyph />
            </button>
          </div>
        )}
      </header>
    </>
  );
}

/* Hand-drawn 10×10 SVGs match the Windows 11 caption-button glyphs
   more faithfully than Lucide icons (which are designed at 24px and
   look chunky at this size). */

function MinimizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M0 5 H10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect
        x="0.5"
        y="0.5"
        width="9"
        height="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function RestoreGlyph() {
  // Front square is a full outlined rect; back square is drawn as an
  // L-shape (top + right edge only) so we don't have to fill the
  // front rect with the background color — important here because
  // the title bar is transparent over the blurred album art behind.
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path
        d="M2.5 0.5 H9.5 V7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <rect
        x="0.5"
        y="2.5"
        width="7"
        height="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
