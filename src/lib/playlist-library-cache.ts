import type { QueryClient } from "@tanstack/react-query";
import type { LibrarySection } from "@/lib/innertube/library";
import type { UserPlaylist } from "@/lib/innertube/mutations";
import type { ShelfItem } from "@/lib/innertube/types";

/**
 * YouTube's library index (`FEmusic_liked_playlists`) is eventually consistent.
 * `playlist/create` returns the new id immediately, but a browse issued right
 * after it frequently still answers from a pre-mutation snapshot — and a
 * delete keeps returning the playlist that is already gone.
 *
 * Invalidating on its own is therefore not enough: the refetch succeeds, writes
 * the stale list back into the cache, and the sidebar / "Add to playlist" menu
 * keep showing the old set until the app is restarted.
 *
 * These helpers reconcile the two caches locally so the UI is correct the
 * instant the mutation returns, and keep that correction pinned across the
 * refetches that follow until the server's own answer agrees.
 */

/** Library shelves feeding the sidebar and the Library grid. */
export const LIBRARY_PLAYLISTS_KEY = ["library", "playlists"] as const;
/** Flat list feeding the "Add to playlist" submenu. */
export const USER_PLAYLISTS_KEY = ["user-playlists"] as const;

/** YouTube browse ids wrap a playlist id as `VL<id>`; compare the bare form. */
export function barePlaylistId(id: string): string {
  return id.replace(/^VL/, "");
}

function samePlaylist(a: string, b: string): boolean {
  return barePlaylistId(a) === barePlaylistId(b);
}

/**
 * The two independent library endpoints a correction has to outlive. They lag
 * separately, so a correction retired the moment one of them catches up can
 * still be overwritten by the other's stale answer.
 */
type CacheSource = "user-playlists" | "library-sections";
const ALL_SOURCES: CacheSource[] = ["user-playlists", "library-sections"];

/**
 * Playlists the user deleted whose absence the server has not caught up to,
 * and ones they created that it has not started reporting yet. Each carries
 * the set of endpoints that have confirmed it, so it is retired only once
 * every endpoint agrees — and a playlist deleted on another device cannot be
 * resurrected here forever.
 */
const pendingRemovals = new Map<string, Set<CacheSource>>();
const pendingAdditions = new Map<
  string,
  { playlist: UserPlaylist; confirmedBy: Set<CacheSource> }
>();

function isPendingRemoval(id: string): boolean {
  for (const removedId of pendingRemovals.keys()) {
    if (samePlaylist(id, removedId)) return true;
  }
  return false;
}

/**
 * Drop every outstanding correction.
 *
 * Called on sign-in/out and account or channel switches: these edits are
 * scoped to whoever made them, and a playlist created under one account must
 * never be injected into another account's library.
 */
export function resetPendingPlaylistEdits(): void {
  pendingRemovals.clear();
  pendingAdditions.clear();
}

/**
 * Retire the corrections this endpoint has caught up to. Only ever called with
 * a genuine server response: running it over already-corrected cached data
 * would retire a pending addition on the strength of our own seed, and the
 * next stale response would then drop the playlist again.
 *
 * A correction is removed only after *every* endpoint has confirmed it, so one
 * cache catching up early cannot strand the other with a stale answer.
 */
function retireSettledEdits(source: CacheSource, serverIds: string[]): void {
  for (const [pendingId, entry] of [...pendingAdditions]) {
    if (!serverIds.some((id) => samePlaylist(id, pendingId))) continue;
    entry.confirmedBy.add(source);
    if (ALL_SOURCES.every((s) => entry.confirmedBy.has(s))) {
      pendingAdditions.delete(pendingId);
    }
  }
  for (const [removedId, confirmedBy] of [...pendingRemovals]) {
    if (serverIds.some((id) => samePlaylist(id, removedId))) continue;
    confirmedBy.add(source);
    if (ALL_SOURCES.every((s) => confirmedBy.has(s))) {
      pendingRemovals.delete(removedId);
    }
  }
}

/**
 * Apply the outstanding local corrections to a flat list.
 *
 * `fromServer` marks a genuine fetch, which is the only case that may retire a
 * correction. Re-applying over cached data leaves the pending set untouched.
 */
export function reconcileUserPlaylists(
  fetched: UserPlaylist[],
  fromServer = true,
): UserPlaylist[] {
  if (fromServer) {
    retireSettledEdits(
      "user-playlists",
      fetched.map((playlist) => playlist.id),
    );
  }
  const visible = fetched.filter((playlist) => !isPendingRemoval(playlist.id));
  const missing = [...pendingAdditions.values()]
    .map((entry) => entry.playlist)
    .filter(
      (pending) =>
        !visible.some((playlist) => samePlaylist(playlist.id, pending.id)),
    );
  // Newly created playlists lead, matching YouTube's own recency ordering.
  return [...missing, ...visible];
}

/** The same reconciliation over the nested library-shelf shape. */
export function reconcileLibrarySections(
  fetched: LibrarySection[],
  fromServer = true,
): LibrarySection[] {
  if (fromServer) {
    retireSettledEdits(
      "library-sections",
      fetched.flatMap((section) => section.items.map((item) => item.id)),
    );
  }
  const sections = fetched.map((section) => ({
    ...section,
    items: section.items.filter((item) => !isPendingRemoval(item.id)),
  }));
  if (!pendingAdditions.size) return sections;

  const seeded: ShelfItem[] = [...pendingAdditions.values()]
    .map((entry) => entry.playlist)
    .filter(
      (pending) =>
        !sections.some((section) =>
          section.items.some((item) => samePlaylist(item.id, pending.id)),
        ),
    )
    .map((pending) => ({
      kind: "playlist",
      id: pending.id,
      title: pending.title,
      subtitle: pending.subtitle,
      thumbnails: pending.thumbnailUrl
        ? [{ url: pending.thumbnailUrl, width: 0, height: 0 }]
        : [],
    }));
  if (!seeded.length) return sections;

  // Prepend to the first shelf rather than inventing one, so the playlist
  // appears where the user expects instead of in a new unnamed group.
  if (!sections.length) {
    return [{ id: "playlists-0", title: "Playlists", items: seeded }];
  }
  return sections.map((section, index) =>
    index === 0
      ? { ...section, items: [...seeded, ...section.items] }
      : section,
  );
}

/**
 * Record a just-created playlist and correct the caches already in memory.
 *
 * Both fetchers apply the same reconciliation, so a refetch cannot undo this;
 * rewriting the cached data here is what makes the playlist appear
 * immediately, before any network round-trip resolves.
 */
export function notePlaylistCreated(
  qc: QueryClient,
  playlist: UserPlaylist,
): void {
  const bare = barePlaylistId(playlist.id);
  pendingRemovals.delete(bare);
  pendingAdditions.set(bare, { playlist, confirmedBy: new Set() });
  applyToCaches(qc);
}

/** The delete-side mirror of `notePlaylistCreated`. */
export function notePlaylistDeleted(qc: QueryClient, playlistId: string): void {
  const bare = barePlaylistId(playlistId);
  pendingAdditions.delete(bare);
  pendingRemovals.set(bare, new Set());
  applyToCaches(qc);
}

/**
 * Re-run the reconciliation over whatever is cached right now. The helpers are
 * idempotent — a pending addition already present in the data is skipped, and
 * a suppressed removal simply stays filtered — so applying twice is safe.
 */
function applyToCaches(qc: QueryClient): void {
  qc.setQueryData<UserPlaylist[]>(USER_PLAYLISTS_KEY, (old) =>
    old ? reconcileUserPlaylists(old, false) : old,
  );
  qc.setQueryData<LibrarySection[]>(LIBRARY_PLAYLISTS_KEY, (old) =>
    old ? reconcileLibrarySections(old, false) : old,
  );
}
