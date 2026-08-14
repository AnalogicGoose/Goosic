import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import {
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  setPlaylistDescription,
  setPlaylistPrivacy,
  type PlaylistPrivacy,
  type UserPlaylist,
} from "@/lib/innertube/mutations";
import {
  notePlaylistCreated,
  notePlaylistDeleted,
  USER_PLAYLISTS_KEY,
} from "@/lib/playlist-library-cache";
import { cn } from "@/lib/utils";

const PRIVACY_OPTIONS: { value: PlaylistPrivacy; label: string }[] = [
  { value: "PRIVATE", label: "Private" },
  { value: "UNLISTED", label: "Unlisted" },
  { value: "PUBLIC", label: "Public" },
];

/**
 * Every playlist mutation touches the same three caches: the sidebar and
 * Library grid read `["library", …]`, the "Add to playlist" submenu reads
 * `["user-playlists"]`, and an open playlist route reads
 * `["playlist-pages", id]`. Invalidating them together is what makes the
 * change appear everywhere at once rather than after a navigation.
 */
function usePlaylistCacheRefresh() {
  const qc = useQueryClient();
  return async (
    playlistId?: string,
    /**
     * A create/delete that just happened. YouTube's library index is
     * eventually consistent, so the refetch below often still answers from a
     * pre-mutation snapshot; recording the edit first keeps the change on
     * screen instead of letting that stale response overwrite it.
     */
    edit?:
      | { type: "created"; playlist: UserPlaylist }
      | { type: "deleted"; playlistId: string },
  ) => {
    if (edit?.type === "created") notePlaylistCreated(qc, edit.playlist);
    if (edit?.type === "deleted") notePlaylistDeleted(qc, edit.playlistId);
    await Promise.all([
      qc.invalidateQueries({ queryKey: USER_PLAYLISTS_KEY }),
      qc.invalidateQueries({ queryKey: ["library"] }),
      playlistId
        ? qc.invalidateQueries({ queryKey: ["playlist-pages"] })
        : Promise.resolve(),
    ]);
  };
}

/** Textarea styled to match `<Input>`; there is no textarea primitive yet. */
function DescriptionField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={3}
      placeholder="Description (optional)"
      className={cn(
        "w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow]",
        "placeholder:text-muted-foreground dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      )}
    />
  );
}

/**
 * Create an empty playlist. Until now a playlist could only be created
 * from a track's context menu, so making one to fill in later meant
 * leaving for the browser (issue #7).
 */
export function CreatePlaylistDialog({
  open,
  onOpenChange,
  onCreated,
  defaultTitle = "",
  videoIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new playlistId — used to navigate straight to it. */
  onCreated?: (playlistId: string) => void;
  defaultTitle?: string;
  /** Seed tracks. Omit for an empty playlist. */
  videoIds?: string[];
}) {
  const refresh = usePlaylistCacheRefresh();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<PlaylistPrivacy>("PRIVATE");
  const [busy, setBusy] = useState(false);
  const seeded = (videoIds?.length ?? 0) > 0;

  // Seed the fields on the *transition* into open, never afterwards. The
  // queue's default title is derived from the currently playing track, so
  // depending on `defaultTitle` here would wipe whatever the user had
  // typed the moment playback advanced to the next song.
  const latestDefaultTitle = useRef(defaultTitle);
  latestDefaultTitle.current = defaultTitle;
  useEffect(() => {
    if (!open) return;
    setTitle(latestDefaultTitle.current);
    setDescription("");
    setPrivacy("PRIVATE");
  }, [open]);

  const submit = async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const id = await createPlaylist(name, {
        description: description.trim() || undefined,
        privacy,
        videoIds,
      });
      await refresh(undefined, {
        type: "created",
        playlist: {
          id,
          title: name,
          subtitle: videoIds?.length
            ? `${videoIds.length} ${videoIds.length === 1 ? "song" : "songs"}`
            : undefined,
        },
      });
      toast.success(`Created “${name}”`);
      onOpenChange(false);
      onCreated?.(id);
    } catch (e) {
      toast.error(`Create failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
          <DialogDescription>
            {seeded
              ? `${videoIds!.length} ${
                  videoIds!.length === 1 ? "track" : "tracks"
                } will be added in their current order.`
              : "Starts empty. Add songs from any track menu once it exists."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="Playlist name"
            disabled={busy}
          />
          <DescriptionField
            value={description}
            onChange={setDescription}
            disabled={busy}
          />
          <SegmentedControl
            value={privacy}
            onChange={setPrivacy}
            options={PRIVACY_OPTIONS}
            disabled={busy}
            fullWidth
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
          >
            {busy && <Loader2Icon className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rename / re-describe / re-scope a playlist the account owns. Each field
 * is sent only when it actually changed, so opening the dialog and
 * pressing Save is a no-op rather than three redundant edits.
 *
 * `privacy` is optional because it is only known for editable playlists;
 * when YouTube didn't tell us the current visibility, the control is
 * hidden rather than defaulted to a guess that would silently change it.
 */
export function EditPlaylistDialog({
  open,
  onOpenChange,
  playlistId,
  currentTitle,
  currentDescription,
  currentPrivacy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  playlistId: string;
  currentTitle: string;
  currentDescription?: string;
  currentPrivacy?: PlaylistPrivacy;
}) {
  const refresh = usePlaylistCacheRefresh();
  const [title, setTitle] = useState(currentTitle);
  const [description, setDescription] = useState(currentDescription ?? "");
  const [privacy, setPrivacy] = useState<PlaylistPrivacy | undefined>(
    currentPrivacy,
  );
  const [busy, setBusy] = useState(false);

  /**
   * The values as they were when the dialog opened. Kept as state rather
   * than read from props at submit time for two reasons: these props come
   * from a live query, so a background refetch mid-edit would both wipe
   * the user's typing and shift the baseline the "did this change?"
   * comparison is made against.
   */
  const [seed, setSeed] = useState({
    title: currentTitle,
    description: currentDescription ?? "",
    privacy: currentPrivacy,
  });
  const latestCurrent = useRef(seed);
  latestCurrent.current = {
    title: currentTitle,
    description: currentDescription ?? "",
    privacy: currentPrivacy,
  };

  useEffect(() => {
    if (!open) return;
    const next = latestCurrent.current;
    setSeed(next);
    setTitle(next.title);
    setDescription(next.description);
    setPrivacy(next.privacy);
  }, [open]);

  const submit = async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      // Sequential, not parallel: these are three edits to one playlist,
      // and YouTube rejects concurrent edits to the same list often
      // enough that a partial failure would be hard to explain.
      if (name !== seed.title) await renamePlaylist(playlistId, name);
      if (description !== seed.description) {
        await setPlaylistDescription(playlistId, description);
      }
      if (privacy && privacy !== seed.privacy) {
        await setPlaylistPrivacy(playlistId, privacy);
      }
      await refresh(playlistId);
      toast.success("Playlist updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(`Update failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit playlist</DialogTitle>
          <DialogDescription>
            Changes apply to your YouTube Music account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="Playlist name"
            disabled={busy}
          />
          <DescriptionField
            value={description}
            onChange={setDescription}
            disabled={busy}
          />
          {privacy ? (
            <SegmentedControl
              value={privacy}
              onChange={setPrivacy}
              options={PRIVACY_OPTIONS}
              disabled={busy}
              fullWidth
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
          >
            {busy && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmation for an irreversible delete. */
export function DeletePlaylistDialog({
  open,
  onOpenChange,
  playlistId,
  title,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  playlistId: string;
  title: string;
  onDeleted?: () => void;
}) {
  const refresh = usePlaylistCacheRefresh();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deletePlaylist(playlistId);
      await refresh(playlistId, { type: "deleted", playlistId });
      toast.success(`Deleted “${title}”`);
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast.error(`Delete failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            This removes the playlist from your YouTube Music account. It can't
            be undone from Goosic.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy && <Loader2Icon className="animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
