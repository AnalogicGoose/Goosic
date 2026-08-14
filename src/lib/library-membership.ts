import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchLibraryAlbums,
  fetchLibraryArtists,
  fetchLibraryPlaylists,
  type LibrarySection,
} from "@/lib/innertube/library";
import { fetchUserPlaylists } from "@/lib/innertube/mutations";

/**
 * "Is this already in my library?" for playlists, albums, and artists.
 *
 * These read the same `["library", …]` query caches the Library route
 * already fills, so opening a playlist or artist page costs no extra
 * request once the user has visited Library — and a save/follow mutation
 * only has to invalidate the one key both consumers share.
 */

/** Playlist browse ids arrive either bare (`PL…`) or VL-wrapped (`VLPL…`). */
export function normalizePlaylistId(id: string): string {
  return id.startsWith("VL") ? id.slice(2) : id;
}

function idSet(sections: LibrarySection[] | undefined, kinds: string[]) {
  const set = new Set<string>();
  for (const section of sections ?? []) {
    for (const item of section.items) {
      if (!kinds.includes(item.kind)) continue;
      set.add(normalizePlaylistId(item.id));
    }
  }
  return set;
}

/**
 * Ids of everything saved in the library that the playlist-rating
 * mutations can add or remove: followed playlists and saved albums.
 *
 * Both shelves are needed. Albums are saved through the same `like/*`
 * endpoint as playlists, but they are *listed* in the albums shelf, so
 * reading only `FEmusic_liked_playlists` would report every saved album
 * as unsaved and offer "Save to library" forever.
 *
 * Note the ids in this set are the ids each shelf reports — an album
 * appears under its `MPREb_…` browse id, not its `OLAK5uy_…` audio
 * playlist id. Callers must look up an album by the same browse id they
 * navigated with, which is why `PlaylistActionsMenu` takes a separate
 * `libraryId`.
 */
export function useSavedLibraryIds() {
  const playlists = useQuery({
    queryKey: ["library", "playlists"],
    queryFn: fetchLibraryPlaylists,
    staleTime: 60_000,
    retry: false,
  });
  const albums = useQuery({
    queryKey: ["library", "albums"],
    queryFn: fetchLibraryAlbums,
    staleTime: 60_000,
    retry: false,
  });

  return useMemo(() => {
    const ids = idSet(playlists.data, ["playlist", "album"]);
    for (const id of idSet(albums.data, ["playlist", "album"])) ids.add(id);
    return { ids, loaded: playlists.isSuccess && albums.isSuccess };
  }, [playlists.data, playlists.isSuccess, albums.data, albums.isSuccess]);
}

/** Ids of the artists the account follows. */
export function useFollowedArtistIds() {
  const artists = useQuery({
    queryKey: ["library", "artists"],
    queryFn: fetchLibraryArtists,
    staleTime: 60_000,
    retry: false,
  });

  return useMemo(
    () => ({
      ids: idSet(artists.data, ["artist"]),
      loaded: artists.isSuccess,
    }),
    [artists.data, artists.isSuccess],
  );
}

/**
 * Ids of the playlists this account *owns* — the only ones that can be
 * renamed or deleted. Everything else is somebody else's playlist, which
 * we can save or unsave but never edit.
 */
export function useOwnedPlaylistIds() {
  const owned = useQuery({
    queryKey: ["user-playlists"],
    queryFn: fetchUserPlaylists,
    staleTime: 60_000,
    retry: false,
  });

  return useMemo(
    () => ({
      ids: new Set((owned.data ?? []).map((p) => normalizePlaylistId(p.id))),
      loaded: owned.isSuccess,
    }),
    [owned.data, owned.isSuccess],
  );
}
