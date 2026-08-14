import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShelfItem } from "@/lib/innertube/types";
import type { OfflineDownloadSnapshot } from "@/lib/store/offline-downloads";

type JobsState = { jobs: Record<string, OfflineDownloadSnapshot> };

const accounts = vi.hoisted(() => {
  type FakeAccount = {
    id: string;
    email: string;
    name: string;
    photoUrl: null;
    pageId: string | null;
    channelName: string | null;
    channelPhotoUrl: null;
    webPlayerIdentityVerified: boolean;
    isActive: boolean;
  };

  const account = (id: string, pageId: string | null = null): FakeAccount => ({
    id,
    email: `${id}@example.test`,
    name: id,
    photoUrl: null,
    pageId,
    channelName: pageId,
    channelPhotoUrl: null,
    webPlayerIdentityVerified: true,
    isActive: true,
  });

  let current = [account("account-a")];
  let queued: FakeAccount[][] = [];
  const deleted: string[][] = [];
  const invoke = vi.fn(async (command: string, args?: unknown) => {
    if (command === "list_accounts") {
      return queued.length ? queued.shift() : current;
    }
    if (command === "list_offline_downloads") return [];
    if (command === "delete_cache_entries") {
      const videoIds = (args as { videoIds: string[] }).videoIds;
      if (!videoIds.length)
        throw new Error("no downloaded tracks were selected");
      deleted.push(videoIds);
      return videoIds.length * 1_000;
    }
    throw new Error(`Unexpected Tauri command in test: ${command}`);
  });

  return {
    account,
    invoke,
    deleted,
    reset: () => {
      current = [account("account-a")];
      queued = [];
      deleted.length = 0;
      invoke.mockClear();
    },
    set: (...next: FakeAccount[]) => {
      current = next;
    },
    queue: (...next: FakeAccount[][]) => {
      queued = next;
    },
  };
});

const native = vi.hoisted(() => {
  let jobs: Record<string, OfflineDownloadSnapshot> = {};
  const removedIds: string[][] = [];
  const subscribers = new Set<(state: JobsState) => void>();

  const emit = (snapshot: OfflineDownloadSnapshot) => {
    jobs = { ...jobs, [snapshot.videoId]: snapshot };
    for (const subscriber of subscribers) subscriber({ jobs });
  };

  return {
    initialize: vi.fn<() => Promise<void>>(),
    start: vi.fn(),
    cancel: vi.fn(),
    ownership: vi.fn(),
    emit,
    reset: () => {
      jobs = {};
      removedIds.length = 0;
      subscribers.clear();
    },
    removedIds,
    store: {
      getState: () => ({
        jobs,
        upsert: emit,
        remove: (videoIds?: string[]) => {
          removedIds.push(videoIds ?? []);
          for (const videoId of videoIds ?? []) delete jobs[videoId];
        },
      }),
      subscribe: (subscriber: (state: JobsState) => void) => {
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
      },
    },
  };
});

const trackSources = vi.hoisted(() => ({
  byVideoId: {} as Record<
    string,
    { song: string; video?: string; selected: "song" | "video" }
  >,
}));

const queryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
}));

const entitlement = vi.hoisted(() => {
  type Snapshot = {
    status: "premium" | "free" | null;
    source: "live" | "offlineGrace" | null;
  };
  const listeners = new Set<(state: Snapshot) => void>();
  return {
    status: "premium" as Snapshot["status"],
    source: "live" as Snapshot["source"],
    verify: vi.fn(async () => undefined),
    subscribe: (listener: (state: Snapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => listeners.clear(),
  };
});

const nativeEvents = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listen: vi.fn(async (event: string, callback: () => void) => {
      const callbacks = listeners.get(event) ?? new Set<() => void>();
      callbacks.add(callback);
      listeners.set(event, callbacks);
      return () => callbacks.delete(callback);
    }),
    emit: (event: string) => {
      for (const callback of listeners.get(event) ?? []) callback();
    },
    reset: () => listeners.clear(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: accounts.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: nativeEvents.listen }));

vi.mock("zustand/middleware", () => ({
  persist: (initializer: unknown) => initializer,
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/query-client", () => ({ queryClient }));

vi.mock("@/lib/store/premium", () => ({
  PREMIUM_DOWNLOAD_LIVE_MAX_AGE_MS: 5 * 60 * 1000,
  verifyPremiumDownloadEntitlement: entitlement.verify,
  usePremiumStore: {
    getState: () => ({
      status: entitlement.status,
      source: entitlement.source,
    }),
    subscribe: entitlement.subscribe,
  },
}));

vi.mock("@/lib/offline-library", () => ({
  OFFLINE_LIBRARY_QUERY_KEY: ["offline-library"],
}));

vi.mock("@/lib/store/offline-downloads", () => ({
  initializeOfflineDownloads: native.initialize,
  startOfflineDownload: native.start,
  cancelOfflineDownload: native.cancel,
  setPlaylistDownloadOwnership: native.ownership,
  useOfflineDownloadStore: native.store,
}));

vi.mock("@/lib/store/track-source", () => ({
  useTrackSourceStore: {
    getState: () => ({ byVideoId: trackSources.byVideoId }),
  },
  resolveStreamId: (
    displayedId: string,
    sources: typeof trackSources.byVideoId,
  ) => {
    const source = sources[displayedId];
    if (!source) return displayedId;
    if (source.selected === "video" && source.video) return source.video;
    return source.song;
  },
}));

const {
  RATE_LIMIT_COOLDOWN_MS,
  cancelPlaylistDownload,
  createOfflinePlaylistManifest,
  migrateOfflinePlaylistManifests,
  offlineIdentityKey,
  playlistDownloadKey,
  preparePlaylistDownloads,
  removePlaylistDownload,
  retryPlaylistDownload,
  startPlaylistDownload,
  useOfflinePlaylistStore,
  usePlaylistDownloadStore,
} = await import("@/lib/store/playlist-downloads");

const PERSONAL_IDENTITY = offlineIdentityKey("account-a", null);

function song(id: string, title = id): ShelfItem {
  return {
    kind: "song",
    id,
    title,
    thumbnails: [],
    artists: [{ name: `Artist ${id}` }],
  };
}

function completed(videoId: string): OfflineDownloadSnapshot {
  return {
    videoId,
    phase: "completed",
    downloadedBytes: 64_000,
    totalBytes: 64_000,
  };
}

function batch(identityKey = PERSONAL_IDENTITY, playlistId = "playlist") {
  return usePlaylistDownloadStore.getState().batches[
    playlistDownloadKey(identityKey, playlistId)
  ];
}

beforeEach(() => {
  accounts.reset();
  native.reset();
  nativeEvents.reset();
  nativeEvents.listen.mockClear();
  native.initialize.mockReset().mockResolvedValue(undefined);
  native.start.mockReset().mockImplementation(async (videoId: string) => {
    const snapshot = completed(videoId);
    native.emit(snapshot);
    return snapshot;
  });
  native.cancel.mockReset().mockResolvedValue(undefined);
  native.ownership.mockReset();
  queryClient.invalidateQueries.mockClear();
  entitlement.status = "premium";
  entitlement.source = "live";
  entitlement.verify.mockReset().mockImplementation(async () => {
    if (entitlement.status !== "premium" || entitlement.source !== "live") {
      throw new Error(
        "YouTube Music Premium is required for offline downloads.",
      );
    }
  });
  entitlement.reset();
  trackSources.byVideoId = {};
  useOfflinePlaylistStore.setState({
    manifestsByIdentity: {},
    legacyManifests: {},
  });
  usePlaylistDownloadStore.setState({ batches: {} });
});

describe("playlist download planning", () => {
  it.each([
    { status: "free" as const, source: "live" as const },
    { status: "premium" as const, source: "offlineGrace" as const },
  ])(
    "rejects $status/$source before native setup",
    async ({ status, source }) => {
      entitlement.status = status;
      entitlement.source = source;

      await expect(
        startPlaylistDownload("playlist", "Mix", [song("one")]),
      ).rejects.toThrow("Premium");
      expect(accounts.invoke).not.toHaveBeenCalled();
      expect(native.initialize).not.toHaveBeenCalled();
      expect(native.start).not.toHaveBeenCalled();
    },
  );

  it("downloads a shared selected source once while preserving playlist duplicates", () => {
    const selectedVideo = {
      song: "song-a",
      video: "video-a",
      selected: "video" as const,
    };
    trackSources.byVideoId = {
      "song-a": selectedVideo,
      "video-a": selectedVideo,
    };
    const album: ShelfItem = {
      kind: "album",
      id: "album-a",
      title: "Album",
      thumbnails: [],
    };
    const tracks = [song("song-a", "First"), song("video-a"), album];

    const plan = preparePlaylistDownloads(tracks);
    const manifest = createOfflinePlaylistManifest(
      PERSONAL_IDENTITY,
      "playlist",
      "Mix",
      tracks,
    );

    expect(plan).toEqual([
      expect.objectContaining({
        streamVideoId: "video-a",
        sourceKind: "video",
        track: expect.objectContaining({ id: "song-a", title: "First" }),
      }),
    ]);
    expect(manifest.tracks).toHaveLength(2);
    expect(manifest.tracks.map((track) => track.offlineVideoId)).toEqual([
      "video-a",
      "video-a",
    ]);
  });

  it("keeps only the best thumbnail in compact persisted manifests", () => {
    const track = song("one");
    track.thumbnails = [
      { url: "small", width: 40, height: 40 },
      { url: "large", width: 400, height: 400 },
    ];

    const manifest = createOfflinePlaylistManifest(
      PERSONAL_IDENTITY,
      "playlist",
      "Mix",
      [track],
    );

    expect(manifest.tracks[0]?.thumbnails).toEqual([
      { url: "large", width: 400, height: 400 },
    ]);
  });

  it("runs each unique download sequentially and saves the scoped manifest", async () => {
    await startPlaylistDownload("playlist", "Mix", [
      song("one"),
      song("one", "Duplicate"),
      song("two"),
    ]);

    expect(native.start.mock.calls.map(([videoId]) => videoId)).toEqual([
      "one",
      "two",
    ]);
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.playlist.tracks,
    ).toHaveLength(3);
    expect(batch()).toMatchObject({
      identityKey: PERSONAL_IDENTITY,
      phase: "completed",
      completed: 2,
      failed: 0,
      currentVideoId: undefined,
    });
    expect(native.ownership).toHaveBeenNthCalledWith(1, ["one", "two"], true);
    expect(native.ownership).toHaveBeenLastCalledWith(["one", "two"], false);
    expect(entitlement.verify).toHaveBeenCalledWith({ force: true });
    expect(
      entitlement.verify.mock.calls.filter((args) => args.length === 0),
    ).toHaveLength(3);
  });

  it("isolates the same playlist id by account and channel identity", async () => {
    await startPlaylistDownload("LM", "Personal likes", [song("personal")]);

    const channelIdentity = offlineIdentityKey("account-a", "channel-b");
    accounts.set(accounts.account("account-a", "channel-b"));
    await startPlaylistDownload("LM", "Channel likes", [song("channel")]);

    const manifests = useOfflinePlaylistStore.getState().manifestsByIdentity;
    expect(manifests[PERSONAL_IDENTITY]?.LM.title).toBe("Personal likes");
    expect(manifests[channelIdentity]?.LM.title).toBe("Channel likes");
    expect(batch(PERSONAL_IDENTITY, "LM")?.phase).toBe("completed");
    expect(batch(channelIdentity, "LM")?.phase).toBe("completed");
  });

  it("quarantines unscoped v1 manifests instead of attaching them", () => {
    const legacyManifest = {
      playlistId: "LM",
      title: "Unknown owner",
      tracks: [],
      updatedAt: 1,
    };

    const migrated = migrateOfflinePlaylistManifests(
      { manifests: { LM: legacyManifest } },
      1,
    );

    expect(migrated.manifestsByIdentity).toEqual({});
    expect(migrated.legacyManifests).toEqual({ LM: legacyManifest });
  });

  it("revalidates identity before committing or starting native work", async () => {
    accounts.queue(
      [accounts.account("account-a")],
      [accounts.account("account-b")],
    );

    await expect(
      startPlaylistDownload("playlist", "Mix", [song("one")]),
    ).rejects.toThrow("account or channel changed");

    expect(native.initialize).toHaveBeenCalledOnce();
    expect(native.start).not.toHaveBeenCalled();
    expect(useOfflinePlaylistStore.getState().manifestsByIdentity).toEqual({});
  });

  it("enforces a real cooldown after a rate-limit failure", async () => {
    const now = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    native.start.mockImplementationOnce(async (videoId: string) => ({
      videoId,
      phase: "failed",
      downloadedBytes: 0,
      totalBytes: null,
      error: "HTTP 429: Too Many Requests",
    }));

    await startPlaylistDownload("playlist", "Mix", [song("one"), song("two")]);

    expect(native.start).toHaveBeenCalledTimes(1);
    expect(batch()).toMatchObject({
      phase: "failed",
      completed: 0,
      failed: 1,
      retryAt: now + RATE_LIMIT_COOLDOWN_MS,
    });
    await expect(
      retryPlaylistDownload(PERSONAL_IDENTITY, "playlist"),
    ).rejects.toThrow("wait before retrying");
    expect(native.start).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(now + RATE_LIMIT_COOLDOWN_MS + 1);
    await retryPlaylistDownload(PERSONAL_IDENTITY, "playlist");
    expect(batch()).toMatchObject({
      phase: "completed",
      completed: 2,
      failed: 0,
      retryAt: undefined,
    });
    nowSpy.mockRestore();
  });
});

describe("playlist cancellation and lifecycle", () => {
  it("does not let a late boundary event overwrite a terminal phase", async () => {
    let releaseInvalidation!: () => void;
    queryClient.invalidateQueries.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseInvalidation = () => resolve(undefined);
        }),
    );

    const running = startPlaylistDownload("playlist", "Mix", [song("one")]);
    await vi.waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledOnce();
      expect(batch()?.phase).toBe("completed");
    });

    nativeEvents.emit("accounts-changed");
    expect(batch()?.phase).toBe("completed");
    releaseInvalidation();
    await running;
    expect(batch()?.phase).toBe("completed");
  });

  it("cancels the active native track, stops the remaining plan, and releases ownership", async () => {
    native.start.mockImplementation(async (videoId: string) => {
      const snapshot: OfflineDownloadSnapshot = {
        videoId,
        phase: "downloading",
        downloadedBytes: 1_024,
        totalBytes: null,
      };
      native.emit(snapshot);
      return snapshot;
    });
    native.cancel.mockImplementation(async (videoId: string) => {
      native.emit({
        videoId,
        phase: "cancelled",
        downloadedBytes: 1_024,
        totalBytes: null,
      });
    });

    const running = startPlaylistDownload("playlist", "Mix", [
      song("one"),
      song("two"),
    ]);
    await vi.waitFor(() => {
      expect(batch()?.currentVideoId).toBe("one");
    });

    await cancelPlaylistDownload(PERSONAL_IDENTITY, "playlist");
    await running;

    expect(native.cancel).toHaveBeenCalledWith("one");
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(batch()).toMatchObject({
      phase: "cancelled",
      completed: 0,
      currentVideoId: undefined,
    });
    expect(native.ownership).toHaveBeenLastCalledWith(["one", "two"], false);
  });

  it.each(["login-success", "accounts-changed"])(
    "cancels immediately on the %s account boundary during an active batch",
    async (boundaryEvent) => {
      native.start.mockImplementation(async (videoId: string) => {
        const snapshot: OfflineDownloadSnapshot = {
          videoId,
          phase: "downloading",
          downloadedBytes: 1_024,
          totalBytes: null,
        };
        native.emit(snapshot);
        return snapshot;
      });
      native.cancel.mockImplementation(async (videoId: string) => {
        native.emit({
          videoId,
          phase: "cancelled",
          downloadedBytes: 1_024,
          totalBytes: null,
        });
      });

      const running = startPlaylistDownload("playlist", "Mix", [
        song("one"),
        song("two"),
      ]);
      await vi.waitFor(() => expect(batch()?.currentVideoId).toBe("one"));

      accounts.set(accounts.account("account-b"));
      nativeEvents.emit(boundaryEvent);
      await running;

      expect(native.cancel).toHaveBeenCalledWith("one");
      expect(native.start).toHaveBeenCalledTimes(1);
      expect(batch()).toMatchObject({
        phase: "cancelled",
        completed: 0,
        currentVideoId: undefined,
      });
      expect(native.ownership).toHaveBeenLastCalledWith(["one", "two"], false);
    },
  );

  it("preserves a known-good manifest and releases ownership when setup fails", async () => {
    const previous = createOfflinePlaylistManifest(
      PERSONAL_IDENTITY,
      "first",
      "Existing",
      [song("old")],
    );
    useOfflinePlaylistStore.getState().save(PERSONAL_IDENTITY, previous);
    native.initialize.mockRejectedValueOnce(new Error("listener unavailable"));

    await expect(
      startPlaylistDownload("first", "Replacement", [song("one")]),
    ).rejects.toThrow("listener unavailable");

    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.first,
    ).toEqual(previous);
    await expect(
      startPlaylistDownload("second", "Second", [song("two")]),
    ).resolves.toBeUndefined();
    expect(native.ownership).toHaveBeenCalledWith(["one"], false);
  });
});

describe("removing a downloaded playlist", () => {
  it("deletes the files and the manifest so it cannot come back on restart", async () => {
    await startPlaylistDownload("playlist", "Mix", [song("one"), song("two")]);
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.playlist,
    ).toBeDefined();

    await removePlaylistDownload(PERSONAL_IDENTITY, "playlist");

    expect(accounts.deleted).toEqual([["one", "two"]]);
    expect(native.removedIds).toEqual([["one", "two"]]);
    // The persisted manifest is what survives a restart. If it stays, the
    // playlist reappears as downloaded with no files behind it.
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY],
    ).toBeUndefined();
    expect(batch()).toBeUndefined();
  });

  it("keeps files another downloaded playlist still needs", async () => {
    await startPlaylistDownload("shared", "Shared", [song("one"), song("two")]);
    await startPlaylistDownload("other", "Other", [song("two"), song("three")]);

    await removePlaylistDownload(PERSONAL_IDENTITY, "shared");

    // "two" belongs to a playlist that is still downloaded.
    expect(accounts.deleted).toEqual([["one"]]);
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.other,
    ).toBeDefined();
  });

  it("does not orphan a shared file when both playlists are removed at once", async () => {
    await startPlaylistDownload("shared", "Shared", [song("one"), song("two")]);
    await startPlaylistDownload("other", "Other", [song("two"), song("three")]);

    // Started together, before either has finished deleting. Each removal used
    // to see the other's manifest, defer "two" to it, and leave the file on
    // disk with no manifest referencing it.
    await Promise.all([
      removePlaylistDownload(PERSONAL_IDENTITY, "shared"),
      removePlaylistDownload(PERSONAL_IDENTITY, "other"),
    ]);

    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY],
    ).toBeUndefined();
    const deleted = accounts.deleted.flat().sort();
    // Every file must be accounted for, the shared one included.
    expect(deleted).toEqual(["one", "three", "two"]);
  });

  it("does not erase a download started while the removal is in flight", async () => {
    await startPlaylistDownload("playlist", "Mix", [song("one")]);

    // Hold the native deletion open to reproduce the await gap.
    let releaseDelete: (() => void) | undefined;
    accounts.invoke.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      return 1_000;
    });

    const removing = removePlaylistDownload(PERSONAL_IDENTITY, "playlist");
    await vi.waitFor(() => expect(releaseDelete).toBeDefined());

    // The removal holds the runner slot, so a start in this window must not
    // begin native work. Otherwise it would commit a fresh manifest that the
    // resuming removal deletes, leaving downloaded files with no record of
    // them — invisible after a restart.
    const startsBefore = native.start.mock.calls.length;
    await startPlaylistDownload("playlist", "Mix", [song("one")]);
    expect(native.start.mock.calls.length).toBe(startsBefore);

    releaseDelete?.();
    await removing;

    // The removal completed, and no half-started batch was left behind.
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY],
    ).toBeUndefined();
    expect(batch()).toBeUndefined();

    // The slot is released, so downloading again afterwards works normally.
    await startPlaylistDownload("playlist", "Mix", [song("one")]);
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.playlist,
    ).toBeDefined();
  });

  it("is a no-op for a playlist that was never downloaded", async () => {
    await removePlaylistDownload(PERSONAL_IDENTITY, "missing");
    expect(accounts.deleted).toEqual([]);
  });

  it("keeps the manifest when deleting the files fails", async () => {
    await startPlaylistDownload("playlist", "Mix", [song("one")]);
    accounts.invoke.mockImplementationOnce(async () => {
      throw new Error("file is locked");
    });

    await expect(
      removePlaylistDownload(PERSONAL_IDENTITY, "playlist"),
    ).rejects.toThrow("file is locked");

    // Orphaning the audio with no way to reach it would be worse than a
    // download entry the user can retry removing.
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.playlist,
    ).toBeDefined();
  });
});

describe("pruning manifests whose files are gone", () => {
  it("drops a manifest once none of its files remain on disk", async () => {
    await startPlaylistDownload("playlist", "Mix", [song("one"), song("two")]);

    useOfflinePlaylistStore.getState().pruneMissing([]);

    expect(useOfflinePlaylistStore.getState().manifestsByIdentity).toEqual({});
  });

  it("keeps a partially downloaded manifest", async () => {
    await startPlaylistDownload("playlist", "Mix", [song("one"), song("two")]);

    useOfflinePlaylistStore.getState().pruneMissing(["one"]);

    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.playlist,
    ).toBeDefined();
  });

  it("prunes per playlist without touching the ones still on disk", async () => {
    await startPlaylistDownload("kept", "Kept", [song("one")]);
    await startPlaylistDownload("gone", "Gone", [song("two")]);

    useOfflinePlaylistStore.getState().pruneMissing(["one"]);

    const manifests =
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY];
    expect(Object.keys(manifests ?? {})).toEqual(["kept"]);
  });

  it("keeps the manifest of a batch that is still downloading", async () => {
    // The runner commits the manifest before the first file exists and never
    // saves it again, so pruning mid-batch would erase a download that goes on
    // to succeed.
    let release: (() => void) | undefined;
    native.start.mockImplementationOnce(async (videoId: string) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      const snapshot = completed(videoId);
      native.emit(snapshot);
      return snapshot;
    });

    const running = startPlaylistDownload("playlist", "Mix", [song("one")]);
    await vi.waitFor(() => expect(batch()?.currentVideoId).toBe("one"));

    // Nothing is on disk yet — exactly the window the effect fires in.
    useOfflinePlaylistStore.getState().pruneMissing([]);
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.playlist,
    ).toBeDefined();

    release?.();
    await running;

    expect(batch()).toMatchObject({ phase: "completed", completed: 1 });
    expect(
      useOfflinePlaylistStore.getState().manifestsByIdentity[PERSONAL_IDENTITY]
        ?.playlist,
    ).toBeDefined();
  });
});
