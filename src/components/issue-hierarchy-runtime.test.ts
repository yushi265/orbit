import { act } from "react";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { IssueSearch } from "../lib/url-state/issues";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";
let dom: JSDOM;
let app: RenderedApp | undefined;
let data: ReturnType<typeof reviewBootstrap>;
let posts: Array<Record<string, unknown>>;
let unexpected: string[];
const STORAGE_KEY = "orbit.issues.collapsedParents";
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function buildData() {
  const base = reviewBootstrap([
    reviewIssue("P", { identifier: "TASK-P", title: "Parent", position: 0 }),
    reviewIssue("A", { identifier: "TASK-A", title: "Child A", position: 1, parentId: "P" }),
    reviewIssue("B", {
      identifier: "TASK-B",
      title: "Child B",
      position: 2,
      parentId: "P",
      statusId: "done",
    }),
    reviewIssue("X", { identifier: "TASK-X", title: "Other", position: 3 }),
    reviewIssue("Y", { identifier: "TASK-Y", title: "Last", position: 4 }),
  ]);
  const todo = base.workflowStates[0];
  base.workflowStates = [
    todo,
    { ...todo, id: "done", name: "Done", category: "completed", position: 1, isDefault: false },
  ];
  return base;
}
beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/issues" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    value: function (this: HTMLElement, name: string, listener: EventListener) {
      this.addEventListener(name.replace(/^on/, ""), listener);
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    value: function (this: HTMLElement, name: string, listener: EventListener) {
      this.removeEventListener(name.replace(/^on/, ""), listener);
    },
  });
  data = buildData();
  posts = [];
  unexpected = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET") return Promise.resolve(response(data));
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(response({ run: null }));
      const detail = /^\/api\/v1\/issues\/([^/?]+)$/.exec(path);
      if (detail && method === "GET")
        return Promise.resolve(
          response(reviewDetail(data.issues.find((issue) => issue.id === detail[1]))),
        );
      if (path === "/api/v1/recent-issue-views" && method === "POST")
        return Promise.resolve(response({}));
      if (path === "/api/v1/issues/reorder" && method === "POST") {
        posts.push(JSON.parse(init.body as string));
        return new Promise<Response>(() => undefined);
      }
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error("Unexpected request"));
    }),
  );
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
async function render(search: IssueSearch = { order: "manual", completed: true }) {
  app = await renderApp({
    url: `/issues?${new URLSearchParams(Object.entries(search).map(([key, value]) => [key, String(value)]))}`,
    container: dom.window.document.getElementById("root")!,
  });
  await settle();
}
const doc = () => dom.window.document;
function row(id: string) {
  return doc()
    .querySelector(`[data-issue-id="${id}"]`)
    ?.closest(".issue-row") as HTMLElement | null;
}
function visibleIds() {
  return [...doc().querySelectorAll(".issue-row [data-issue-id]")].map((element) =>
    element.getAttribute("data-issue-id"),
  );
}
function toggle(id: string) {
  return row(id)!.querySelector("button.issue-children-toggle") as HTMLButtonElement;
}
async function altDown(id: string) {
  const handle = row(id)!.querySelector("button.drag-handle") as HTMLButtonElement;
  await act(async () => {
    handle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await settle();
}
function setIssues(list: ReturnType<typeof reviewIssue>[]) {
  data = { ...data, issues: list };
}
function interleavedIssues() {
  return [
    reviewIssue("P1", { position: 0 }),
    reviewIssue("c1", { position: 1, parentId: "P1" }),
    reviewIssue("P2", { position: 2 }),
    reviewIssue("c2", { position: 3, parentId: "P2" }),
    reviewIssue("P3", { position: 4 }),
  ];
}
async function altUp(id: string) {
  const handle = row(id)!.querySelector("button.drag-handle") as HTMLButtonElement;
  await act(async () => {
    handle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await settle();
}
async function drag(fromId: string, toId: string) {
  const dataTransfer = { effectAllowed: "", setData: () => undefined };
  const fire = (target: HTMLElement, type: string) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    target.dispatchEvent(event);
  };
  await act(async () => fire(row(fromId)!, "dragstart"));
  await act(async () => fire(row(toId)!, "dragover"));
  await act(async () => fire(row(toId)!, "drop"));
  await settle();
}

describe("Issues list hierarchy", () => {
  it("[AC-1,3,5] nests children, shows toggle and progress badge", async () => {
    await render();
    expect(visibleIds()).toEqual(["P", "A", "B", "X", "Y"]);
    expect(row("A")!.getAttribute("data-depth")).toBe("1");
    expect(row("A")!.style.getPropertyValue("--issue-depth")).toBe("1");
    expect(row("P")!.getAttribute("data-depth")).toBe("0");
    const button = toggle("P");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("子Issueを折りたたむ");
    const badge = row("P")!.querySelector(".issue-child-progress")!;
    expect(badge.textContent).toBe("1/2");
    expect(badge.getAttribute("aria-label")).toBe("子Issue 1 / 2 完了");
    expect(row("X")!.querySelector(".issue-child-progress, .issue-children-toggle")).toBeNull();
  });

  it("[AC-3,4] toggling collapses descendants and persists in localStorage", async () => {
    await render();
    await act(async () => toggle("P").click());
    expect(visibleIds()).toEqual(["P", "X", "Y"]);
    expect(toggle("P").getAttribute("aria-expanded")).toBe("false");
    expect(toggle("P").getAttribute("aria-label")).toBe("子Issueを展開する");
    expect(row("P")!.querySelector(".issue-child-progress")?.textContent).toBe("1/2");
    expect(JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY)!)).toEqual(["P"]);
    expect(doc().querySelector(".detail-panel, [role='dialog']")).toBeNull();
    await act(async () => toggle("P").click());
    expect(visibleIds()).toEqual(["P", "A", "B", "X", "Y"]);
    expect(JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("[AC-4] starts collapsed from stored ids", async () => {
    dom.window.localStorage.setItem(STORAGE_KEY, '["P"]');
    await render();
    expect(visibleIds()).toEqual(["P", "X", "Y"]);
    expect(toggle("P").getAttribute("aria-expanded")).toBe("false");
  });

  it("[AC-4] broken stored JSON falls back to all open", async () => {
    dom.window.localStorage.setItem(STORAGE_KEY, "{broken");
    await render();
    expect(visibleIds()).toEqual(["P", "A", "B", "X", "Y"]);
  });

  it("[AC-6] child of a filtered-out parent is top level with a parent hint", async () => {
    await render({ order: "manual", completed: true, status: "done" });
    expect(visibleIds()).toEqual(["B"]);
    expect(row("B")!.getAttribute("data-depth")).toBe("0");
    expect(row("B")!.querySelector("span.issue-parent-hint")?.textContent).toBe("↳ TASK-P Parent");
  });

  it("[AC-7] Alt+ArrowDown only moves among visible siblings", async () => {
    await render();
    await altDown("A");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ issueId: "A", beforeIssueId: "X" });
  });

  it("[AC-7] Alt+ArrowDown at the end of siblings does nothing (child and top level)", async () => {
    await render();
    await altDown("B");
    await altDown("Y");
    expect(posts).toHaveLength(0);
  });

  it("[AC-7] Alt+ArrowDown on a middle top-level row moves over the whole subtree", async () => {
    await render();
    await altDown("P");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ issueId: "P", beforeIssueId: "Y" });
  });

  it("[AC-7] drop works between siblings only", async () => {
    await render();
    await drag("A", "X");
    await drag("A", "P");
    expect(posts).toHaveLength(0);
    await drag("A", "B");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ issueId: "A", beforeIssueId: "X" });
  });

  it("[AC-8] select-all selects only visible rows", async () => {
    dom.window.localStorage.setItem(STORAGE_KEY, '["P"]');
    await render();
    const all = doc().querySelector('input[aria-label="全選択"]') as HTMLInputElement;
    await act(async () => all.click());
    expect(doc().body.textContent).toContain("3件選択中");
    expect(
      (doc().querySelector('input[aria-label="TASK-Xを選択"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect(doc().querySelector('input[aria-label="TASK-Aを選択"]')).toBeNull();
  });

  it("[AC-9] board view and flat lists show no hierarchy UI", async () => {
    await render({ order: "manual", completed: true, mode: "board" });
    expect(
      doc().querySelector(
        ".issue-children-toggle, .issue-child-progress, .issue-parent-hint, [data-depth]",
      ),
    ).toBeNull();
  });

  it("[AC-9] spacer exists only when some row has a toggle", async () => {
    await render();
    expect(doc().querySelector(".issue-children-toggle-spacer")).not.toBeNull();
    expect(row("X")!.querySelector(".issue-children-toggle-spacer")).not.toBeNull();
    expect(row("P")!.querySelector(".issue-children-toggle-spacer")).toBeNull();
    expect(row("X")!.classList.contains("has-toggle-column")).toBe(true);
  });

  it("[AC-9] flat list has no toggle, badge or parent hint", async () => {
    data = reviewBootstrap([
      reviewIssue("one", { identifier: "TASK-1", position: 0 }),
      reviewIssue("two", { identifier: "TASK-2", position: 1 }),
    ]);
    await render();
    expect(visibleIds()).toEqual(["one", "two"]);
    expect(doc().querySelector(".issue-children-toggle-spacer, .has-toggle-column")).toBeNull();
    expect(
      doc().querySelector(".issue-children-toggle, .issue-child-progress, .issue-parent-hint"),
    ).toBeNull();
  });

  it("[AC-1] depth is capped at 3 in --issue-depth over five generations", async () => {
    setIssues([
      reviewIssue("g0", { position: 0 }),
      reviewIssue("g1", { position: 1, parentId: "g0" }),
      reviewIssue("g2", { position: 2, parentId: "g1" }),
      reviewIssue("g3", { position: 3, parentId: "g2" }),
      reviewIssue("g4", { position: 4, parentId: "g3" }),
    ]);
    await render();
    const ids = ["g0", "g1", "g2", "g3", "g4"];
    expect(ids.map((id) => row(id)!.getAttribute("data-depth"))).toEqual(["0", "1", "2", "3", "4"]);
    expect(ids.map((id) => row(id)!.style.getPropertyValue("--issue-depth"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "3",
    ]);
  });

  describe("[AC-8] selection follows visible rows", () => {
    const check = (id: string) =>
      doc().querySelector(`input[aria-label="TASK-${id}を選択"]`) as HTMLInputElement | null;
    it("drops a selected child from the selection when its parent is collapsed", async () => {
      await render();
      await act(async () => check("A")!.click());
      expect(doc().body.textContent).toContain("1件選択中");
      await act(async () => toggle("P").click());
      expect(doc().body.textContent).not.toContain("件選択中");
      await act(async () => toggle("P").click());
      expect(check("A")!.checked).toBe(false);
      expect(doc().body.textContent).not.toContain("件選択中");
    });
    it("keeps a selected parent when it is collapsed with its selected child", async () => {
      await render();
      await act(async () => check("P")!.click());
      await act(async () => check("A")!.click());
      expect(doc().body.textContent).toContain("2件選択中");
      await act(async () => toggle("P").click());
      expect(doc().body.textContent).toContain("1件選択中");
      const all = doc().querySelector('input[aria-label="全選択"]') as HTMLInputElement;
      expect(all.checked).toBe(false);
    });
    it("[AC-9] keeps a Board selection of a child whose parent is collapsed in the List", async () => {
      await render();
      await act(async () => (doc().querySelector('[data-issue-id="A"]') as HTMLElement).focus());
      await act(async () => toggle("P").click());
      expect(visibleIds()).toEqual(["P", "X", "Y"]);
      await act(async () => {
        await app!.router.navigate({
          to: "/issues",
          search: { order: "manual", completed: true, mode: "board" },
        });
      });
      await settle();
      await act(async () => {
        doc().body.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true }),
        );
      });
      expect(doc().body.textContent).toContain("1件選択中");
    });
    it("select-all is checked once every visible row is selected", async () => {
      dom.window.localStorage.setItem(STORAGE_KEY, '["P"]');
      await render();
      const all = doc().querySelector('input[aria-label="全選択"]') as HTMLInputElement;
      await act(async () => all.click());
      expect(all.checked).toBe(true);
    });
    it("a child row can be selected", async () => {
      await render();
      await act(async () => check("A")!.click());
      expect(check("A")!.checked).toBe(true);
    });
  });

  describe("[AC-7] reorder beforeIssueId with interleaved positions", () => {
    beforeEach(() => setIssues(interleavedIssues()));
    it("Alt+ArrowDown on P1 targets after sibling P2 (before c2)", async () => {
      await render();
      expect(visibleIds()).toEqual(["P1", "c1", "P2", "c2", "P3"]);
      await altDown("P1");
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ issueId: "P1", beforeIssueId: "c2" });
    });
    it("Alt+ArrowUp on P2 targets before sibling P1", async () => {
      await render();
      await altUp("P2");
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ issueId: "P2", beforeIssueId: "P1" });
    });
    it("drop P3 onto P1 goes before P1", async () => {
      await render();
      await drag("P3", "P1");
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ issueId: "P3", beforeIssueId: "P1" });
    });
    it("drop P1 onto P3 goes to the end", async () => {
      await render();
      await drag("P1", "P3");
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ issueId: "P1", beforeIssueId: null });
    });
    it("drop between children of different parents calls nothing", async () => {
      await render();
      await drag("c1", "c2");
      expect(posts).toHaveLength(0);
    });
    it("[S-3] a collapsed parent still reorders with the same beforeIssueId (Alt+Down)", async () => {
      await render();
      await act(async () => toggle("P1").click());
      expect(visibleIds()).toEqual(["P1", "P2", "c2", "P3"]);
      await altDown("P1");
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ issueId: "P1", beforeIssueId: "c2" });
    });
    it("[S-3] a collapsed parent still reorders with the same beforeIssueId (Alt+Up)", async () => {
      await render();
      await act(async () => toggle("P1").click());
      await altUp("P2");
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ issueId: "P2", beforeIssueId: "P1" });
    });
  });

  it("[AC-8] opens the issue from parent and child rows", async () => {
    await render();
    for (const id of ["P", "A"]) {
      await act(async () =>
        (doc().querySelector(`[data-issue-id="${id}"]`) as HTMLElement).click(),
      );
      await settle();
      expect(app!.router.state.location.pathname).toBe(`/issues/${id}`);
    }
  });
});
