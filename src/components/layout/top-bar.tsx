import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SearchIcon } from "lucide-react";
import { isMacOSWebview } from "@/lib/platform";
import { cn } from "@/lib/utils";

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
      <header className="group absolute inset-x-0 top-0 z-30 flex h-(--titlebar-h) select-none items-center">
        {/* The bar itself only materialises on approach, the way Apple Music's
            toolbar does: at rest the page runs uninterrupted to the top of the
            window, and the backing appears when the pointer is up here (or the
            field has focus) so the field has something to sit on. */}
        <div
          aria-hidden="true"
          className="topbar-backing pointer-events-none absolute inset-y-0 right-0 bg-background/55 opacity-0 backdrop-blur-md transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100"
        />

        {/* The drag region is split around the field rather than wrapping it:
            `data-tauri-drag-region` swallows pointer events from its children,
            so an input inside it could never be clicked or selected. */}
        <div data-tauri-drag-region className="h-full flex-1" />
        <TopBarSearch />
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

/**
 * The toolbar search field, in the place macOS apps put it. Submitting hands
 * off to /search, which owns the actual searching — history, suggestions,
 * filters and the scope toggle all stay there rather than being rebuilt in the
 * caption bar.
 *
 * Like the bar behind it, the field is nearly invisible at rest and firms up
 * on hover or focus, so it does not compete with the page for attention.
 */
function TopBarSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    void navigate({ to: "/search", search: { q, filter: "all" } });
    inputRef.current?.blur();
  };

  return (
    <form
      className="relative w-full max-w-md shrink"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        // Explicit rather than relying on a form's implicit submission: that
        // needs either a submit button or exactly one text field, and this
        // form has neither guaranteed across the three WebViews we ship on.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          submit();
        }}
        placeholder="Search"
        aria-label="Search"
        className={cn(
          "h-6.5 w-full rounded-full border border-transparent bg-foreground/8 pl-8.5 pr-3 text-[13px] outline-none",
          "placeholder:text-muted-foreground",
          "transition-colors duration-150",
          "hover:bg-foreground/12",
          "focus:border-foreground/20 focus:bg-foreground/15",
          // Safari paints its own clear affordance on type=search, which
          // collides with the pill's right edge.
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
    </form>
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
