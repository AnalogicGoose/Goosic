# Goosic ↔ YouTube Music feature-parity audit

Date: 2026-08-13. Audited against the working tree at `469135e`
(`v0.7.0 liquid glass, refined`).

This is a **code-verified** audit, not a reading of `CODEX_HANDOFF.md`. Every
"already complete" row below was confirmed by opening the implementing file.
Where the handoff document and the code disagreed, the code won.

## 0. Legend

| Status | Meaning |
| ------ | ------- |
| ✅ Complete | Shipped and functional |
| 🟡 Partial | Exists but materially narrower than YTM |
| ❌ Missing | No implementation |
| 🚫 Blocked | Provider/API/legal/platform prevents it |
| ➖ N/A | Deliberately out of scope for Goosic |

Layer column distinguishes *where* the gap is, per §32 of the request:
`UI` (backend exists, no surface), `BE` (needs a new InnerTube/Rust call),
`API` (YouTube exposes nothing usable), `AUTH`, `LEGAL`.

---

## 1. Feature matrix

### Playback and player

| Feature | Goosic | YTM equivalent | Layer | Feasibility | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Play/pause, prev/next, seek | ✅ | same | — | — | — | `store/playback.ts`, official WebPlayer transport |
| Shuffle / repeat (off/all/one) | ✅ | same | — | — | — | `setShuffle` Fisher-Yates on the tail only |
| Volume / mute | ✅ | same | — | — | — | Ceiling enforced on `HTMLMediaElement.prototype` |
| Like from player | ✅ | same | — | — | — | `like-buttons.tsx` |
| Song ↔ video source switch | ✅ | same | — | — | — | `innertube/alternate-source.ts`, `store/track-source.ts` |
| Synced lyrics | ✅ | same | — | — | — | LRCLIB + Musixmatch + Genius, `lyrics-view.tsx` |
| Immersive/fullscreen player | ✅ | same | — | — | — | `PlayerBar` `fullscreen` variant |
| Playback persistence across restart | ✅ | ➖ (web) | — | — | — | `partialize` persists queue + index |
| Ads honoured, never bypassed | ✅ | same | — | — | — | Deliberate; do not change |
| **Playback speed** | ❌ | ✅ (podcasts) | BE | Medium | Tier 4 | Only matters if long-form lands |
| **Skip ±10/30s** | ❌ | ✅ | UI | Easy | Tier 3 | Trivial once wanted |
| **Crossfade** | ❌ | ❌ | API | Blocked | — | One WebPlayer element; no second decoder |

### Queue

| Feature | Goosic | YTM | Layer | Feasibility | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Queue panel | ✅ | ✅ | — | — | — | `queue-panel.tsx` |
| Drag-to-reorder | ✅ | ✅ | — | — | — | Already implemented (`moveTrack`) |
| Remove track | ✅ | ✅ | — | — | — | `removeAt`, ad-locked |
| Clear queue | ✅ | ✅ | — | — | — | Header trash button |
| Play next / add to queue | ✅ | ✅ | — | — | — | `enqueueNext` / `enqueueEnd` |
| Autoplay / auto-radio extend | ✅ | ✅ | — | — | — | `autoRadio` + `setRadioStation` |
| **Save queue as playlist** | ❌ | ✅ | BE | Easy | **Tier 1** | Needs bulk `playlist/create` |
| **Shuffle queue (one-shot)** | 🟡 | ✅ | UI | Easy | Tier 2 | `setShuffle(true)` exists; no explicit action |
| **Undo removed track** | ❌ | ❌ | UI | Easy | Tier 3 | Nice-to-have |

### Library and playlists — **the largest gap, and GitHub issue #7**

| Feature | Goosic | YTM | Layer | Feasibility | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Library playlists/albums/artists/songs | ✅ | ✅ | — | — | — | `routes/library.tsx` |
| Liked songs (paged) | ✅ | ✅ | — | — | — | `LM` infinite query |
| Add track to playlist | ✅ | ✅ | — | — | — | `addToPlaylist` |
| Remove track from playlist | ✅ | ✅ | — | — | — | Exact `setVideoId` |
| Pin / hide playlists in sidebar | ✅ | ➖ | — | — | — | Goosic-specific |
| Premium playlist download | ✅ | ✅ | — | — | — | Explicit, entitlement-gated |
| **Create an empty playlist** | ❌ | ✅ | UI+BE | Easy | **Tier 1** | Only `createPlaylistWithTrack` exists — you must own a track to make a playlist. **This is issue #7.** |
| **Save someone else's playlist to library** | ❌ | ✅ | UI+BE | Easy | **Tier 1** | No "Add to library" anywhere. **This is issue #7.** |
| **Save an album to library** | ❌ | ✅ | UI+BE | Easy | **Tier 1** | Same mechanism |
| **Rename playlist** | ❌ | ✅ | UI+BE | Easy | **Tier 1** | `ACTION_SET_PLAYLIST_NAME` |
| **Edit description** | ❌ | ✅ | UI+BE | Easy | Tier 2 | `ACTION_SET_PLAYLIST_DESCRIPTION` |
| **Change privacy** | ❌ | ✅ | UI+BE | Easy | Tier 2 | `ACTION_SET_PLAYLIST_PRIVACY`. Handoff text tells users to "change that later on music.youtube.com" — that is the gap |
| **Delete playlist** | ❌ | ✅ | UI+BE | Easy | **Tier 1** | `playlist/delete` |
| **Reorder playlist tracks** | ❌ | ✅ | UI+BE | Medium | Tier 2 | `ACTION_MOVE_VIDEO_BEFORE` |
| **Duplicate playlist** | ❌ | ✅ | BE | Easy | Tier 3 | `playlist/create` + `sourcePlaylistId` |
| **Add whole playlist to queue** | 🟡 | ✅ | UI | Easy | Tier 2 | Play works; no non-destructive enqueue |
| **Change cover art** | ❌ | ✅ | API | Blocked | — | No InnerTube surface; YTM derives it |
| **Collaborative playlists** | ❌ | ✅ | API | Blocked | — | No usable InnerTube mutation. **Do not fake.** |

### Radio and recommendations

| Feature | Goosic | YTM | Layer | Feasibility | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Song radio | ✅ | ✅ | — | — | — | Track menu → Start radio, with dedupe + continuation |
| Endless auto-extend | ✅ | ✅ | — | — | — | `fetchRadioContinuation` |
| **Artist radio** | 🟡 | ✅ | UI | Easy | **Tier 1** | `fetchArtist` already parses `radioId`/`shuffleId` — **nothing consumes them** |
| **Playlist radio** | ❌ | ✅ | UI+BE | Easy | Tier 2 | `RDAMPL<id>` watch-queue seed |
| **Related songs / "next" panel** | ❌ | ✅ | UI | Medium | **Tier 1** | `fetchWatchQueue` exists; no Related tab in the player |
| **Custom mix builder** (sliders) | ❌ | 🟡 | API | Blocked | Tier 2 | InnerTube has no familiar/discover parameterisation. Would be a local re-rank of radio output — honest, but not YTM's feature. Defer, documented. |
| **Ask Goosic (NL discovery)** | ❌ | ✅ | API | Blocked | Tier 2 | No semantic endpoint. Doing this properly needs an LLM + embedding service Goosic does not ship. **Refusing to build a keyword box wearing an AI hat**, per §3 of the request. |
| **Taste Match / shared mixes** | ❌ | ✅ | AUTH+API | Blocked | — | Goosic has no server and no user-to-user identity |

### History, stats, recaps

| Feature | Goosic | YTM | Layer | Feasibility | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| "History" tab in queue | 🟡 | ✅ | BE | Medium | **Tier 1** | **Misleading name.** It is `queue.slice(0, index)` — the earlier part of the *current queue*. Clearing the queue erases it; a restart erases it. Not a listening history. |
| **Persisted listening history** | ❌ | ✅ | BE | Medium | **Tier 1** | Needs a new local play-log store with day bucketing |
| History actions (replay/enqueue/radio/remove/clear) | ❌ | ✅ | UI | Easy | Tier 2 | Follows the store |
| **Recaps (monthly/yearly)** | ❌ | ✅ | BE | Medium | Tier 2 | **No telemetry exists today, so no honest Recap can be built yet.** Correct order: land the play log first, let it accumulate, then compute. Fabricating stats is forbidden. |
| Listening badges | ❌ | ✅ | BE | Easy | Tier 4 | Depends on the same log |

### Entity pages

| Feature | Goosic | YTM | Layer | Feasibility | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Artist page shelves | ✅ | ✅ | — | — | — | `routes/artist.$id.tsx` |
| Artist top songs w/ play counts | ✅ | ✅ | — | — | — | `showPlays` |
| **Artist Play / Shuffle / Radio** | ❌ | ✅ | UI | Easy | **Tier 1** | Parser has the IDs; the page renders no action row at all |
| **Follow / subscribe artist** | ❌ | ✅ | UI+BE | Easy | **Tier 1** | `subscription/subscribe` |
| Album page + Play/Shuffle | ✅ | ✅ | — | — | — | `EntityHeader` `onPlay`/`onShuffle` |
| Album metadata (year/tracks/duration) | ✅ | ✅ | — | — | — | — |
| **Album radio / add to library** | ❌ | ✅ | UI+BE | Easy | **Tier 1** | — |
| **Explicit indicator** | ❌ | ✅ | BE | Easy | Tier 3 | Badge is in the payload, unparsed |
| Playlist page + download + sort | ✅ | ✅ | — | — | — | Richest page in the app |
| **Song credits sheet** | ❌ | ✅ | BE | Medium | Tier 2 | InnerTube exposes only a thin subset (artist/album/year/label). A "credits" panel showing four fields is weak; gate it on having real data |

### Song context menu (§4 of the request)

| Action | Goosic |
| --- | --- |
| Play / Play next / Add to queue | ✅ |
| Start radio | ✅ |
| Save / remove from Liked (live state) | ✅ |
| Not interested | ✅ |
| Add to playlist (+ New playlist…) | ✅ |
| Remove from playlist | ✅ (only on playlist routes, correct) |
| Go to artist / Go to album | ✅ |
| **View lyrics** | ❌ Tier 2 — lyrics exist, the menu doesn't jump to them |
| **View credits** | ❌ Tier 2 |
| **Share / Copy link** | ❌ **Tier 1** — trivial, and its absence is conspicuous |

So the menu is ~80% there. Only share/lyrics/credits are missing.

### Search

| Feature | Goosic | YTM | Layer | Priority | Notes |
| --- | --- | --- | --- | --- | --- |
| Categories (songs/artists/albums/playlists/videos) | ✅ | ✅ | — | — | `routes/search.tsx`, 941 lines |
| Recent searches + clear | ✅ | ✅ | — | — | `store/search-history.ts` |
| Suggestions | ✅ | ✅ | — | — | — |
| Top result | 🟡 | ✅ | UI | Tier 3 | Categories exist; no distinguished top card |
| Podcasts / profiles | ❌ | ✅ | — | Tier 4 | See below |
| Sound Search / humming | ❌ | ✅ | API | 🚫 | No public endpoint. Will not fake. |

### Desktop integration

| Feature | Goosic | Notes |
| --- | --- | --- |
| Windows SMTC + media keys | ✅ | `src-tauri/src/media.rs` |
| Tray, autostart, single instance | ✅ | — |
| Native notifications | ✅ | `playback-notifications.ts` |
| Mini player (floating window) | ✅ | Better than YTM web; native Liquid Glass on macOS 26+ |
| Discord Rich Presence | ✅ | Opt-in |
| Last.fm scrobbling + love sync | ✅ | — |
| Signed self-update | ✅ | — |
| **Keyboard shortcuts** | 🟡 | Only Space (play/pause) and Escape. No seek, mute, shuffle, repeat, Ctrl+K. **Tier 1**, cheap |
| **Always-on-top for mini player** | 🟡 | Verify the toggle is user-reachable |
| **macOS Now Playing (MPNowPlayingInfoCenter)** | ❌ | Tier 3 — Windows has SMTC, macOS has nothing |
| **Deep links** | ❌ | Tier 3 |
| **Casting / AirPlay / Chromecast** | ❌ 🚫 | Audio lives inside a WebView Goosic doesn't own the stream of. A Cast button would be a lie. **Excluded**, per §22 |

### Platform / content

| Feature | Goosic | Verdict |
| --- | --- | --- |
| Offline downloads | ✅ Premium playlists only | Deliberately narrow and entitlement-gated. Per-track download and Smart Downloads are **intentionally excluded** — they'd require caching outside the sanctioned path |
| **Local music library** | ❌ | Tier 3, genuinely feasible (Rust indexer + `HTMLAudioElement` via the existing loopback proxy). Already on `docs/feature-roadmap.md`. Big, self-contained project |
| **Playlist import/transfer** | ❌ | Tier 3. Local `.m3u`/CSV import + InnerTube search matching with confidence display is feasible. Third-party service migration is not (no OAuth). |
| **Podcasts** | ❌ | **Intentionally excluded.** Goosic's product intent is a music client; the WebPlayer transport has no resume-position model for long-form. Revisit only on explicit request |
| **Comments / fan communities** | ❌ | Excluded. §28's own bar ("legitimate authenticated access") isn't met, and it isn't a music feature |
| **Pre-save / release countdowns** | ❌ 🚫 | InnerTube exposes no pre-save mutation. New Releases page already exists |
| **Concerts / events** | ❌ 🚫 | Would require scraping ticketing. §11 forbids it |

---

## 2. Honest conclusions

Three things stand out from the audit:

1. **Goosic is much further along than the request assumes.** Radio, lyrics,
   queue drag-reorder, source switching, media keys, mini player, downloads,
   scrobbling, and a 941-line search page all already exist. Roughly two thirds
   of the request's 34 sections describe features that are already shipped.

2. **The real gaps cluster in library *mutation*, not discovery.** You can read
   almost everything and change almost nothing: no create-empty-playlist, no
   save-to-library, no rename, no delete, no follow. That is exactly what issue
   #7 reports, and it is the single most valuable thing to fix.

3. **The three headline "AI/social" asks are honestly blocked.** Ask Goosic,
   Taste Match, and custom-mix sliders all need infrastructure Goosic does not
   have (a semantic model, a server, cross-user identity). Per §3 and §32 they
   are documented and deferred rather than faked.

## 3. Implementation order

**Batch 1 — Library mutation (issue #7) + artist actions.** ← implemented first
Create empty playlist, save playlist/album to library, rename, delete, follow
artist, artist Play/Shuffle/Radio, share/copy link.

**Batch 2 — Persistent listening history.** Replace the misnamed queue-slice
History tab with a real persisted play log, day-bucketed, with actions. This
also lays the telemetry foundation Recaps require.

**Batch 3 — Related content + player Related tab, playlist radio, playlist
reorder/description/privacy, save queue as playlist, keyboard shortcuts.**

**Batch 4 — Recaps** (only once the play log has real data), credits,
explicit badges, top-result search card.

**Deferred with reasons documented above:** Ask Goosic, Taste Match, custom-mix
sliders, casting, collaborative playlists, pre-save, concerts, cover upload.

**Intentionally excluded:** podcasts, comments/fan communities, Smart
Downloads, Sound Search.
