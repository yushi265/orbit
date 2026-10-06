import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";
import { CyclesView, OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const MOBILE_HINT = "↑ / ↓ ボタンで並び替えます。";
const DESKTOP_HINT = "ハンドルをドラッグ、またはAlt+↑ / Alt+↓で並び替えます。";

function mobileBlocks() {
  return [...styles.matchAll(/@media \(max-width: 767px\) \{(.*)\}\s*$/gm)].map(([, body]) => body);
}
function mobileCss() {
  return mobileBlocks().join("\n");
}
function outsideMobileCss() {
  return styles.replace(/@media \(max-width: 767px\) \{.*\}\s*$/gm, "");
}

describe("touch reorder CSS contract", () => {
  it("[状態遷移] ↑/↓ボタンは全幅で表示し、デスクトップでも24x24px以上 (AC-12)", () => {
    const rule = outsideMobileCss().match(/\.touch-move-button \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).not.toMatch(/display: none/);
    expect(rule).toMatch(/min-width: 24px/);
    expect(rule).toMatch(/min-height: 24px/);
  });

  it("[境界値] mobile(767px以下)でボタンを表示し44x44px以上にする", () => {
    const css = mobileCss();
    const rule = css.match(/\.touch-move-button \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/display: inline-grid/);
    expect(rule).toMatch(/min-width: 44px/);
    expect(rule).toMatch(/min-height: 44px/);
  });

  it("[状態遷移] mobileではdrag handleを隠す", () => {
    expect(mobileCss()).toMatch(
      /\.reorder-cell \.drag-handle, \.cycle-reorder-controls \.drag-handle \{ display: none; \}/,
    );
  });

  it("[状態遷移] ヒントはmobileでは専用文言、desktopでは従来文言を表示する", () => {
    expect(outsideMobileCss()).toMatch(/\.hint-mobile \{[^}]*display: none;/);
    const css = mobileCss();
    expect(css).toMatch(/\.hint-desktop \{ display: none; \}/);
    expect(css).toMatch(/\.hint-mobile \{ display: inline; \}/);
  });

  it("[境界値] manual orderのmobile gridは2ボタン分(88px)のMOVE列を持つ", () => {
    expect(styles).toContain("grid-template-columns: 88px 44px minmax(0, 1fr) 80px 44px;");
  });
});

describe("Issue list touch reorder", () => {
  let dom: JSDOM;
  let root: Root;
  let data: ReturnType<typeof reviewBootstrap>;
  let posts: Array<{
    body: Record<string, unknown>;
    resolve: (value: Response) => void;
  }>;
  let patches: Array<{ resolve: (value: Response) => void }>;

  function response(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/issues?order=manual",
    });
    Object.defineProperty(dom.window, "matchMedia", {
      value: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    vi.stubGlobal("window", dom.window);
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
    root = createRoot(dom.window.document.getElementById("root")!);
    queryClient.clear();
    data = reviewBootstrap([
      reviewIssue("one", { identifier: "TASK-1", position: 0 }),
      reviewIssue("two", { identifier: "TASK-2", position: 1 }),
      reviewIssue("three", { identifier: "TASK-3", position: 2 }),
    ]);
    queryClient.setQueryData(["bootstrap"], data);
    posts = [];
    patches = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        if (path === "/api/v1/bootstrap" && method === "GET")
          return Promise.resolve(response(data));
        if (path === "/api/v1/background-runs/current" && method === "GET")
          return Promise.resolve(response({ run: null }));
        if (path === "/api/v1/issues/reorder" && method === "POST")
          return new Promise<Response>((resolveFn) =>
            posts.push({
              body: JSON.parse(init.body as string),
              resolve: resolveFn,
            }),
          );
        if (/^\/api\/v1\/issues\/[^/?]+$/.test(path) && method === "PATCH")
          return new Promise<Response>((resolveFn) => patches.push({ resolve: resolveFn }));
        return Promise.reject(new Error(`Unexpected request ${method} ${path}`));
      }),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    dom.window.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render(order: "manual" | "updated_desc" = "manual") {
    await act(async () =>
      root.render(
        createElement(OrbitApp, {
          initialSection: "issues",
          issueSearch: { order, completed: true },
        }),
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
  }
  function touch(id: string, dir: "上" | "下") {
    return dom.window.document.querySelector(
      `button.touch-move-button[aria-label="TASK-${id}を${dir}へ移動"]`,
    ) as HTMLButtonElement | null;
  }

  it("[代表値] 中間行の↑はAlt+↑と同じreorderを送る", async () => {
    await render();
    const up = touch("2", "上")!;
    expect(up).not.toBeNull();
    expect(up.type).toBe("button");
    expect(up.textContent).toBe("↑");
    await act(async () => up.click());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      issueId: "two",
      beforeIssueId: "one",
    });
  });

  it("[代表値] 中間行の↓はAlt+↓と同じreorderを送る", async () => {
    await render();
    const down = touch("2", "下")!;
    expect(down.textContent).toBe("↓");
    await act(async () => down.click());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      issueId: "two",
      beforeIssueId: null,
    });
  });

  it("[境界値] 先頭行の↑と末尾行の↓はdisabled、中間は両方有効", async () => {
    await render();
    expect(touch("1", "上")!.disabled).toBe(true);
    expect(touch("1", "下")!.disabled).toBe(false);
    expect(touch("2", "上")!.disabled).toBe(false);
    expect(touch("2", "下")!.disabled).toBe(false);
    expect(touch("3", "上")!.disabled).toBe(false);
    expect(touch("3", "下")!.disabled).toBe(true);
  });

  it("[状態遷移] reorder送信中は全行の↑/↓がdisabledになる", async () => {
    await render();
    await act(async () => touch("2", "上")!.click());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(posts).toHaveLength(1);
    for (const id of ["1", "2", "3"]) {
      expect(touch(id, "上")!.disabled).toBe(true);
      expect(touch(id, "下")!.disabled).toBe(true);
    }
    const moved = { ...data.issues[1], position: -1, version: 2 };
    data = { ...data, issues: [data.issues[0], moved, data.issues[2]] };
    await act(async () => posts[0].resolve(response({ issue: moved })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    // 完了後は新しい並び(TASK-2, TASK-1, TASK-3)に対して境界が再計算される。
    expect(touch("2", "上")!.disabled).toBe(true);
    expect(touch("2", "下")!.disabled).toBe(false);
    expect(touch("1", "上")!.disabled).toBe(false);
    expect(touch("1", "下")!.disabled).toBe(false);
    expect(touch("3", "上")!.disabled).toBe(false);
    expect(touch("3", "下")!.disabled).toBe(true);
  });

  it("[境界値] Issueが1件だけなら↑/↓の両方がdisabled", async () => {
    data = reviewBootstrap([reviewIssue("one", { identifier: "TASK-1", position: 0 })]);
    queryClient.setQueryData(["bootstrap"], data);
    await render();
    expect(touch("1", "上")!.disabled).toBe(true);
    expect(touch("1", "下")!.disabled).toBe(true);
  });

  it("[境界値] 親子表示では兄弟内の先頭↑・末尾↓だけをdisabledにする", async () => {
    data = reviewBootstrap([
      reviewIssue("one", { identifier: "TASK-1", position: 0 }),
      reviewIssue("two", { identifier: "TASK-2", position: 1, parentId: "one" }),
      reviewIssue("three", { identifier: "TASK-3", position: 2, parentId: "one" }),
      reviewIssue("four", { identifier: "TASK-4", position: 3 }),
    ]);
    queryClient.setQueryData(["bootstrap"], data);
    await render();
    // moveIssue は同じ親を持つ兄弟の間だけで動くため、表示行の位置ではなく兄弟内の位置で判定する
    expect(touch("1", "上")!.disabled).toBe(true);
    expect(touch("1", "下")!.disabled).toBe(false);
    expect(touch("2", "上")!.disabled).toBe(true);
    expect(touch("2", "下")!.disabled).toBe(false);
    expect(touch("3", "上")!.disabled).toBe(false);
    expect(touch("3", "下")!.disabled).toBe(true);
    expect(touch("4", "上")!.disabled).toBe(false);
    expect(touch("4", "下")!.disabled).toBe(true);
  });

  it("[状態遷移] 行のpending(Issue更新中)はその行の↑/↓をdisabledにし、完了で戻る", async () => {
    await render();
    const priority = dom.window.document.querySelector(
      'select[aria-label="TASK-2のPriority"]',
    ) as HTMLSelectElement;
    await act(async () => {
      priority.value = "urgent";
      priority.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(patches).toHaveLength(1);
    expect(touch("2", "上")!.disabled).toBe(true);
    expect(touch("2", "下")!.disabled).toBe(true);
    expect(touch("1", "下")!.disabled).toBe(false);
    expect(touch("3", "上")!.disabled).toBe(false);
    const updated = { ...data.issues[1], priority: "urgent" as const, version: 2 };
    data = { ...data, issues: [data.issues[0], updated, data.issues[2]] };
    await act(async () => patches[0].resolve(response({ issue: updated })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(touch("2", "上")!.disabled).toBe(false);
    expect(touch("2", "下")!.disabled).toBe(false);
  });

  it("[状態遷移] 手動並び替えでない並び順では↑/↓ボタンを出さない", async () => {
    await render("updated_desc");
    expect(dom.window.document.querySelectorAll(".touch-move-button")).toHaveLength(0);
  });

  it("[代表値] ヒントはdesktop文言とmobile文言の両方を持ち、既存のdrag handleも残る", async () => {
    await render();
    const hint = dom.window.document.querySelector("p.manual-order-hint")!;
    expect(hint.querySelector(".hint-desktop")?.textContent).toBe(DESKTOP_HINT);
    expect(hint.querySelector(".hint-mobile")?.textContent).toBe(MOBILE_HINT);
    expect(
      dom.window.document.querySelector('button.drag-handle[aria-label="TASK-2の並び替え"]'),
    ).not.toBeNull();
  });
});

describe("Cycle list touch reorder", () => {
  const cycle = {
    id: "cycle-touch",
    userId: "owner",
    number: 1,
    name: "Cycle 1",
    nameOverride: null,
    description: "",
    startsAt: 1,
    endsAt: 2,
    status: "active" as const,
    completedAt: null,
    scheduleOverridden: false,
  };
  const workflowStates: WorkflowState[] = [
    {
      id: "state-todo",
      userId: "owner",
      name: "Todo",
      category: "unstarted",
      color: "#888888",
      position: 0,
      isDefault: true,
    },
  ];
  function issue(n: number): Issue {
    return {
      id: `issue-${n}`,
      userId: "owner",
      number: n,
      identifier: `TASK-${n}`,
      title: `Issue ${n}`,
      description: "",
      statusId: "state-todo",
      priority: "no_priority",
      estimate: null,
      dueAt: null,
      projectId: null,
      cycleId: cycle.id,
      parentId: null,
      labelIds: [],
      position: n,
      version: 1,
      archivedAt: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
  }
  const issues = [issue(1), issue(2), issue(3)];
  function props(onReorder: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
    return {
      cycles: [cycle],
      cycleHistory: [],
      issues,
      workflowStates,
      pendingIssueId: null,
      reorderBusy: false,
      onUpdateIssue: () => undefined,
      onReorder,
      onRefresh: () => undefined,
      onNavigateIssues: () => undefined,
      onNavigateCycles: () => undefined,
      closeBusy: false,
      startBusy: false,
      onClose: () => undefined,
      onStart: async () => false,
      ...overrides,
    };
  }
  let dom: JSDOM;
  let root: Root;
  beforeEach(() => {
    dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(dom.window.document.getElementById("root")!);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
  function touch(id: number, dir: "上" | "下") {
    return dom.window.document.querySelector(
      `button.touch-move-button[aria-label="TASK-${id}を${dir}へ移動"]`,
    ) as HTMLButtonElement | null;
  }

  it("[代表値] 中間行の↑/↓はAlt+Arrowと同じCycle scope付きreorderを呼ぶ", async () => {
    const onReorder = vi.fn();
    await act(async () => root.render(createElement(CyclesView, props(onReorder))));
    await act(async () => touch(2, "上")!.click());
    expect(onReorder).toHaveBeenLastCalledWith(issues[1], "issue-1", {
      cycleId: cycle.id,
    });
    await act(async () => touch(2, "下")!.click());
    expect(onReorder).toHaveBeenCalledTimes(2);
    expect(onReorder).toHaveBeenLastCalledWith(issues[1], null, {
      cycleId: cycle.id,
    });
  });

  it("[境界値] 先頭行の↑と末尾行の↓はdisabledでreorderを呼ばない", async () => {
    const onReorder = vi.fn();
    await act(async () => root.render(createElement(CyclesView, props(onReorder))));
    expect(touch(1, "上")!.disabled).toBe(true);
    expect(touch(1, "下")!.disabled).toBe(false);
    expect(touch(3, "上")!.disabled).toBe(false);
    expect(touch(3, "下")!.disabled).toBe(true);
    await act(async () => touch(1, "上")!.click());
    await act(async () => touch(3, "下")!.click());
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("[境界値] Issueが1件だけなら↑/↓の両方がdisabled", async () => {
    await act(async () =>
      root.render(createElement(CyclesView, props(vi.fn(), { issues: [issues[0]] }))),
    );
    expect(touch(1, "上")!.disabled).toBe(true);
    expect(touch(1, "下")!.disabled).toBe(true);
  });

  it("[状態遷移] reorderBusy / 対象Issueのpending中はdisabledにする", async () => {
    const onReorder = vi.fn();
    await act(async () =>
      root.render(createElement(CyclesView, props(onReorder, { reorderBusy: true }))),
    );
    expect(touch(2, "上")!.disabled).toBe(true);
    expect(touch(2, "下")!.disabled).toBe(true);
    await act(async () =>
      root.render(createElement(CyclesView, props(onReorder, { pendingIssueId: "issue-2" }))),
    );
    expect(touch(2, "上")!.disabled).toBe(true);
    expect(touch(2, "下")!.disabled).toBe(true);
    expect(touch(1, "下")!.disabled).toBe(false);
  });

  it("[状態遷移] Completed Cycleでは↑/↓を出さない", async () => {
    const markup = renderToStaticMarkup(
      createElement(
        CyclesView,
        props(vi.fn(), {
          cycles: [{ ...cycle, status: "completed" as const, completedAt: 3 }],
        }),
      ),
    );
    expect(markup).not.toContain("touch-move-button");
    expect(markup).not.toContain(MOBILE_HINT);
  });

  it("[代表値] Cycleヒントもdesktop/mobileの2文言を持つ", () => {
    const markup = renderToStaticMarkup(createElement(CyclesView, props(vi.fn())));
    expect(markup).toContain(`<span class="hint-desktop">${DESKTOP_HINT}</span>`);
    expect(markup).toContain(`<span class="hint-mobile">${MOBILE_HINT}</span>`);
  });
});
