import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDiagnostics,
  diagnosticCount,
  formatDiagnostics,
  logBridgeSample,
  logCommand,
  type BridgeSampleInput,
} from "./playback-diagnostics";

const baseSample = (over: Partial<BridgeSampleInput> = {}): BridgeSampleInput => ({
  generation: 1,
  sequence: 1,
  mediaGeneration: 1,
  eventAt: 0,
  videoId: "aaa",
  actualVideoId: "aaa",
  ready: true,
  playing: true,
  buffering: false,
  advertisement: false,
  ended: false,
  finished: false,
  position: 10,
  duration: 200,
  error: null,
  accepted: true,
  ...over,
});

describe("playback diagnostics", () => {
  beforeEach(() => clearDiagnostics());

  it("drops position-only repeats but keeps state changes", () => {
    logBridgeSample(baseSample({ position: 10 }));
    logBridgeSample(baseSample({ position: 11 })); // only position moved → dropped
    expect(diagnosticCount()).toBe(1);

    logBridgeSample(baseSample({ position: 12, ended: true })); // flag changed → kept
    expect(diagnosticCount()).toBe(2);
  });

  it("keeps a new generation even with identical flags", () => {
    logBridgeSample(baseSample({ generation: 1 }));
    logBridgeSample(baseSample({ generation: 2 }));
    expect(diagnosticCount()).toBe(2);
  });

  it("keeps a media-element replacement (mediaGeneration bump)", () => {
    logBridgeSample(baseSample({ mediaGeneration: 1 }));
    logBridgeSample(baseSample({ mediaGeneration: 2 }));
    expect(diagnosticCount()).toBe(2);
  });

  it("distinguishes accepted from dropped samples", () => {
    logBridgeSample(baseSample({ accepted: true }));
    logBridgeSample(baseSample({ accepted: false }));
    const text = formatDiagnostics({ app: "test" });
    expect(text).toContain("state");
    expect(text).toContain("state(dropped)");
  });

  it("never emits null/undefined detail values into the text", () => {
    logCommand("web.load", { gen: 1, req: "aaa" });
    const text = formatDiagnostics({ app: "test" });
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
    expect(text).toContain("web.load");
  });

  it("formats a header with the supplied context", () => {
    logCommand("web.reset");
    const text = formatDiagnostics({ app: "Goosic 0.5.6", backend: "webview" });
    expect(text).toContain("Goosic playback diagnostics");
    expect(text).toContain("app: Goosic 0.5.6");
    expect(text).toContain("backend: webview");
  });
});
