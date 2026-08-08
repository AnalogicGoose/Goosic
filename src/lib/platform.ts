let cachedIsLinuxWebview: boolean | null = null;
let cachedIsMacOSWebview: boolean | null = null;

/**
 * Development-only platform override, so the Windows SVG refraction renderer
 * and the macOS native material can be compared on one machine — the glass
 * work needs both side by side, and the two renderers are otherwise selected
 * purely by user agent.
 *
 * Set with `?platform=windows` (persists) or
 * `localStorage["goosic:force-platform"] = "windows" | "macos" | "linux"`;
 * `?platform=auto` clears it. Never consulted in a production build, so it
 * cannot change what real users get.
 */
export type ForcedPlatform = "windows" | "macos" | "linux";

const FORCE_PLATFORM_KEY = "goosic:force-platform";

function readForcedPlatform(): ForcedPlatform | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const isPlatform = (value: string | null): value is ForcedPlatform =>
    value === "windows" || value === "macos" || value === "linux";
  try {
    const requested = new URLSearchParams(window.location.search).get(
      "platform",
    );
    if (requested === "auto") window.localStorage.removeItem(FORCE_PLATFORM_KEY);
    else if (isPlatform(requested)) {
      window.localStorage.setItem(FORCE_PLATFORM_KEY, requested);
      return requested;
    }
    const stored = window.localStorage.getItem(FORCE_PLATFORM_KEY);
    return isPlatform(stored) ? stored : null;
  } catch {
    // Private-mode storage or a sandboxed WebView: fall back to the real UA.
    return null;
  }
}

const forcedPlatform = readForcedPlatform();

/** The active dev override, or `null` when platform detection is by user agent. */
export function getForcedPlatform(): ForcedPlatform | null {
  return forcedPlatform;
}

/**
 * True on the Linux Tauri build (WebKitGTK). WebKitGTK recognizes
 * `backdrop-filter` in `@supports` queries, but a large share of real
 * installs (software rendering, no DMA-BUF compositor) never actually
 * paint it — surfaces tuned around blur render as flat, near-transparent
 * panels with whatever's behind them bleeding through sharp instead of
 * blurred. There's no reliable CSS-only way to tell "the property is
 * recognized" apart from "it will actually render", so UI that depends on
 * blur to stay legible (see `glass-surface.ts`) checks this instead of
 * `supports-[backdrop-filter]`.
 */
export function isLinuxWebview(): boolean {
  if (forcedPlatform) return forcedPlatform === "linux";
  if (cachedIsLinuxWebview === null) {
    cachedIsLinuxWebview =
      /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
  }
  return cachedIsLinuxWebview;
}

/**
 * True on the Windows Tauri build (WebView2/Chromium). Chromium is the only
 * engine that renders SVG filters inside `backdrop-filter` (true liquid-glass
 * refraction); WebKit and WebKitGTK ignore them.
 */
export function isWindowsWebview(): boolean {
  if (forcedPlatform) return forcedPlatform === "windows";
  return /Windows NT/.test(navigator.userAgent);
}

/**
 * True when a Rust backend is actually reachable — i.e. this page is running
 * inside the Tauri shell rather than in a plain browser tab.
 *
 * Distinct from the OS checks above: those answer "which renderer", this one
 * answers "is there an IPC bridge at all". Opening the dev server directly in
 * Chrome is a normal thing to do while working on the frontend, and without
 * this every `invoke()` throws "Cannot read properties of undefined".
 */
export function hasTauriBackend(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

/** True for Tauri's WKWebView build on macOS (but not iPhone/iPad WebKit). */
export function isMacOSWebview(): boolean {
  if (forcedPlatform) return forcedPlatform === "macos";
  if (cachedIsMacOSWebview === null) {
    cachedIsMacOSWebview =
      /Macintosh|Mac OS X/.test(navigator.userAgent) &&
      !/iPhone|iPad|iPod/.test(navigator.userAgent);
  }
  return cachedIsMacOSWebview;
}

/**
 * Linux does not add rounded corners to undecorated Tauri windows for us.
 * Its native windows are transparent, so the frontend owns the clip.
 *
 * macOS is deliberately excluded: on macOS 26 (Tahoe) WKWebView, putting
 * `border-radius` + `overflow: hidden` on `#root` makes the compositor drop
 * the entire window's output — the app runs (JS, audio, network all fine)
 * but paints solid black. AppKit already rounds/clips decorated windows,
 * and the floating player gets its 16px radius natively from
 * `native_glass.rs`, so no CSS clip is needed there.
 */
export function usesRoundedNativeWindow(): boolean {
  // Deliberately the real user agent, not the dev override: a forced "linux"
  // would put the CSS clip on #root and black out the whole macOS window.
  return /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
}
