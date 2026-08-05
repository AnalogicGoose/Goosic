import { describe, expect, it } from "vitest";
import { newRadioTracks } from "./radio";
import type { ShelfItem } from "./types";

const track = (id: string): ShelfItem =>
  ({ id, title: id, kind: "song" }) as ShelfItem;

describe("newRadioTracks", () => {
  it("drops tracks already in the queue", () => {
    const page = [track("a"), track("b"), track("c")];
    expect(newRadioTracks(page, ["a", "c"]).map((t) => t.id)).toEqual(["b"]);
  });

  it("drops a track the page repeats within itself", () => {
    // The regression behind "radio keeps replaying the same song": filtering
    // against a set computed once lets both copies of an in-page duplicate
    // through, because neither is in the queue at the time of the check.
    const page = [track("a"), track("b"), track("a"), track("c"), track("b")];
    expect(newRadioTracks(page, []).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("applies both filters together", () => {
    const page = [track("seed"), track("x"), track("x"), track("y")];
    expect(newRadioTracks(page, ["seed", "y"]).map((t) => t.id)).toEqual(["x"]);
  });

  it("keeps the page's order and returns nothing for an exhausted station", () => {
    const page = [track("c"), track("a"), track("b")];
    expect(newRadioTracks(page, []).map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(newRadioTracks(page, ["a", "b", "c"])).toEqual([]);
  });
});
