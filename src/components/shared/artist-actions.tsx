import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  LinkIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  RadioIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  subscribeToArtist,
  unsubscribeFromArtist,
} from "@/lib/innertube/mutations";
import { fetchRadio, fetchWatchQueue, newRadioTracks } from "@/lib/innertube/radio";
import { useFollowedArtistIds } from "@/lib/library-membership";
import { usePlaybackStore } from "@/lib/store/playback";
import { artistUrl, copyToClipboard } from "@/lib/share";
import type { ArtistPage } from "@/lib/innertube/types";

/**
 * Follow toggle plus the artist overflow menu. Sits in the entity
 * header's `actions` slot alongside Play/Shuffle.
 */
export function ArtistActions({ artist }: { artist: ArtistPage }) {
  const qc = useQueryClient();
  const { ids: followed, loaded } = useFollowedArtistIds();
  const isFollowing = followed.has(artist.id);
  const [busy, setBusy] = useState(false);
  const [radioBusy, setRadioBusy] = useState(false);

  const toggleFollow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isFollowing) {
        await unsubscribeFromArtist(artist.id);
        toast.success(`Unfollowed ${artist.name}`);
      } else {
        await subscribeToArtist(artist.id);
        toast.success(`Following ${artist.name}`);
      }
      await qc.invalidateQueries({ queryKey: ["library"] });
    } catch (e) {
      toast.error(`Couldn't update follow: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startRadio = async () => {
    if (radioBusy) return;
    setRadioBusy(true);
    try {
      const endpoint = artist.radioEndpoint;
      let tracks = endpoint?.playlistId
        ? await fetchWatchQueue(endpoint.playlistId, endpoint.videoId)
        : [];
      if (tracks.length === 0 && endpoint?.videoId) {
        // A seed-video-only header still gives a real station through the
        // same path song radio uses, deduped the same way.
        const radio = await fetchRadio(endpoint.videoId);
        tracks = newRadioTracks(radio.tracks, []);
      }
      if (tracks.length === 0) {
        toast.error("No radio available for this artist.");
        return;
      }
      usePlaybackStore.getState().playShelfItems(tracks, 0);
    } catch (e) {
      toast.error(`Couldn't start radio: ${String(e)}`);
    } finally {
      setRadioBusy(false);
    }
  };

  const copyLink = async () => {
    const ok = await copyToClipboard(artistUrl(artist.id));
    if (ok) toast.success("Link copied");
    else toast.error("Couldn't copy the link");
  };

  return (
    <>
      {/* Rendered only once the followed-artists list is in hand, so the
          button never claims "Follow" for an artist already followed. */}
      {loaded ? (
        <Button
          variant="outline"
          onClick={() => void toggleFollow()}
          disabled={busy}
          aria-pressed={isFollowing}
        >
          {busy ? (
            <Loader2Icon className="animate-spin" />
          ) : isFollowing ? (
            <CheckIcon />
          ) : (
            <PlusIcon />
          )}
          {isFollowing ? "Following" : "Follow"}
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            {radioBusy ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <MoreHorizontalIcon />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {artist.radioEndpoint ? (
            <DropdownMenuItem onSelect={() => void startRadio()}>
              <RadioIcon />
              Start radio
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <LinkIcon />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
