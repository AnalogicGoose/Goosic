import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";
import { fetchArtist } from "@/lib/innertube/artist";
import { EntityHeader } from "@/components/shared/entity-header";
import { ArtistActions } from "@/components/shared/artist-actions";
import { ShelfCarousel } from "@/components/shared/shelf-carousel";
import { TrackList } from "@/components/shared/track-list";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWatchQueue } from "@/lib/innertube/radio";
import { usePlaybackStore } from "@/lib/store/playback";
import type { Shelf, ShelfItem } from "@/lib/innertube/types";

export const Route = createFileRoute("/artist/$id")({
  component: ArtistPageView,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["artist", params.id],
      queryFn: () => fetchArtist(params.id),
    }),
});

function ArtistPageView() {
  const { id } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["artist", id],
    queryFn: () => fetchArtist(id),
  });

  // The top-songs shelf is already on the page, so Play can start
  // instantly from it instead of round-tripping through /next.
  const topSongs: ShelfItem[] = useMemo(() => {
    const listShelf = data?.shelves.find((s) => s.display === "list");
    return (listShelf?.items ?? []).filter((i) => i.kind === "song");
  }, [data?.shelves]);

  const shuffleEndpoint = data?.shuffleEndpoint;
  const canShuffle = Boolean(
    shuffleEndpoint?.playlistId ?? shuffleEndpoint?.videoId ?? topSongs.length,
  );

  const playTopSongs = () => {
    if (topSongs.length === 0) return;
    usePlaybackStore.getState().playShelfItems(topSongs, 0);
    usePlaybackStore.getState().setShuffle(false);
  };

  /** Fallback Play for artists whose page ships no top-songs list. */
  const shuffleEndpointPlay = shuffleEndpoint
    ? async () => {
        const tracks = await resolveEndpointQueue(shuffleEndpoint);
        if (tracks.length === 0) return;
        usePlaybackStore.getState().playShelfItems(tracks, 0);
        usePlaybackStore.getState().setShuffle(false);
      }
    : undefined;

  const shuffleArtist = async () => {
    // Prefer YouTube's own artist shuffle station; fall back to shuffling
    // the top songs we already have so the button is never a dead end.
    const tracks = shuffleEndpoint
      ? await resolveEndpointQueue(shuffleEndpoint)
      : [];
    const pool = tracks.length > 0 ? tracks : topSongs;
    if (pool.length === 0) return;
    const start = Math.floor(Math.random() * pool.length);
    usePlaybackStore.getState().playShelfItems(pool, start);
    usePlaybackStore.getState().setShuffle(true);
  };

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <AlertCircleIcon className="size-5 shrink-0 text-destructive" />
        <div className="flex flex-col gap-1">
          <span className="font-medium">Couldn't load artist</span>
          <span className="text-muted-foreground">
            {(error as Error).message}
          </span>
        </div>
      </div>
    );
  }

  if (isLoading || !data) return <ArtistSkeleton />;

  return (
    <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
      <EntityHeader
        title={data.name}
        subtitle={data.subscribers}
        description={data.description}
        thumbnails={data.thumbnails}
        round
        onPlay={topSongs.length > 0 ? playTopSongs : shuffleEndpointPlay}
        onShuffle={canShuffle ? shuffleArtist : undefined}
        actions={<ArtistActions artist={data} />}
      />

      {data.shelves.map((shelf) =>
        shelf.display === "list" ? (
          <ListShelf key={shelf.id} shelf={shelf} />
        ) : (
          <ShelfCarousel key={shelf.id} shelf={shelf} />
        ),
      )}
    </div>
  );
}

/**
 * Turn an artist header endpoint into a playable queue. A playlist id
 * has to be expanded through /next; a bare video id is already the whole
 * answer for a one-track start.
 */
async function resolveEndpointQueue(endpoint: {
  playlistId?: string;
  videoId?: string;
}): Promise<ShelfItem[]> {
  try {
    if (endpoint.playlistId) {
      return await fetchWatchQueue(endpoint.playlistId, endpoint.videoId);
    }
    if (endpoint.videoId) {
      return await fetchWatchQueue(`RDAMVM${endpoint.videoId}`, endpoint.videoId);
    }
  } catch {
    // Caller falls back to the top-songs shelf.
  }
  return [];
}

function ListShelf({ shelf }: { shelf: Shelf }) {
  const tracks = shelf.items.filter((i) => i.kind === "song");
  if (tracks.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="truncate px-1 text-xl font-semibold tracking-tight">
        {shelf.title}
      </h2>
      {/* Artist top-songs shelf doesn't carry duration in the YT
          payload, but does ship a play count — swap the columns. */}
      <TrackList tracks={tracks} showPlays />
    </section>
  );
}

function ArtistSkeleton() {
  return (
    <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <Skeleton className="size-40 rounded-full md:size-48" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
