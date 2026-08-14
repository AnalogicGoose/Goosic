import { describe, expect, it } from "vitest";
import { stableWebDuration, type WebDurationFloor } from "./audio-engine";

/**
 * Samples taken verbatim from a real `goosic-playback-log.txt`, where the
 * timeline visibly stretched mid-song. `media.duration` reports how much of the
 * stream has been fetched rather than the track's length, so it grows while the
 * song plays — and keeps growing while paused and after the track has ended.
 *
 * Tuples are [generation, mediaGeneration, reportedDuration, position].
 */
type Sample = [number, number, number, number];

function replay(samples: Sample[]): number {
  let floor: WebDurationFloor | null = null;
  for (const [generation, mediaGeneration, duration, position] of samples) {
    floor =
      stableWebDuration(floor, {
        generation,
        mediaGeneration,
        duration,
        position,
      }) ?? floor;
  }
  return floor?.duration ?? 0;
}

describe("stableWebDuration", () => {
  it("holds the true length while a paused stream keeps buffering", () => {
    // Log entries 0022-0028: paused at 177.7, duration climbed 201 -> 304.8.
    const shown = replay([
      [1, 1, 185, 0],
      [1, 1, 185, 162],
      [1, 1, 201.4, 177.2],
      [1, 1, 215, 177.7],
      [1, 1, 244.9, 177.7],
      [1, 1, 274.9, 177.7],
      [1, 1, 304.8, 177.7],
    ]);
    expect(shown).toBe(185);
  });

  it("holds the true length through the end of a 4:03 track", () => {
    // Log entries 0036-0062: 243 -> 372.9 with position frozen at 243.4.
    const shown = replay([
      [2, 1, 243, 0],
      [2, 1, 243, 120.4],
      [2, 1, 243.1, 225.9],
      [2, 1, 262, 241],
      [2, 1, 262, 243.4],
      [2, 1, 293, 243.4],
      [2, 1, 352.9, 243.4],
      [2, 1, 372.9, 243.4],
    ]);
    // The played length, not the inflated 372.9.
    expect(shown).toBeCloseTo(243.4, 1);
  });

  it("never finishes the bar early when position passes the first reading", () => {
    // Log entries 0075-0094: first sample said 265, the track reached 265.7.
    const shown = replay([
      [3, 1, 265, 0],
      [3, 1, 265.4, 240.7],
      [3, 1, 273.5, 255.6],
      [3, 1, 281.7, 265.7],
    ]);
    expect(shown).toBeCloseTo(265.7, 1);
    // Not the inflated value the page reported.
    expect(shown).toBeLessThan(281.7);
  });

  it("resets for a genuinely different track", () => {
    // A new track is a new generation and may legitimately be longer.
    const first = stableWebDuration(null, {
      generation: 3,
      mediaGeneration: 1,
      duration: 265,
      position: 0,
    });
    const second = stableWebDuration(first, {
      generation: 4,
      mediaGeneration: 1,
      duration: 172,
      position: 0,
    });
    expect(second?.duration).toBe(172);

    // …and a longer next track is not clamped to the previous one.
    const third = stableWebDuration(second, {
      generation: 5,
      mediaGeneration: 1,
      duration: 400,
      position: 0,
    });
    expect(third?.duration).toBe(400);
  });

  it("treats a new media element within a generation as a fresh track", () => {
    const first = stableWebDuration(null, {
      generation: 2,
      mediaGeneration: 1,
      duration: 243,
      position: 0,
    });
    const rebuilt = stableWebDuration(first, {
      generation: 2,
      mediaGeneration: 2,
      duration: 400,
      position: 0,
    });
    expect(rebuilt?.duration).toBe(400);
  });

  it("ignores samples with no usable duration", () => {
    expect(
      stableWebDuration(null, {
        generation: 1,
        mediaGeneration: 0,
        duration: 0,
        position: 0,
      }),
    ).toBeNull();

    // An existing floor is left untouched by a zero sample.
    const floor = stableWebDuration(null, {
      generation: 1,
      mediaGeneration: 1,
      duration: 185,
      position: 0,
    });
    expect(
      stableWebDuration(floor, {
        generation: 1,
        mediaGeneration: 1,
        duration: 0,
        position: 10,
      }),
    ).toBeNull();
    expect(floor?.duration).toBe(185);
  });

  it("buckets a missing mediaGeneration separately from a real one", () => {
    const withId = stableWebDuration(null, {
      generation: 1,
      mediaGeneration: 1,
      duration: 185,
      position: 0,
    });
    const without = stableWebDuration(withId, {
      generation: 1,
      duration: 400,
      position: 0,
    });
    // Not clamped to 185: this is not known to be the same media element.
    expect(without?.duration).toBe(400);
  });
});
