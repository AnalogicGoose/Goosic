import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isMacOSWebview, isWindowsWebview } from "@/lib/platform";
import {
  clampGlassBlur,
  GLASS_BLUR_DEFAULT,
  GLASS_MATERIAL_DEFAULT,
  isVisualThemeId,
  migrateGlassMaterialId,
  type GlassMaterialId,
  type VisualThemeId,
} from "@/lib/themes";

export type CloseButtonAction = "tray" | "quit";
export type BackgroundMode = "ambient" | "plain";

type State = {
  /** What the title-bar ✕ does: hide to tray (default) or quit. */
  closeAction: CloseButtonAction;
  /** Window backdrop: "ambient" shows static blurred current-track artwork;
   *  "plain" keeps the flat theme background. The animated mesh is reserved
   *  for the immersive player and is not a preference. */
  background: BackgroundMode;
  /** The semantic visual child theme. Components consume the same token
   *  contract; this value only selects which token set is mounted. */
  visualTheme: VisualThemeId;
  /** Backdrop blur radius (px) of the shared glass material, via
   *  `--glass-blur` — the "Glass blur" slider. See `useGlassBlur`. */
  glassBlur: number;
  /** Which macOS system material the glass uses where WebKit hosts one
   *  (`-apple-visual-effect`). Ignored on platforms without it, which keep
   *  `glassBlur`. See `useGlassMaterial`. */
  glassMaterial: GlassMaterialId;
  /**
   * Drop the most expensive optical passes from the Windows glass renderer.
   *
   * Only the SVG renderer is affected — macOS draws a real system material and
   * the Classic (`blur-*`) stops already take a plain CSS blur, so neither has
   * anything to trade. On Windows the full material is a 45-primitive filter
   * graph re-evaluated as a `backdrop-filter` every time the backdrop moves,
   * and Chromium runs reference filters on the CPU: it is the whole reason the
   * app can peg a core while the GPU idles. See `liquid-glass-defs.tsx`.
   *
   * Defaults on. The passes it removes are refinements — broad colour and
   * luminance contamination, chromatic splay, per-frame grain — and the
   * material still reads as glass without them, so paying that cost by default
   * is the wrong trade for anyone who has not asked for it.
   */
  glassPerformanceMode: boolean;
  /** System toast on track change while the app is in the background
   *  (see `lib/playback-notifications.ts`). */
  playbackNotifications: boolean;
  /** Broadcast the current track to Discord as a Rich Presence status
   *  ("Listening to Goosic"). Off by default — opt-in for privacy.
   *  The IPC worker lives in `src-tauri/src/discord.rs`. */
  discordRichPresence: boolean;
  /** Scrobble every played track to the connected Last.fm account. Only
   *  meaningful while `lastfmSessionKey` is set; connecting turns it on.
   *  The signed HTTP calls + offline retry queue live in
   *  `src-tauri/src/lastfm.rs`; the play-time timing that decides when to
   *  scrobble lives in `lib/lastfm-scrobbler.ts`. */
  lastfmEnabled: boolean;
  /** Last.fm session key: a permanent bearer credential for the connected
   *  account, or null when not connected. Passed to every scrobble call. */
  lastfmSessionKey: string | null;
  /** Display name of the connected Last.fm account, shown in Settings. */
  lastfmUsername: string | null;
  /** Last.fm profile avatar URL for the connected account (fetched from
   *  user.getInfo, purely cosmetic for the account card), or null. */
  lastfmAvatar: string | null;
  /** Mirror YouTube Music likes to Last.fm as Loved tracks. Separate from
   *  scrobbling and off by default: an opt-in, since people often keep their
   *  likes intentionally different per platform. See `lib/lastfm.ts`. */
  lastfmLoveSync: boolean;
  setCloseAction: (v: CloseButtonAction) => void;
  setBackground: (v: BackgroundMode) => void;
  setVisualTheme: (v: VisualThemeId) => void;
  setGlassBlur: (v: number) => void;
  setGlassMaterial: (v: GlassMaterialId) => void;
  setGlassPerformanceMode: (v: boolean) => void;
  setPlaybackNotifications: (v: boolean) => void;
  setDiscordRichPresence: (v: boolean) => void;
  setLastfmEnabled: (v: boolean) => void;
  setLastfmLoveSync: (v: boolean) => void;
  setLastfmAvatar: (v: string | null) => void;
  /** Store the account returned by the connect flow and enable scrobbling. */
  setLastfmSession: (username: string, sessionKey: string) => void;
  /** Forget the connected account and stop scrobbling. */
  clearLastfmSession: () => void;
};

/**
 * Persisted keys that no longer back a preference. Stripped on every hydration
 * path so an old install stops carrying values nothing reads.
 */
const RETIRED_SETTINGS = [
  "glassOpacity",
  "cacheAutoClean",
  "lastCacheCleanAt",
  "dynamicAlbumMesh",
] as const;

/**
 * Drop retired keys from a persisted settings object, returning a copy.
 *
 * Both hydration paths use this: `migrate`, which runs only on a version bump,
 * and `merge`, which runs on every hydration including the cross-window
 * `storage` rehydrate. Missing either one lets a stale value survive.
 */
export function stripRetiredSettings(
  persisted: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = { ...persisted };
  for (const key of RETIRED_SETTINGS) delete stripped[key];
  return stripped;
}

/**
 * General app preferences editable from the Settings page. Persisted
 * in localStorage like the other stores; anything Rust needs to act on
 * (close behavior) is mirrored over IPC by a sync hook rather than
 * read from disk on the Rust side.
 */
export const useSettingsStore = create<State>()(
  persist(
    (set) => ({
      closeAction: "tray",
      background: "ambient",
      visualTheme: "default",
      glassBlur: GLASS_BLUR_DEFAULT,
      glassMaterial: GLASS_MATERIAL_DEFAULT,
      glassPerformanceMode: true,
      playbackNotifications: false,
      discordRichPresence: false,
      lastfmEnabled: false,
      lastfmSessionKey: null,
      lastfmUsername: null,
      lastfmAvatar: null,
      lastfmLoveSync: false,
      setCloseAction: (closeAction) => set({ closeAction }),
      setBackground: (background) => set({ background }),
      setVisualTheme: (visualTheme) => set({ visualTheme }),
      setGlassBlur: (v) => set({ glassBlur: clampGlassBlur(v) }),
      setGlassMaterial: (glassMaterial) => set({ glassMaterial }),
      setGlassPerformanceMode: (glassPerformanceMode) =>
        set({ glassPerformanceMode }),
      setPlaybackNotifications: (playbackNotifications) =>
        set({ playbackNotifications }),
      setDiscordRichPresence: (discordRichPresence) =>
        set({ discordRichPresence }),
      setLastfmEnabled: (lastfmEnabled) => set({ lastfmEnabled }),
      setLastfmLoveSync: (lastfmLoveSync) => set({ lastfmLoveSync }),
      setLastfmAvatar: (lastfmAvatar) => set({ lastfmAvatar }),
      setLastfmSession: (lastfmUsername, lastfmSessionKey) =>
        set({ lastfmUsername, lastfmSessionKey, lastfmEnabled: true }),
      clearLastfmSession: () =>
        set({
          lastfmUsername: null,
          lastfmSessionKey: null,
          lastfmAvatar: null,
          lastfmEnabled: false,
          lastfmLoveSync: false,
        }),
    }),
    {
      name: "ytm-settings",
      version: 3,
      // Preferences that have been retired. They are stripped during hydration
      // so existing installs stop carrying values nothing reads any more.
      // `dynamicAlbumMesh` chose between the mesh and the blurred cover. The
      // latter is now the regular ambient treatment, while the mesh belongs
      // exclusively to the immersive player, so the stale toggle is ignored.
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== "object") {
          return persisted as State;
        }

        return stripRetiredSettings(
          persisted as Record<string, unknown>,
        ) as unknown as State;
      },
      // Old installs may have no visualTheme yet — or a since-retired id
      // (goosic/ocean/sunset/mono). `isVisualThemeId` now only accepts
      // default/modern, so any legacy or corrupted value falls back to the
      // current default rather than blocking hydration.
      merge: (persisted, current) => {
        const saved = stripRetiredSettings(
          (persisted ?? {}) as Record<string, unknown>,
        ) as Partial<State>;
        const value = saved?.visualTheme;
        const savedBlur = saved?.glassBlur;
        const savedMaterial = saved?.glassMaterial;
        return {
          ...current,
          ...saved,
          visualTheme: isVisualThemeId(value) ? value : current.visualTheme,
          // Missing on older installs; clamp anything out of range.
          glassBlur:
            typeof savedBlur === "number"
              ? clampGlassBlur(savedBlur)
              : current.glassBlur,
          glassMaterial:
            migrateGlassMaterialId(savedMaterial) ?? current.glassMaterial,
          // Absent on every install that predates the toggle, which is exactly
          // the population that should get it: they are the ones running the
          // full graph today.
          glassPerformanceMode:
            typeof saved?.glassPerformanceMode === "boolean"
              ? saved.glassPerformanceMode
              : current.glassPerformanceMode,
        };
      },
    },
  ),
);

// The main and floating-player windows are separate JS contexts sharing
// the `ytm-settings` localStorage key (same pattern as `ytm-layout`).
// Re-hydrate on the cross-window `storage` event so e.g. switching the
// Background mode in the main window restyles the floating player live.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "ytm-settings") {
      void useSettingsStore.persist.rehydrate();
    }
  });
}

/**
 * Mirror the persisted close-button preference into Rust, where the
 * actual `CloseRequested` handling lives (it must cover every close
 * path — title-bar ✕, Alt+F4, taskbar Close). Mounted once in
 * AppShell: pushes the persisted value right after launch, then again
 * on every change from the Settings page.
 */
export function useCloseBehaviorSync(): void {
  const closeAction = useSettingsStore((s) => s.closeAction);
  useEffect(() => {
    invoke("set_close_behavior", {
      quitOnClose: closeAction === "quit",
    }).catch(() => {
      /* plain-vite dev without a Tauri backend — nothing to sync */
    });
  }, [closeAction]);
}

/**
 * Select the platform optical renderer for interactive glass. Windows gets
 * the dimension-matched SVG refraction filter; macOS gets WKWebView's native
 * backdrop blur using the same small/medium frost tokens. Static glass stays
 * a separate no-blur construction, and Linux retains its opaque fallback.
 * Mounted in both AppShell and FloatingPlayerApp because they use separate
 * document contexts.
 */
export function useGlassPlatformClasses(): void {
  useEffect(() => {
    document.documentElement.classList.toggle(
      "liquid-refract",
      isWindowsWebview(),
    );
    document.documentElement.classList.toggle(
      "macos-backdrop-glass",
      isMacOSWebview(),
    );
  }, []);
}

/**
 * Mirror the Discord Rich Presence toggle into Rust, where the IPC worker
 * lives (`src-tauri/src/discord.rs`). Turning it off tells the worker to
 * clear the activity and disconnect; turning it on lets the audio engine's
 * push effect populate it on the next track / play-state change. Mounted
 * once in AppShell so the disable path fires even when nothing is playing.
 */
export function useDiscordPresenceSync(): void {
  const enabled = useSettingsStore((s) => s.discordRichPresence);
  useEffect(() => {
    invoke("discord_set_enabled", { enabled }).catch(() => {
      /* plain-vite dev without a Tauri backend — nothing to sync */
    });
  }, [enabled]);
}
