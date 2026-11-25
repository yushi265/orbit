import { describe, expect, it } from "vitest";
import { beforeProjectIdForMove, splitArchivedProjects } from "./project-workspace";

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

describe("splitArchivedProjects", () => {
  it("[代表値] 順を保ってアーカイブ済みとそれ以外に分ける", () => {
    const { active, archived } = splitArchivedProjects([
      { id: "A", archivedAt: null },
      { id: "B", archivedAt: 5 },
      { id: "C", archivedAt: null },
      { id: "D", archivedAt: 3 },
    ]);
    expect(active.map((project) => project.id)).toEqual(["A", "C"]);
    expect(archived.map((project) => project.id)).toEqual(["B", "D"]);
  });
});
