import type { ArtistPage, Shelf } from "./types";
import {
  collectShelfNodes,
  mapShelfWrapper,
  rawBrowse,
  readRuns,
  readThumbnails,
  type YtNode,
} from "./shared";

export async function fetchArtist(id: string): Promise<ArtistPage> {
  const json = await rawBrowse(id);

  const header =
    json?.header?.musicImmersiveHeaderRenderer ??
    json?.header?.musicDetailHeaderRenderer ??
    {};

  const name = readRuns(header.title);
  const description = readRuns(header.description);
  const subscribers = readRuns(header.subscriptionButton
    ?.subscribeButtonRenderer?.subscriberCountText ?? header.subtitle);
  const thumbnails = readThumbnails(
    header.thumbnail?.musicThumbnailRenderer?.thumbnail ??
      header.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail ??
      header.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail,
  );

  // Play and Start-radio are separate endpoints, and each may arrive as
  // either a playlist or a single video depending on the artist. Keeping
  // both shapes distinct matters: a playlist id has to go through /next
  // to become a queue, while a video id can be played directly.
  const radioEndpoint = readWatchEndpoint(header.startRadioButton);
  const shuffleEndpoint = readWatchEndpoint(header.playButton);

  const tabs: YtNode[] =
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs ?? [];
  const sections: YtNode[] =
    tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const shelfNodes = collectShelfNodes(sections);

  const shelves: Shelf[] = [];
  shelfNodes.forEach((wrapper, i) => {
    const { title, items, display } = mapShelfWrapper(wrapper, i);
    if (items.length === 0) return;
    shelves.push({ id: `${title}-${i}`, title, items, display });
  });

  return {
    id,
    name,
    description: description || undefined,
    subscribers: subscribers || undefined,
    thumbnails,
    radioEndpoint,
    shuffleEndpoint,
    shelves,
  };
}

/**
 * Pull the playlist/video pair out of a header button, whichever of the
 * two watch-endpoint shapes YouTube used. Returns undefined when the
 * button carries neither, so callers can hide the action instead of
 * rendering a control that cannot do anything.
 */
function readWatchEndpoint(
  button: YtNode | undefined,
): ArtistPage["radioEndpoint"] {
  const endpoint =
    button?.buttonRenderer?.navigationEndpoint ??
    button?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const playlistId: string | undefined =
    endpoint?.watchPlaylistEndpoint?.playlistId ??
    endpoint?.watchEndpoint?.playlistId;
  const videoId: string | undefined = endpoint?.watchEndpoint?.videoId;
  if (!playlistId && !videoId) return undefined;
  return { playlistId, videoId };
}
