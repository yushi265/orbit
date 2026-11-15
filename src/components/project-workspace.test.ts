import { describe, expect, it } from "vitest";
import { beforeProjectIdForMove } from "./project-workspace";

describe("beforeProjectIdForMove", () => {
  const ordered = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];
  it.each([
    ["A", "up", null],
    ["B", "up", { beforeProjectId: "A" }],
    ["D", "up", { beforeProjectId: "C" }],
    ["A", "down", { beforeProjectId: "C" }],
    ["C", "down", { beforeProjectId: null }],
    ["D", "down", null],
    ["Z", "up", null],
    ["Z", "down", null],
  ] as const)("%s を %s へ動かすと %j", (id, direction, expected) => {
    expect(beforeProjectIdForMove(ordered, id, direction)).toEqual(expected);
  });
  it("1件だけの一覧では上へも下へも動けない", () => {
    expect(beforeProjectIdForMove([{ id: "A" }], "A", "up")).toBeNull();
    expect(beforeProjectIdForMove([{ id: "A" }], "A", "down")).toBeNull();
  });
});
