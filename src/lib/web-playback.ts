import { invoke } from "@tauri-apps/api/core";
import { logCommand } from "@/lib/playback-diagnostics";

export type WebPlaybackState = {
  version: number;
  generation: number;
  sequence: number;
  /**
   * Monotonic id of the concrete media element the observer is attached to,
   * bumped on a genuine `<video>`/`<audio>` replacement. Diagnostics-only; not
   * a transport gate. Optional so older payloads still deserialize.
   */
  mediaGeneration?: number;
  /** Observer-side issue time (ms). Diagnostics ordering signal only. */
  eventAt?: number;
  videoId: string;
  actualVideoId?: string | null;
  ready: boolean;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  advertisement: boolean;
  /**
   * Effective Premium entitlement reported by the official page's own config,
   * if it exposed one. Diagnostics only: the value can be a bootstrap default
   * or carry client-specific semantics, and an advertisement is a normal part
   * of official playback, so nothing here may gate the transport.
   */
  effectivePremium?: boolean | null;
  ended: boolean;
  /**
   * The requested track is over, including the samples between its completion
   * and the one-shot `ended` event. Transport must not try to resume it.
   */
  finished: boolean;
  error: string | null;
};

/**
 * How close an observer sample must land to a requested seek before it counts
 * as confirming it. Samples arrive every 250ms, so a confirming one is normally
 * within a fraction of a second of the target.
 */
export const WEB_SEEK_TOLERANCE_SECONDS = 1.5;
/**
 * How long the requested position is held when nothing confirms it. Bounded so
 * a seek the official page silently refuses cannot freeze the progress bar for
 * the rest of the track.
 */
export const WEB_SEEK_SETTLE_TIMEOUT_MS = 5_000;

/** A seek that has been sent to the official page but not yet observed. */
export type WebSeekHold = {
  generation: number;
  position: number;
  requestedAt: number;
};

/**
 * The remote owner must be quiesced before another owner is activated. A
 * handoff to another online track awaits its pause; native code then destroys
 * that renderer before creating the replacement. Switching to the local owner
 * (or clearing the selection) awaits destruction here. Keeping this ordering
 * in one helper prevents a caller from turning the pause into fire-and-forget
 * work.
 */
export async function quiesceRemotePlayback(
  generation: number,
  mode: "pause" | "reset",
  transport: {
    pause: (generation: number) => Promise<void>;
    reset: () => Promise<void>;
  } = {
    pause: (currentGeneration) => controlWebPlayer(currentGeneration, "pause"),
    reset: resetWebPlayer,
  },
): Promise<void> {
  if (mode === "reset") {
    await transport.reset();
    return;
  }
  await transport.pause(generation);
}

/**
 * Whether a pending seek hold is over, meaning the sample that triggered this
 * check may drive the progress bar again.
 *
 * A seek reaches the official page asynchronously, so samples already in flight
 * still report the pre-seek position. Feeding those to the store snaps the bar
 * back to the old time and then jumps it forward once the seek lands. The hold
 * ends as soon as a sample corroborates the requested position, the playback
 * generation moves on, or the settle budget expires.
 */
export function isSeekHoldResolved(
  hold: WebSeekHold,
  sample: { generation: number; position: number },
  now: number,
): boolean {
  if (hold.generation !== sample.generation) return true;
  if (Math.abs(sample.position - hold.position) <= WEB_SEEK_TOLERANCE_SECONDS) {
    return true;
  }
  return now - hold.requestedAt >= WEB_SEEK_SETTLE_TIMEOUT_MS;
}

export function loadWebTrack(input: {
  videoId: string;
  generation: number;
  playing: boolean;
  volume: number;
  muted: boolean;
}): Promise<void> {
  logCommand("web.load", {
    gen: input.generation,
    req: input.videoId,
    playing: input.playing,
  });
  return invoke("web_player_load", input);
}

export function controlWebPlayer(
  generation: number,
  action: "play" | "pause" | "seek" | "volume" | "mute",
  value?: number,
): Promise<void> {
  // Volume/mute fire on every slider tick; they add noise without helping
  // diagnose advance/repeat bugs, so only transport controls are recorded.
  if (action !== "volume" && action !== "mute") {
    logCommand(`web.${action}`, { gen: generation, value });
  }
  return invoke("web_player_control", { generation, action, value });
}

export function resetWebPlayer(): Promise<void> {
  logCommand("web.reset");
  return invoke("web_player_reset");
}

export function isWebPlayerHealthy(): Promise<boolean> {
  return invoke("web_player_health");
}
