import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookmarkIcon,
  BookmarkMinusIcon,
  LinkIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RadioIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DeletePlaylistDialog,
  EditPlaylistDialog,
} from "@/components/shared/playlist-dialogs";
import {
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
  type PlaylistPrivacy,
} from "@/lib/innertube/mutations";
import { fetchWatchQueue } from "@/lib/innertube/radio";
import { normalizePlaylistId, useSavedLibraryIds } from "@/lib/library-membership";
import { usePlaybackStore } from "@/lib/store/playback";
import { copyToClipboard, playlistUrl } from "@/lib/share";

/**
 * Overflow menu for a playlist or album page: library membership, radio,
 * owner-only editing, and a shareable link.
 *
 * `editable` gates rename/delete because only the owner may issue those
 * edits, and library save/unsave is hidden for owned playlists — YouTube
 * treats your own playlists as permanently in your library, so offering
 * "Save" there would be a button that does nothing visible.
 */
export function PlaylistActionsMenu({
  playlistId,
  libraryId,
  title,
  description,
  privacy,
  editable = false,
  onDeleted,
}: {
  /**
   * The id the mutations act on: bare or VL-prefixed for a playlist,
   * the `OLAK5uy_…` audio playlist for an album.
   */
  playlistId: string;
  /**
   * The id the library shelves list this entity under, when it differs
   * from `playlistId`. Albums are saved by their audio playlist but
   * *listed* by their `MPREb_…` browse id, so without this an album
   * would read as unsaved no matter how many times it was saved.
   */
  libraryId?: string;
  title: string;
  description?: string;
  privacy?: PlaylistPrivacy;
  editable?: boolean;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const bareId = normalizePlaylistId(playlistId);
  const { ids: savedIds, loaded: savedLoaded } = useSavedLibraryIds();
  const saved = savedIds.has(normalizePlaylistId(libraryId ?? playlistId));

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (saved) {
        await removePlaylistFromLibrary(bareId);
        toast.success("Removed from library");
      } else {
        await savePlaylistToLibrary(bareId);
        toast.success(`Saved “${title}” to your library`);
      }
      await qc.invalidateQueries({ queryKey: ["library"] });
    } catch (e) {
      toast.error(`Couldn't update library: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startRadio = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // `RDAMPL…` is YouTube's playlist-seeded station. Unlike song radio
      // there is no separate seed track to prepend, so the panel is the
      // whole queue.
      const tracks = await fetchWatchQueue(`RDAMPL${bareId}`);
      if (tracks.length === 0) {
        toast.error("No radio available for this playlist.");
        return;
      }
      usePlaybackStore.getState().playShelfItems(tracks, 0);
    } catch (e) {
      toast.error(`Couldn't start radio: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const ok = await copyToClipboard(playlistUrl(bareId));
    if (ok) toast.success("Link copied");
    else toast.error("Couldn't copy the link");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            {busy ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <MoreHorizontalIcon />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* Hidden until the library list has actually loaded, so the
              item never shows "Save" for something already saved. */}
          {!editable && savedLoaded ? (
            <DropdownMenuItem onSelect={() => void toggleLibrary()}>
              {saved ? <BookmarkMinusIcon /> : <BookmarkIcon />}
              {saved ? "Remove from library" : "Save to library"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void startRadio()}>
            <RadioIcon />
            Start radio
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <LinkIcon />
            Copy link
          </DropdownMenuItem>

          {editable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <PencilIcon />
                Edit details…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2Icon />
                Delete playlist
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {editable ? (
        <>
          <EditPlaylistDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            playlistId={bareId}
            currentTitle={title}
            currentDescription={description}
            currentPrivacy={privacy}
          />
          <DeletePlaylistDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            playlistId={bareId}
            title={title}
            onDeleted={onDeleted}
          />
        </>
      ) : null}
    </>
  );
}
