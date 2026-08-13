import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMacOSWebview } from "@/lib/platform";

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
 * the real traffic lights. The shared HTML strip supplies the drag region on
 * every platform and holds nothing else: history navigation and the sidebar
 * toggle were removed with the More menu. The sidebar still collapses with
 * ⌘/Ctrl+B, which `SidebarProvider` binds.
 *
 * Both AppKit's native close control and Goosic's custom close button go
 * through the Rust `WindowEvent::CloseRequested` handler, which either hides
 * the window into the tray (default) or quits, per the "Close to tray" choice
 * in Settings. "Quit Goosic" there, and the tray's own Quit item, always
 * terminate the process regardless of that setting.
 */
export function TopBar() {
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
      {/* Overlaid rather than in flex flow. Holding a row in the column left a
          36px band of window background above the content — the "black bar"
          once the buttons were gone. As an overlay the page runs to the top of
          the window and scrolls beneath this strip.

          It cannot simply be deleted: `decorations: false` means the window is
          frameless, so `data-tauri-drag-region` is the only thing that can move
          it. The cost is that the top 36px drags instead of clicking through,
          which is how a frameless title bar behaves anyway. */}
      <header
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-30 flex h-(--titlebar-h) select-none items-center"
      >
        {/* Nothing but a drag region now. The sidebar runs to the top of the
            window behind this strip, so the user can grab anywhere along it to
            move the window without the sidebar swallowing the gesture. */}
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
