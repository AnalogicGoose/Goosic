/**
 * A small in-memory ring buffer of playback events, so a hard-to-reproduce
 * bug on someone else's machine (an intermittent repeat, a track that never
 * advances, a stuck loader) can be captured after the fact and read back.
 *
 * The friend hits "Save playback log" in Settings; the frontend formats this
 * buffer and the `save_playback_log` Rust command writes it next to the app's
 * data so they can send the file over.
 *
 * Privacy: this records video ids (public YouTube identifiers) and playback
 * flags only. It must never hold cookies, bridge secrets, stream URLs, request
 * bodies, or account identifiers. Keep new fields on that safe side of the line.
 */

/** A single timeline entry. Kept flat and small so the buffer stays cheap. */
export type DiagnosticEntry = {
  /** Wall-clock ms when recorded (Date.now()). */
  at: number;
  /** What produced the entry. */
  kind: "sample" | "command" | "transition" | "note";
  /** Short label, e.g. the command name or event type. */
  label: string;
  /** Free-form, already-safe detail fields. */
  data?: Record<string, unknown>;
};

const MAX_ENTRIES = 800;
const buffer: DiagnosticEntry[] = [];

/** True while the session has produced at least one entry. */
export function hasDiagnostics(): boolean {
  return buffer.length > 0;
}

function push(entry: DiagnosticEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

/** Record an arbitrary note. Use sparingly for milestones. */
export function logNote(label: string, data?: Record<string, unknown>): void {
  push({ at: Date.now(), kind: "note", label, data });
}

/**
 * Record a native command Goosic issued (load, play, pause, seek, next, ...).
 * These are the "cause" half of the timeline; samples are the "effect" half.
 */
export function logCommand(label: string, data?: Record<string, unknown>): void {
  push({ at: Date.now(), kind: "command", label, data });
}

/**
 * Record a queue/transport transition (index moved, generation bumped, entered
 * an error). Cheap to over-call from a store subscription; the caller filters.
 */
export function logTransition(
  label: string,
  data?: Record<string, unknown>,
): void {
  push({ at: Date.now(), kind: "transition", label, data });
}

/**
 * The subset of a WebPlaybackState the timeline cares about. Declared loosely
 * so this module never has to import the bridge type (avoids a cycle) — the
 * caller passes the fields it has.
 */
export type BridgeSampleInput = {
  generation: number;
  sequence: number;
  mediaGeneration?: number;
  eventAt?: number;
  videoId: string;
  actualVideoId?: string | null;
  ready: boolean;
  playing: boolean;
  buffering: boolean;
  advertisement: boolean;
  ended: boolean;
  finished: boolean;
  position: number;
  duration: number;
  error?: string | null;
  /** Whether the engine accepted this sample or dropped it (stale generation). */
  accepted: boolean;
};

/** Fields whose change makes a sample worth keeping. */
type SampleSignature = {
  generation: number;
  mediaGeneration: number;
  videoId: string;
  actualVideoId: string;
  ready: boolean;
  playing: boolean;
  buffering: boolean;
  advertisement: boolean;
  ended: boolean;
  finished: boolean;
  error: string;
  accepted: boolean;
};

let lastSignature: SampleSignature | null = null;
let lastPositionSampleAt = 0;

function signatureOf(s: BridgeSampleInput): SampleSignature {
  return {
    generation: s.generation,
    mediaGeneration: s.mediaGeneration ?? 0,
    videoId: s.videoId,
    actualVideoId: s.actualVideoId ?? "",
    ready: s.ready,
    playing: s.playing,
    buffering: s.buffering,
    advertisement: s.advertisement,
    ended: s.ended,
    finished: s.finished,
    error: s.error ?? "",
    accepted: s.accepted,
  };
}

function sameSignature(a: SampleSignature, b: SampleSignature): boolean {
  return (
    a.generation === b.generation &&
    a.mediaGeneration === b.mediaGeneration &&
    a.videoId === b.videoId &&
    a.actualVideoId === b.actualVideoId &&
    a.ready === b.ready &&
    a.playing === b.playing &&
    a.buffering === b.buffering &&
    a.advertisement === b.advertisement &&
    a.ended === b.ended &&
    a.finished === b.finished &&
    a.error === b.error &&
    a.accepted === b.accepted
  );
}

/**
 * Record a bridge sample, de-noised. The observer posts ~4 samples/second; the
 * only ones worth keeping are those where a meaningful flag changed (state
 * transitions, terminal events, errors, generation/element bumps). A plain
 * position tick is dropped, except one every 15s so a long steady playback
 * still leaves a heartbeat in the timeline.
 */
export function logBridgeSample(s: BridgeSampleInput): void {
  const sig = signatureOf(s);
  const now = Date.now();
  const changed = !lastSignature || !sameSignature(lastSignature, sig);
  const heartbeatDue = now - lastPositionSampleAt >= 15_000;
  if (!changed && !heartbeatDue) return;
  lastSignature = sig;
  lastPositionSampleAt = now;
  push({
    at: now,
    kind: "sample",
    label: s.accepted ? "state" : "state(dropped)",
    data: {
      gen: s.generation,
      mgen: s.mediaGeneration ?? 0,
      seq: s.sequence,
      req: s.videoId,
      act: s.actualVideoId ?? null,
      ready: s.ready,
      playing: s.playing,
      buffering: s.buffering,
      ad: s.advertisement,
      ended: s.ended,
      finished: s.finished,
      pos: Math.round(s.position * 10) / 10,
      dur: Math.round(s.duration * 10) / 10,
      err: s.error ?? null,
    },
  });
}

/** Format one entry as a single readable line. */
function formatEntry(e: DiagnosticEntry, index: number): string {
  const time = new Date(e.at).toISOString().slice(11, 23); // HH:MM:SS.mmm
  const tag = e.kind.toUpperCase().padEnd(10);
  let detail = "";
  if (e.data) {
    detail = Object.entries(e.data)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  }
  return `${String(index).padStart(4, "0")} ${time} ${tag} ${e.label}${
    detail ? "  " + detail : ""
  }`;
}

/**
 * Render the whole buffer as plain text, newest last. `context` is a small
 * header (app version, platform, current backend) supplied by the caller.
 */
export function formatDiagnostics(context: Record<string, unknown>): string {
  const header = [
    "Goosic playback diagnostics",
    `exported: ${new Date().toISOString()}`,
    ...Object.entries(context).map(([k, v]) => `${k}: ${v}`),
    `entries: ${buffer.length}`,
    "",
    "idx  time         kind       label  detail",
    "-".repeat(72),
  ].join("\n");
  const lines = buffer.map((e, i) => formatEntry(e, i + 1)).join("\n");
  return `${header}\n${lines}\n`;
}

/** Wipe the buffer (used by tests; also handy before reproducing a bug). */
export function clearDiagnostics(): void {
  buffer.length = 0;
  lastSignature = null;
  lastPositionSampleAt = 0;
}

/** Current entry count, for UI ("Save playback log (N events)"). */
export function diagnosticCount(): number {
  return buffer.length;
}
