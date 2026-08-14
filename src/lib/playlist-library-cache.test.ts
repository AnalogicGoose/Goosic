import { beforeEach, describe, expect, it } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  barePlaylistId,
  notePlaylistCreated,
  notePlaylistDeleted,
  reconcileLibrarySections,
  reconcileUserPlaylists,
  resetPendingPlaylistEdits,
} from "./playlist-library-cache";
import type { LibrarySection } from "./innertube/library";
import type { UserPlaylist } from "./innertube/mutations";

// The note* helpers take a QueryClient only to refresh what is already cached.
// These tests cover the pending record itself, so a stub is enough.
const stubClient = { setQueryData: () => undefined } as unknown as QueryClient;

function notedCreate(id: string, title: string) {
  notePlaylistCreated(stubClient, { id, title });
}

function notedDelete(id: string) {
  notePlaylistDeleted(stubClient, id);
}

function playlist(id: string, title = id): UserPlaylist {
  return { id, title };
}

function section(...ids: string[]): LibrarySection[] {
  return [
    {
      id: "playlists-0",
      title: "Playlists",
      items: ids.map((id) => ({
        kind: "playlist" as const,
        id,
        title: id,
        thumbnails: [],
      })),
    },
  ];
}

function idsOf(sections: LibrarySection[]): string[] {
  return sections.flatMap((s) => s.items.map((item) => item.id));
}

// The pending-edit record is module state shared by both shapes.
beforeEach(() => resetPendingPlaylistEdits());

describe("barePlaylistId", () => {
  it("unwraps the VL browse-id prefix", () => {
    expect(barePlaylistId("VLPL123")).toBe("PL123");
    expect(barePlaylistId("PL123")).toBe("PL123");
  });
});

describe("a just-created playlist", () => {
  // The bug: YouTube's library index lags the create, so the refetch that the
  // mutation triggers still answers without it. Before this, that stale
  // response was written straight into the cache and the playlist stayed
  // invisible until the app restarted.
  it("appears even though the server has not caught up", () => {
    reconcileUserPlaylists([], true);
    notedCreate("PLnew", "My Mix");

    const stale = reconcileUserPlaylists([playlist("PLold")], true);

    expect(stale.map((p) => p.id)).toEqual(["PLnew", "PLold"]);
    expect(stale[0].title).toBe("My Mix");
  });

  it("appears in the sidebar shelves too", () => {
    notedCreate("PLnew", "My Mix");
    expect(idsOf(reconcileLibrarySections(section("PLold"), true))).toEqual([
      "PLnew",
      "PLold",
    ]);
  });

  it("is not duplicated once the server reports it", () => {
    notedCreate("PLnew", "My Mix");
    const settled = reconcileUserPlaylists(
      [playlist("PLnew"), playlist("PLold")],
      true,
    );
    expect(settled.map((p) => p.id)).toEqual(["PLnew", "PLold"]);
  });

  it("stops overriding once the server agrees, so later edits win", () => {
    notedCreate("PLnew", "My Mix");
    // Both endpoints catch up — see "the two endpoints lag independently".
    reconcileUserPlaylists([playlist("PLnew")], true);
    reconcileLibrarySections(section("PLnew"), true);
    // …then the playlist is deleted elsewhere. Nothing should resurrect it.
    expect(reconcileUserPlaylists([], true)).toEqual([]);
  });

  it("seeds a shelf when the library has none yet", () => {
    notedCreate("PLnew", "First");
    expect(idsOf(reconcileLibrarySections([], true))).toEqual(["PLnew"]);
  });
});

describe("a just-deleted playlist", () => {
  it("disappears even though the server still lists it", () => {
    notedDelete("PLgone");
    const stale = reconcileUserPlaylists(
      [playlist("PLgone"), playlist("PLkept")],
      true,
    );
    expect(stale.map((p) => p.id)).toEqual(["PLkept"]);
  });

  it("disappears from the sidebar shelves too", () => {
    notedDelete("PLgone");
    expect(
      idsOf(reconcileLibrarySections(section("PLgone", "PLkept"), true)),
    ).toEqual(["PLkept"]);
  });

  it("matches through the VL browse-id prefix", () => {
    // The sidebar carries `VLPL…` browse ids while the mutation reports `PL…`.
    notedDelete("PL123");
    expect(idsOf(reconcileLibrarySections(section("VLPL123"), true))).toEqual(
      [],
    );
  });

  it("stops suppressing once the server drops it, so a re-add is visible", () => {
    notedDelete("PLgone");
    // Both endpoints catch up — the entry leaves each response.
    reconcileUserPlaylists([], true);
    reconcileLibrarySections([], true);
    // Re-created later under the same id: it must not stay hidden forever.
    expect(reconcileUserPlaylists([playlist("PLgone")], true)).toEqual([
      playlist("PLgone"),
    ]);
  });
});

describe("the two endpoints lag independently", () => {
  // They are separate browses that catch up at different times. Retiring a
  // correction the moment one of them agrees leaves the other's stale answer
  // free to overwrite the change.
  it("keeps a creation until both endpoints report it", () => {
    notedCreate("PLnew", "My Mix");

    // The flat list catches up first.
    expect(
      reconcileUserPlaylists([playlist("PLnew")], true).map((p) => p.id),
    ).toEqual(["PLnew"]);

    // The shelves are still stale — the playlist must survive here.
    expect(idsOf(reconcileLibrarySections([], true))).toEqual(["PLnew"]);

    // Only once both agree is the correction dropped.
    reconcileLibrarySections(section("PLnew"), true);
    expect(reconcileUserPlaylists([], true)).toEqual([]);
  });

  it("keeps a deletion suppressed until both endpoints drop it", () => {
    notedDelete("PLgone");

    // Shelves catch up first.
    expect(idsOf(reconcileLibrarySections([], true))).toEqual([]);

    // The flat list still lists it; it must stay hidden.
    expect(reconcileUserPlaylists([playlist("PLgone")], true)).toEqual([]);

    // Both agree — a later re-add under the same id is visible again.
    reconcileUserPlaylists([], true);
    expect(
      reconcileUserPlaylists([playlist("PLgone")], true).map((p) => p.id),
    ).toEqual(["PLgone"]);
  });
});

describe("switching identity", () => {
  it("drops corrections so they cannot leak into another account", () => {
    notedCreate("PLmine", "Mine");
    notedDelete("PLtheirs");

    // resetInnertube() calls this on sign-in/out and account/channel switches.
    resetPendingPlaylistEdits();

    // The next account's library is reported verbatim: nothing injected,
    // nothing suppressed.
    expect(
      reconcileUserPlaylists([playlist("PLtheirs")], true).map((p) => p.id),
    ).toEqual(["PLtheirs"]);
    expect(idsOf(reconcileLibrarySections(section("PLtheirs"), true))).toEqual([
      "PLtheirs",
    ]);
  });
});

describe("re-applying over cached data", () => {
  it("does not retire a correction the server has not confirmed", () => {
    notedCreate("PLnew", "My Mix");
    const seeded = reconcileUserPlaylists([], true);
    expect(seeded.map((p) => p.id)).toEqual(["PLnew"]);

    // Re-running over our own corrected cache (fromServer: false) must not
    // treat the seed as proof the server knows about it.
    reconcileUserPlaylists(seeded, false);

    // A still-stale server response therefore keeps the playlist visible.
    expect(reconcileUserPlaylists([], true).map((p) => p.id)).toEqual([
      "PLnew",
    ]);
  });
});
