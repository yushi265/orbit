import { describe, expect, it } from "vitest";
import { NO_PROJECT_OPTION, projectIdFromSelection, selectableProjects } from "./issue-project";

describe("Issue Project selection", () => {
  it("[代表値] 選択したProject IDをそのまま返す", () => {
    expect(projectIdFromSelection("project-1")).toBe("project-1");
  });

  it("[境界値] 未選択とProjectなしはnullへ変換する", () => {
    expect(projectIdFromSelection("")).toBeNull();
    expect(NO_PROJECT_OPTION).toBe("__none__");
    expect(projectIdFromSelection("__none__")).toBeNull();
  });
});

describe("selectableProjects", () => {
  const projects = [
    { id: "A", archivedAt: null },
    { id: "B", archivedAt: 1 },
    { id: "C", archivedAt: null },
  ];
  it.each([
    [
      "現在値なし",
      undefined,
      [
        ["A", false],
        ["C", false],
      ],
    ],
    [
      "現在値null",
      null,
      [
        ["A", false],
        ["C", false],
      ],
    ],
    [
      "現在値が未アーカイブ",
      "A",
      [
        ["A", false],
        ["C", false],
      ],
    ],
    [
      "現在値がアーカイブ済み",
      "B",
      [
        ["A", false],
        ["B", true],
        ["C", false],
      ],
    ],
    [
      "現在値が一覧に無い",
      "Z",
      [
        ["A", false],
        ["C", false],
      ],
    ],
  ] as const)("[デシジョンテーブル] %s", (_, current, expected) => {
    expect(
      selectableProjects(projects, current).map(({ project, archived }) => [project.id, archived]),
    ).toEqual(expected);
  });
});
