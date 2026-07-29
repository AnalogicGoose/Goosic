import type { ShelfItem } from "./types";
import { mapPlaylistPanelVideo, rawNext, type YtNode } from "./shared";

/**
 * Fetch a radio station seeded on a single videoId.
 * Equivalent to what YTM does when you click "Start radio" — /next with
 * playlistId `RDAMVM<videoId>` gives back a `playlistPanelRenderer` full
 * of similar tracks.
 *
 * Returns the seed track followed by ~24 recommended tracks, plus a
 * continuation token that pages *the same station* — the key to matching
 * YouTube Music. Paging a station keeps every subsequent batch anchored to
 * the original seed; re-seeding on the latest track instead makes the genre
 * random-walk away from what the user started with.
 */
export type RadioPage = {
  tracks: ShelfItem[];
  /** Token for the next page of this same station, if any remain. */
  continuation?: string;
};

/**
 * Locate the `playlistPanelRenderer` (initial /next) or
 * `playlistPanelContinuation` (continuation /next) node that holds the
 * radio queue rows and its own continuation pointer.
 */
function locatePanel(json: YtNode): YtNode | undefined {
  const initial =
    json?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer;
  if (initial) return initial;
  return json?.continuationContents?.playlistPanelContinuation;
}

/** Pull the queue rows out of a resolved panel node. */
function panelTracks(panel: YtNode | undefined): ShelfItem[] {
  const contents: YtNode[] = panel?.contents ?? [];
  const tracks: ShelfItem[] = [];
  for (const c of contents) {
    // YTM wraps rows that have both a song and a music-video version in a
    // playlistPanelVideoWrapperRenderer; the real row is under primaryRenderer.
    const row =
      c.playlistPanelVideoRenderer ??
      c.playlistPanelVideoWrapperRenderer?.primaryRenderer
        ?.playlistPanelVideoRenderer;
    if (!row) continue;
    const mapped = mapPlaylistPanelVideo(row);
    if (mapped) tracks.push(mapped);
  }
  return tracks;
}

/**
 * Read the next-page token from a panel's own `continuations` array. This is
 * read from the panel specifically — not from a whole-response walk — so we
 * never grab a token belonging to a sibling tab (related, lyrics, etc.) that
 * would not extend the radio.
 */
function panelContinuation(panel: YtNode | undefined): string | undefined {
  const conts: YtNode[] | undefined = panel?.continuations;
  if (!Array.isArray(conts)) return undefined;
  for (const c of conts) {
    const token: string | undefined =
      c?.nextRadioContinuationData?.continuation ??
      c?.nextContinuationData?.continuation;
    if (token) return token;
  }
  return undefined;
}

export async function fetchRadio(videoId: string): Promise<RadioPage> {
  const json = await rawNext({
    videoId,
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true,
  });
  const panel = locatePanel(json);
  const page = { tracks: panelTracks(panel), continuation: panelContinuation(panel) };
  if (import.meta.env.DEV) {
    console.debug(
      "[radio] seed=",
      videoId,
      "tracks=",
      page.tracks.length,
      "cont=",
      page.continuation ? "yes" : "no",
    );
  }
  return page;
}

/**
 * Page an existing radio station via its continuation token. Keeps the
 * station anchored to its original seed instead of re-seeding on the latest
 * track, which is what stops radio from drifting off-genre over a long queue.
 */
export async function fetchRadioContinuation(
  token: string,
): Promise<RadioPage> {
  const json = await rawNext({ continuation: token });
  const panel = locatePanel(json);
  const page = { tracks: panelTracks(panel), continuation: panelContinuation(panel) };
  if (import.meta.env.DEV) {
    console.debug(
      "[radio] continuation tracks=",
      page.tracks.length,
      "cont=",
      page.continuation ? "yes" : "no",
    );
  }
  return page;
}

/**
 * Build a play queue from a watch-playlist id — the kind the search
 * top-result card's Shuffle / Play button hands us: an artist shuffle
 * radio (`RDAO…`), an album (`OLAK…`), or a community playlist (`VL…` /
 * `RDCLAK…`). /next expands it into a `playlistPanelRenderer` of tracks.
 */
export async function fetchWatchQueue(
  playlistId: string,
  videoId?: string,
): Promise<ShelfItem[]> {
  const body: Record<string, unknown> = { playlistId, isAudioOnly: true };
  if (videoId) body.videoId = videoId;
  return panelTracks(locatePanel(await rawNext(body)));
}
