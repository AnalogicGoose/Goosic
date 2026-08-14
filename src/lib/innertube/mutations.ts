import { innertubePost, collectShelfNodes, type YtNode } from "./shared";
import { fetchAllLibraryBrowseSections } from "./library-pagination";

/**
 * Mutating InnerTube actions (likes + playlist edits). All require the
 * authenticated cookie jar populated by Settings → Sign in; anonymous
 * calls succeed HTTP-wise but don't persist anywhere.
 */

export type LikeStatus = "LIKE" | "DISLIKE" | "INDIFFERENT";

async function rate(
  endpoint: "like/like" | "like/dislike" | "like/removelike",
  videoId: string,
): Promise<void> {
  try {
    const resp = await innertubePost(endpoint, { target: { videoId } });
    if (import.meta.env.DEV) {
      console.debug(`[mutations] ${endpoint} ${videoId} →`, resp);
    }
  } catch (e) {
    // Surface the body text from `innertubePost` (it embeds the
    // YouTube error JSON in the message) so a DevTools peek tells us
    // immediately whether it's auth, throttling, or a malformed body.
    console.error(`[mutations] ${endpoint} ${videoId} failed:`, e);
    throw e;
  }
}

export function likeTrack(videoId: string): Promise<void> {
  return rate("like/like", videoId);
}

export function dislikeTrack(videoId: string): Promise<void> {
  return rate("like/dislike", videoId);
}

/** Clear whatever rating the user has on a track (undo like OR dislike). */
export function removeRating(videoId: string): Promise<void> {
  return rate("like/removelike", videoId);
}

export type UserPlaylist = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  /** Best-effort track count string ("12 songs"); YTM doesn't always
   *  expose a numeric count in the library shelf. */
  subtitle?: string;
};

/**
 * Fetch only the playlists the current user has created (not ones they
 * follow). YTM surfaces them in the "Your playlists" / "Playlists"
 * shelf of the library browse response; followed playlists appear in a
 * separate shelf. We also filter out the auto-generated pseudo-entries
 * ("New playlist", "Episodes for later", etc.) since they aren't
 * editable via `browse/edit_playlist`.
 */
export async function fetchUserPlaylists(): Promise<UserPlaylist[]> {
  const sections = await fetchAllLibraryBrowseSections(
    "FEmusic_liked_playlists",
  );
  const out: UserPlaylist[] = [];
  for (const section of collectShelfNodes(sections)) {
    const shelf =
      section?.musicShelfRenderer ??
      section?.musicCarouselShelfRenderer ??
      section?.musicCardShelfRenderer;
    const items: YtNode[] = shelf?.items ?? shelf?.contents ?? [];
    for (const raw of items) {
      const r =
        raw?.musicTwoRowItemRenderer ?? raw?.musicResponsiveListItemRenderer;
      if (!r) continue;
      const browseId: string | undefined =
        r.navigationEndpoint?.browseEndpoint?.browseId ??
        r.menu?.menuRenderer?.items?.[0]?.menuNavigationItemRenderer
          ?.navigationEndpoint?.browseEndpoint?.browseId;
      // Only real user playlists have browseIds that start with "VL" —
      // which wraps a "PL..." playlistId. Pseudo-entries (liked songs
      // "LM", episodes, new-playlist placeholders) either lack this or
      // are not editable by the owner.
      if (!browseId?.startsWith("VLPL")) continue;
      const playlistId = browseId.slice(2);

      const title =
        readRun(r.title) ||
        r.accessibilityText ||
        readRun(
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text,
        ) ||
        "";
      if (!title) continue;

      const thumbs =
        r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
        r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
        [];
      const thumbnailUrl = thumbs[thumbs.length - 1]?.url;

      const subtitle =
        readRun(r.subtitle) ||
        readRun(
          r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text,
        );

      out.push({
        id: playlistId,
        title,
        thumbnailUrl,
        subtitle: subtitle || undefined,
      });
    }
  }
  // De-dupe on id — some responses include the same playlist in multiple
  // shelves (e.g. "Recently added" + "Your playlists").
  const seen = new Set<string>();
  const deduped = out.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  // Reconcile here rather than at each call site: YouTube's library index lags
  // a create/delete, so a browse issued right after one still answers from a
  // pre-mutation snapshot and would otherwise overwrite the change.
  const { reconcileUserPlaylists } =
    await import("@/lib/playlist-library-cache");
  return reconcileUserPlaylists(deduped);
}

function readRun(node: YtNode | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  // Some library shelves deliver the title as { simpleText } instead of
  // { runs }. Without this branch such a playlist reads as "" and is
  // silently dropped from the "Add to playlist" submenu.
  if (typeof node.simpleText === "string") return node.simpleText;
  const runs: YtNode[] = node.runs ?? [];
  return runs.map((r) => r.text ?? "").join("");
}

export async function addToPlaylist(
  playlistId: string,
  videoId: string,
): Promise<void> {
  const json = await innertubePost("browse/edit_playlist", {
    playlistId,
    actions: [{ action: "ACTION_ADD_VIDEO", addedVideoId: videoId }],
  });
  // edit_playlist returns HTTP 200 even when it rejects the edit (not the
  // owner, stale cookies, …) — surface the envelope status so the
  // optimistic "Added to <playlist>" toast doesn't lie.
  const status = json?.status as string | undefined;
  if (status && status !== "STATUS_SUCCEEDED") {
    throw new Error(`edit_playlist failed: ${status}`);
  }
}

/**
 * Remove one exact occurrence of a video from a playlist. `setVideoId` is an
 * opaque per-entry identifier supplied by playlist browse responses; using a
 * bare video ID would be ambiguous when a playlist contains duplicates.
 */
export async function removeFromPlaylist(
  playlistId: string,
  videoId: string,
  setVideoId: string,
): Promise<void> {
  const rawPlaylistId = playlistId.startsWith("VL")
    ? playlistId.slice(2)
    : playlistId;
  if (!rawPlaylistId || !videoId || !setVideoId) {
    throw new Error("Cannot remove playlist entry without exact identifiers");
  }

  const json = await innertubePost("browse/edit_playlist", {
    playlistId: rawPlaylistId,
    actions: [
      {
        action: "ACTION_REMOVE_VIDEO",
        removedVideoId: videoId,
        setVideoId,
      },
    ],
  });
  const status = json?.status as string | undefined;
  if (status && status !== "STATUS_SUCCEEDED") {
    throw new Error(`edit_playlist failed: ${status}`);
  }
}

export type PlaylistPrivacy = "PUBLIC" | "PRIVATE" | "UNLISTED";

/**
 * Browse IDs for playlists arrive VL-prefixed (`VLPL…`) while every
 * mutating endpoint wants the bare `PL…`. Normalizing in one place keeps
 * callers from having to know which shape they're holding.
 */
function barePlaylistId(playlistId: string): string {
  const bare = playlistId.startsWith("VL") ? playlistId.slice(2) : playlistId;
  if (!bare) throw new Error("Missing playlist id");
  return bare;
}

/**
 * `edit_playlist` answers HTTP 200 even when it refuses the edit (not the
 * owner, stale cookies, unsupported action). Every caller must check the
 * envelope status or the success toast lies.
 */
async function editPlaylist(
  playlistId: string,
  actions: Record<string, unknown>[],
): Promise<void> {
  const json = await innertubePost("browse/edit_playlist", {
    playlistId: barePlaylistId(playlistId),
    actions,
  });
  const status = json?.status as string | undefined;
  if (status && status !== "STATUS_SUCCEEDED") {
    throw new Error(`edit_playlist failed: ${status}`);
  }
}

/**
 * Create a playlist. With no `videoIds` this makes an *empty* playlist,
 * which is what the Library "New playlist" action needs — until now a
 * playlist could only be born attached to a track. `sourcePlaylistId`
 * asks YouTube to seed the new playlist from an existing one (duplicate).
 *
 * Returns the new playlistId so callers can navigate to it.
 */
export async function createPlaylist(
  title: string,
  options: {
    description?: string;
    privacy?: PlaylistPrivacy;
    videoIds?: string[];
    sourcePlaylistId?: string;
  } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    title,
    privacyStatus: options.privacy ?? "PRIVATE",
  };
  if (options.description) body.description = options.description;
  if (options.videoIds?.length) body.videoIds = options.videoIds;
  if (options.sourcePlaylistId) {
    body.sourcePlaylistId = barePlaylistId(options.sourcePlaylistId);
  }

  const json = await innertubePost("playlist/create", body);
  const id: string | undefined =
    (json?.playlistId as string | undefined) ??
    (json?.response?.playlistId as string | undefined);
  if (!id) throw new Error("Could not read new playlistId from response");
  return id;
}

/**
 * Create a brand-new private playlist containing the given track as
 * its first entry.
 */
export function createPlaylistWithTrack(
  title: string,
  videoId: string,
): Promise<string> {
  return createPlaylist(title, { videoIds: [videoId] });
}

/** Rename a playlist the current account owns. */
export function renamePlaylist(
  playlistId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Playlist name cannot be empty");
  return editPlaylist(playlistId, [
    { action: "ACTION_SET_PLAYLIST_NAME", playlistName: trimmed },
  ]);
}

/** Replace a playlist's description. An empty string clears it. */
export function setPlaylistDescription(
  playlistId: string,
  description: string,
): Promise<void> {
  return editPlaylist(playlistId, [
    {
      action: "ACTION_SET_PLAYLIST_DESCRIPTION",
      playlistDescription: description,
    },
  ]);
}

/** Change a playlist's visibility. */
export function setPlaylistPrivacy(
  playlistId: string,
  privacy: PlaylistPrivacy,
): Promise<void> {
  return editPlaylist(playlistId, [
    { action: "ACTION_SET_PLAYLIST_PRIVACY", playlistPrivacy: privacy },
  ]);
}

/**
 * Append every track of one playlist to another in a single edit, rather
 * than issuing one ACTION_ADD_VIDEO per track.
 */
export function addPlaylistToPlaylist(
  targetPlaylistId: string,
  sourcePlaylistId: string,
): Promise<void> {
  return editPlaylist(targetPlaylistId, [
    {
      action: "ACTION_ADD_PLAYLIST",
      addedFullListId: barePlaylistId(sourcePlaylistId),
    },
  ]);
}

/**
 * Permanently delete a playlist the current account owns. There is no
 * undo on YouTube's side, so callers must confirm first.
 */
export async function deletePlaylist(playlistId: string): Promise<void> {
  const json = await innertubePost("playlist/delete", {
    playlistId: barePlaylistId(playlistId),
  });
  const status = json?.status as string | undefined;
  if (status && status !== "STATUS_SUCCEEDED") {
    throw new Error(`playlist/delete failed: ${status}`);
  }
}

/**
 * Save someone else's playlist — or an album, via its `OLAK5uy_…` audio
 * playlist id — into the current account's library. YouTube Music models
 * this as a *rating* on the playlist rather than a library mutation, which
 * is why it reuses the same `like/*` endpoints as track likes.
 */
export function savePlaylistToLibrary(playlistId: string): Promise<void> {
  return ratePlaylist("like/like", playlistId);
}

/** Undo `savePlaylistToLibrary`. */
export function removePlaylistFromLibrary(playlistId: string): Promise<void> {
  return ratePlaylist("like/removelike", playlistId);
}

async function ratePlaylist(
  endpoint: "like/like" | "like/removelike",
  playlistId: string,
): Promise<void> {
  await innertubePost(endpoint, {
    target: { playlistId: barePlaylistId(playlistId) },
  });
}

/** Follow an artist. `channelId` is the artist page's `UC…` browse id. */
export function subscribeToArtist(channelId: string): Promise<void> {
  return setSubscription("subscription/subscribe", channelId);
}

/** Unfollow an artist. */
export function unsubscribeFromArtist(channelId: string): Promise<void> {
  return setSubscription("subscription/unsubscribe", channelId);
}

async function setSubscription(
  endpoint: "subscription/subscribe" | "subscription/unsubscribe",
  channelId: string,
): Promise<void> {
  if (!channelId) throw new Error("Missing channel id");
  await innertubePost(endpoint, { channelIds: [channelId] });
}
