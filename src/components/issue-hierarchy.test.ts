import { describe, expect, it } from "vitest";
import { sortIssues } from "./issue-list";
import {
  COLLAPSED_PARENTS_STORAGE_KEY,
  buildIssueHierarchyRows,
  readCollapsedParents,
  writeCollapsedParents,
} from "./issue-hierarchy";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";
import type { IssueViewModel, WorkflowStateViewModel } from "../shared/view-models";

const base = reviewBootstrap().workflowStates[0];
const states: WorkflowStateViewModel[] = [
  { ...base, id: "todo", category: "unstarted", position: 0 },
  { ...base, id: "doing", category: "started", position: 1 },
  { ...base, id: "done", category: "completed", position: 2 },
  { ...base, id: "cancel", category: "canceled", position: 3 },
];

function issue(id: string, overrides: Partial<IssueViewModel> = {}) {
  return reviewIssue(id, { statusId: "todo", ...overrides });
}
function build(
  issues: IssueViewModel[],
  options: { all?: IssueViewModel[]; collapsed?: string[] } = {},
) {
  return buildIssueHierarchyRows({
    issues,
    allIssues: options.all ?? issues,
    workflowStates: states,
    collapsed: new Set(options.collapsed ?? []),
  });
}
const ids = (rows: { issue: IssueViewModel }[]) => rows.map((row) => row.issue.id);

describe("buildIssueHierarchyRows", () => {
  it("[代表値] places children under their parent and keeps sibling order", () => {
    const x = issue("X");
    const p = issue("P");
    const a = issue("A", { parentId: "P" });
    const b = issue("B", { parentId: "P" });
    const rows = build([x, b, p, a]);
    expect(ids(rows)).toEqual(["X", "P", "B", "A"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 1]);
    expect(rows.map((row) => row.parentKey)).toEqual([null, null, "P", "P"]);
  });

  it("[境界値] depth grows per generation up to 5 generations", () => {
    const chain = [
      issue("g0"),
      issue("g1", { parentId: "g0" }),
      issue("g2", { parentId: "g1" }),
      issue("g3", { parentId: "g2" }),
      issue("g4", { parentId: "g3" }),
    ];
    expect(build([...chain].reverse()).map((row) => row.depth)).toEqual([0, 1, 2, 3, 4]);
  });

  it.each(["title_asc", "due_asc", "manual"] as const)(
    "[同値分割] children stay grouped under the parent with sort %s",
    (sort) => {
      const all = [
        issue("p1", { title: "b", dueAt: 300, position: 2 }),
        issue("p2", { title: "a", dueAt: 100, position: 1 }),
        issue("c1", { title: "z", dueAt: 200, position: 4, parentId: "p1" }),
        issue("c2", { title: "y", dueAt: 100, position: 3, parentId: "p1" }),
        issue("c3", { title: "x", dueAt: 100, position: 5, parentId: "p2" }),
      ];
      const sorted = sortIssues(all, sort, states);
      const rows = build(sorted);
      const topLevel = sorted.filter((i) => !i.parentId).map((i) => i.id);
      expect(rows.filter((row) => row.depth === 0).map((row) => row.issue.id)).toEqual(topLevel);
      for (const parent of ["p1", "p2"]) {
        const at = ids(rows).indexOf(parent);
        const kids = sorted.filter((i) => i.parentId === parent).map((i) => i.id);
        expect(ids(rows).slice(at + 1, at + 1 + kids.length)).toEqual(kids);
      }
    },
  );

  it("[デシジョンテーブル] resolves parent presence: shown / only in allIssues / nowhere / null", () => {
    const parent = issue("P", { identifier: "TASK-P", title: "Parent title" });
    const shown = issue("shown", { parentId: "P" });
    const hidden = issue("hidden", { parentId: "P" });
    const orphan = issue("orphan", { parentId: "missing" });
    const plain = issue("plain");
    const rows = build([parent, shown, orphan, plain], {
      all: [parent, shown, hidden, orphan, plain],
    });
    const byId = Object.fromEntries(rows.map((row) => [row.issue.id, row]));
    expect(byId.shown).toMatchObject({ depth: 1, parentKey: "P", parentHint: null });
    expect(byId.orphan).toMatchObject({ depth: 0, parentKey: null, parentHint: null });
    expect(byId.plain).toMatchObject({ depth: 0, parentKey: null, parentHint: null });
    const filtered = build([shown, plain], { all: [parent, shown, plain] });
    expect(filtered[0]).toMatchObject({
      depth: 0,
      parentKey: null,
      parentHint: { identifier: "TASK-P", title: "Parent title" },
    });
  });

  it("[同値分割] grandchild whose parent is hidden is top level with the direct parent as hint", () => {
    const gp = issue("GP");
    const p = issue("P", { parentId: "GP", identifier: "TASK-P", title: "Mid" });
    const c = issue("C", { parentId: "P" });
    const rows = build([gp, c], { all: [gp, p, c] });
    expect(rows.map((row) => row.depth)).toEqual([0, 0]);
    expect(rows[1].parentHint).toEqual({ identifier: "TASK-P", title: "Mid" });
  });

  it("[状態遷移] collapsing hides descendants, keeping the parent with collapsed true", () => {
    const p = issue("P");
    const c = issue("C", { parentId: "P" });
    const g = issue("G", { parentId: "C" });
    const list = [p, c, g];
    expect(ids(build(list))).toEqual(["P", "C", "G"]);
    const closed = build(list, { collapsed: ["P"] });
    expect(ids(closed)).toEqual(["P"]);
    expect(closed[0]).toMatchObject({ collapsed: true, hasVisibleChildren: true });
    expect(ids(build(list, { collapsed: ["C"] }))).toEqual(["P", "C"]);
    expect(ids(build(list, { collapsed: [] }))).toEqual(["P", "C", "G"]);
    expect(build(list)[0].collapsed).toBe(false);
  });

  describe("[デシジョンテーブル] childProgress", () => {
    const parent = issue("P");
    const kid = (id: string, statusId: string) => issue(id, { parentId: "P", statusId });
    const progress = (children: IssueViewModel[], visible = children) =>
      build([parent, ...visible], { all: [parent, ...children] })[0].childProgress;
    it("is null without children", () => expect(progress([])).toBeNull());
    it("counts all-canceled as 0/2", () =>
      expect(progress([kid("a", "cancel"), kid("b", "cancel")])).toEqual({
        completed: 0,
        total: 2,
      }));
    it("1/2 for completed + started", () =>
      expect(progress([kid("a", "done"), kid("b", "doing")])).toEqual({ completed: 1, total: 2 }));
    it("1/3 for completed + canceled + unstarted", () =>
      expect(progress([kid("a", "done"), kid("b", "cancel"), kid("c", "todo")])).toEqual({
        completed: 1,
        total: 3,
      }));
    it("counts children hidden by filters", () => {
      const children = [kid("a", "done"), kid("b", "todo")];
      expect(progress(children, [children[1]])).toEqual({ completed: 1, total: 2 });
    });
    it("does not count grandchildren", () => {
      const child = kid("a", "todo");
      const grand = issue("g", { parentId: "a", statusId: "done" });
      const rows = build([parent, child, grand], { all: [parent, child, grand] });
      expect(rows[0].childProgress).toEqual({ completed: 0, total: 1 });
      expect(rows[1].childProgress).toEqual({ completed: 1, total: 1 });
    });
  });

  it("[代表値] terminates on cycles and returns each issue once", () => {
    const a = issue("A", { parentId: "B" });
    const b = issue("B", { parentId: "A" });
    const rows = build([a, b]);
    expect(ids(rows).sort()).toEqual(["A", "B"]);
    expect(rows.map((row) => [row.depth, row.parentKey])).toEqual([
      [0, null],
      [1, "A"],
    ]);
  });

  it("[代表値] flat input keeps order with default fields", () => {
    const rows = build([issue("c"), issue("a"), issue("b")]);
    expect(ids(rows)).toEqual(["c", "a", "b"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        depth: 0,
        hasVisibleChildren: false,
        childProgress: null,
        parentHint: null,
      });
    }
  });
});

describe("collapsed parents storage", () => {
  const storage = (value: string | null) => ({
    getItem: (key: string) => (key === COLLAPSED_PARENTS_STORAGE_KEY ? value : null),
    setItem: () => undefined,
  });
  it("uses the documented key", () =>
    expect(COLLAPSED_PARENTS_STORAGE_KEY).toBe("orbit.issues.collapsedParents"));
  it("reads a JSON array of ids", () =>
    expect(readCollapsedParents(storage('["a","b"]'))).toEqual(new Set(["a", "b"])));
  it.each([
    ["broken json", "{"],
    ["object", '{"a":1}'],
    ["mixed numbers", '["a",1]'],
    ["null", null],
  ])("returns empty set for %s", (_name, value) =>
    expect(readCollapsedParents(storage(value))).toEqual(new Set()),
  );
  it("returns empty set for undefined storage or throwing getItem", () => {
    expect(readCollapsedParents(undefined)).toEqual(new Set());
    expect(
      readCollapsedParents({
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => undefined,
      }),
    ).toEqual(new Set());
  });
  it("writes JSON and swallows errors", () => {
    const calls: Array<[string, string]> = [];
    writeCollapsedParents({ getItem: () => null, setItem: (k, v) => calls.push([k, v]) }, ["a"]);
    expect(calls).toEqual([["orbit.issues.collapsedParents", '["a"]']]);
    expect(() =>
      writeCollapsedParents(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("full");
          },
        },
        ["a"],
      ),
    ).not.toThrow();
    expect(() => writeCollapsedParents(undefined, ["a"])).not.toThrow();
  });
});

describe("hierarchy styles", () => {
  async function loadCss() {
    const { readFileSync } = await import("node:fs");
    return readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  }
  const rule = (css: string, selector: string) =>
    css.match(new RegExp(`${selector.replace(/[.[\]()]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  const inMedia = (css: string, query: string) =>
    css.match(new RegExp(`@media \\(${query}\\) \\{([^@]*)\\}\\n`, "g"))?.join("\n") ?? "";

  it("[代表値] title cell is indented by --issue-depth, 12px per level on mobile", async () => {
    const css = await loadCss();
    expect(css).toMatch(
      /\.issue-row \.issue-title-cell \{[^}]*padding-left: calc\(var\(--issue-depth, 0\) \* 20px\)/,
    );
    expect(inMedia(css, "max-width: 767px")).toMatch(
      /\.issue-row \.issue-title-cell \{[^}]*padding-left: calc\(var\(--issue-depth, 0\) \* 12px\)/,
    );
  });

  it("[代表値] due row indent applies only to hierarchical rows", async () => {
    const css = await loadCss();
    expect(inMedia(css, "max-width: 1199px")).toMatch(
      /\.issue-row\[data-depth\] \.due-cell \{[^}]*padding-left: calc\(var\(--issue-depth, 0\) \* 20px\)/,
    );
    expect(css).toMatch(
      /\.issue-row\[data-depth\]\.has-toggle-column \.due-cell \{[^}]*\* 20px \+ 28px\)/,
    );
    const mobile = inMedia(css, "max-width: 767px");
    expect(mobile).toMatch(/\.issue-row\[data-depth\] \.due-cell \{[^}]*\* 12px\)/);
    expect(mobile).toMatch(
      /\.issue-row\[data-depth\]\.has-toggle-column \.due-cell \{[^}]*\* 12px \+ 36px\)/,
    );
    expect(css).not.toMatch(/\.issue-row \.due-cell \{[^}]*--issue-depth/);
  });

  it("[代表値] toggle is 24px (32px on mobile) with a 16px body-text glyph", async () => {
    const css = await loadCss();
    const toggle = rule(css, ".issue-children-toggle");
    expect(toggle).toMatch(/font-size: 16px/);
    expect(toggle).toMatch(/color: var\(--orbit-text/);
    expect(rule(css, ".issue-children-toggle:focus-visible")).toMatch(/outline:/);
    expect(inMedia(css, "max-width: 767px")).toMatch(
      /\.issue-children-toggle, \.issue-children-toggle-spacer \{[^}]*width: 32px/,
    );
  });

  it("[代表値] child progress badge and parent hint rules exist", async () => {
    const css = await loadCss();
    expect(rule(css, ".issue-child-progress")).toMatch(/border-radius: 99px/);
    const hint = rule(css, ".issue-parent-hint");
    expect(hint).toMatch(/font-size: 11px/);
    expect(hint).toMatch(/text-overflow: ellipsis/);
    expect(hint).toMatch(/white-space: nowrap/);
  });
});
