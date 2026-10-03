import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  IssueViewModel as Issue,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";
import { CyclesView } from "./OrbitApp";

const cycle = {
  id: "cycle-reorder-ui",
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
  {
    id: "state-started",
    userId: "owner",
    name: "Started",
    category: "started",
    color: "#4f7cff",
    position: 1,
    isDefault: false,
  },
];

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    userId: "owner",
    number: 1,
    identifier: "TASK-1",
    title: "最初のIssue",
    description: "",
    statusId: "state-todo",
    priority: "no_priority",
    estimate: null,
    dueAt: null,
    projectId: null,
    cycleId: cycle.id,
    parentId: null,
    labelIds: [],
    position: 0,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function view() {
  return createElement(CyclesView, {
    cycles: [cycle],
    cycleHistory: [],
    issues: [],
    workflowStates: [],
    pendingIssueId: null,
    onUpdateIssue: () => undefined,
    onRefresh: () => undefined,
    onNavigateIssues: () => undefined,
    onNavigateCycles: () => undefined,
    closeBusy: false,
    startBusy: false,
    onClose: () => undefined,
    onStart: async () => false,
  });
}

function interactiveView(issues: Issue[], onReorder: ReturnType<typeof vi.fn>) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(dom.window.document.getElementById("root")!);
  return {
    dom,
    root,
    element: createElement(CyclesView, {
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
    }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Cycle reorder UI", () => {
  it("[代表値] Cycle詳細はIssue表示をList / Boardで切り替えられる", () => {
    const markup = renderToStaticMarkup(view());

    expect(markup).toContain("List");
    expect(markup).toContain("Board");
  });

  it("[代表値] ListのAlt+Arrow操作は同じCycle scope付きreorderを呼び出す", async () => {
    const first = issue();
    const last = issue({
      id: "issue-2",
      number: 2,
      identifier: "TASK-2",
      title: "次のIssue",
      position: 1,
    });
    const onReorder = vi.fn();
    const { dom, root, element } = interactiveView([first, last], onReorder);

    await act(async () => root.render(element));
    const moveUp = dom.window.document.querySelector(
      'button.drag-handle[aria-label="TASK-2の並び替え"]',
    ) as HTMLButtonElement;
    expect(moveUp).not.toBeNull();
    expect(moveUp.disabled).toBe(false);
    expect(moveUp.closest(".cycle-issue-row")?.getAttribute("draggable")).toBe("true");
    moveUp.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onReorder).toHaveBeenCalledWith(last, first.id, { cycleId: cycle.id });
    await act(async () => root.unmount());
  });

  it("[代表値] ListのDrag & Dropも同一Cycle scopeでreorderを呼び出す", async () => {
    const first = issue();
    const last = issue({
      id: "issue-2",
      number: 2,
      identifier: "TASK-2",
      title: "次のIssue",
      position: 1,
    });
    const onReorder = vi.fn();
    const { dom, root, element } = interactiveView([first, last], onReorder);

    await act(async () => root.render(element));
    const firstRow = dom.window.document.querySelector('[data-issue-id="issue-1"]') as HTMLElement;
    const lastRow = dom.window.document.querySelector('[data-issue-id="issue-2"]') as HTMLElement;
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    const dragStart = new dom.window.Event("dragstart", { bubbles: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    const dragOver = new dom.window.Event("dragover", { bubbles: true });
    const drop = new dom.window.Event("drop", { bubbles: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });

    await act(async () => firstRow.dispatchEvent(dragStart));
    await act(async () => lastRow.dispatchEvent(dragOver));
    await act(async () => lastRow.dispatchEvent(drop));

    expect(onReorder).toHaveBeenCalledWith(first, null, { cycleId: cycle.id });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", first.id);
    await act(async () => root.unmount());
  });

  it("[代表値] Boardは同一Status列のscopeを付け、Completed Cycleでは操作を出さない", async () => {
    const first = issue();
    const last = issue({
      id: "issue-2",
      number: 2,
      identifier: "TASK-2",
      title: "次のIssue",
      position: 1,
    });
    const started = issue({
      id: "issue-3",
      number: 3,
      identifier: "TASK-3",
      title: "Started Issue",
      statusId: "state-started",
      position: 2,
    });
    const onReorder = vi.fn();
    const { dom, root, element } = interactiveView([first, last, started], onReorder);

    await act(async () => root.render(element));
    const boardToggle = [...dom.window.document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Board"),
    ) as HTMLButtonElement;
    await act(async () => boardToggle.click());
    expect(dom.window.document.querySelector(".cycle-board-grid")).not.toBeNull();
    const moveUp = dom.window.document.querySelector(
      'button.drag-handle[aria-label="TASK-2の並び替え"]',
    ) as HTMLButtonElement;
    const globalKey = vi.fn();
    dom.window.addEventListener("keydown", globalKey);
    moveUp.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(globalKey).not.toHaveBeenCalled();
    expect(onReorder).toHaveBeenCalledWith(last, first.id, {
      cycleId: cycle.id,
      statusId: "state-todo",
    });
    expect(dom.window.document.querySelectorAll(".cycle-board-card")).toHaveLength(3);
    const firstHandle = dom.window.document.querySelector(
      'button.drag-handle[aria-label="TASK-1の並び替え"]',
    )!;
    const singleColumnHandle = dom.window.document.querySelector(
      'button.drag-handle[aria-label="TASK-3の並び替え"]',
    )!;
    firstHandle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    singleColumnHandle.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(globalKey).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          ...element.props,
          cycles: [{ ...cycle, status: "completed" as const, completedAt: 3 }],
        }),
      );
    });
    expect(dom.window.document.querySelectorAll(".cycle-reorder-controls")).toHaveLength(0);
    expect(dom.window.document.body.textContent).not.toContain("解除");
    await act(async () => root.unmount());
  });

  it("[状態遷移] reorder送信中はCycleの順序操作をdisabledにする", async () => {
    const onReorder = vi.fn();
    const { dom, root, element } = interactiveView(
      [issue(), issue({ id: "issue-2", identifier: "TASK-2", position: 1 })],
      onReorder,
    );
    const busyElement = createElement(CyclesView, {
      ...element.props,
      reorderBusy: true,
    });

    await act(async () => root.render(busyElement));
    const moveDown = dom.window.document.querySelector(
      'button.drag-handle[aria-label="TASK-1の並び替え"]',
    ) as HTMLButtonElement;
    const row = dom.window.document.querySelector('[data-issue-id="issue-1"]') as HTMLElement;
    expect(moveDown.disabled).toBe(true);
    expect(row.getAttribute("draggable")).toBe("false");
    moveDown.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onReorder).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it.each(["List", "Board"])(
    "[Focus/Nativeblur故障注入] Cycle %sのKeyboard保存完了後に同handleへ戻す",
    async (mode) => {
      const first = issue();
      const last = issue({ id: "issue-2", identifier: "TASK-2", position: 1 });
      const onReorder = vi.fn();
      const { dom, root, element } = interactiveView([first, last], onReorder);
      await act(async () => root.render(element));
      if (mode === "Board")
        await act(async () =>
          [...dom.window.document.querySelectorAll("button")]
            .find((button) => button.textContent?.includes("Board"))!
            .click(),
        );
      const origin = dom.window.document.querySelector(
        'button.drag-handle[aria-label="TASK-2の並び替え"]',
      ) as HTMLButtonElement;
      await act(async () => {
        origin.focus();
        origin.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "ArrowUp",
            altKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(onReorder).toHaveBeenCalledTimes(1);
      await act(async () =>
        root.render(createElement(CyclesView, { ...element.props, reorderBusy: true })),
      );
      expect(origin.disabled).toBe(true);
      // JSDOM's disabled blur guard differs from Chromium's native pending blur.
      origin.disabled = false;
      origin.blur();
      origin.disabled = true;
      expect(dom.window.document.activeElement?.tagName).toBe("BODY");
      await act(async () =>
        root.render(
          createElement(CyclesView, {
            ...element.props,
            issues: [first, { ...last, position: -1 }],
            reorderBusy: false,
          }),
        ),
      );
      expect(dom.window.document.activeElement?.getAttribute("aria-label")).toBe(
        "TASK-2の並び替え",
      );
      expect(dom.window.document.activeElement).toBe(origin);
      await act(async () => root.unmount());
    },
  );

  it("[Keyboard→pointer] Cycleの未完了Keyboard意図もDragstartで取り消す", async () => {
    const first = issue();
    const last = issue({ id: "issue-2", identifier: "TASK-2", position: 1 });
    const onReorder = vi.fn();
    const { dom, root, element } = interactiveView([first, last], onReorder);
    await act(async () => root.render(element));
    const origin = dom.window.document.querySelector(
      'button.drag-handle[aria-label="TASK-2の並び替え"]',
    ) as HTMLButtonElement;
    await act(async () => {
      origin.focus();
      origin.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowUp",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const drag = new dom.window.Event("dragstart", { bubbles: true });
    Object.defineProperty(drag, "dataTransfer", { value: { effectAllowed: "", setData: vi.fn() } });
    await act(async () => origin.dispatchEvent(drag));
    await act(async () =>
      root.render(createElement(CyclesView, { ...element.props, reorderBusy: true })),
    );
    origin.disabled = false;
    origin.blur();
    origin.disabled = true;
    await act(async () =>
      root.render(createElement(CyclesView, { ...element.props, reorderBusy: false })),
    );
    expect(dom.window.document.activeElement?.tagName).toBe("BODY");
    await act(async () => root.unmount());
  });

  it("[アクセシビリティ/レスポンシブ] Cycle reorderの操作名と主要CSSを公開する", () => {
    const markup = renderToStaticMarkup(
      createElement(CyclesView, {
        ...view().props,
        issues: [issue()],
        workflowStates,
      }),
    );
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(markup).toContain('aria-label="Cycle Issue表示形式"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="TASK-1の並び替え"');
    expect(markup).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
    expect(markup).not.toContain('class="reorder-button"');
    expect(styles).toContain(".cycle-issue-toolbar");
    expect(styles).toContain(".cycle-board-card");
    expect(styles).toContain("@media (max-width: 767px)");
  });

  it("[デシジョンテーブル] Cycle詳細は他Cycle・削除済みIssueを表示しない", () => {
    const foreign = issue({
      id: "foreign-issue",
      identifier: "TASK-9",
      title: "他CycleのIssue",
      cycleId: "other-cycle",
      position: 1,
    });
    const deleted = issue({
      id: "deleted-issue",
      identifier: "TASK-10",
      title: "削除済みIssue",
      deletedAt: 3,
      position: 2,
    });
    const markup = renderToStaticMarkup(
      createElement(CyclesView, {
        ...view().props,
        issues: [issue(), foreign, deleted],
        workflowStates,
      }),
    );

    expect(markup).toContain("最初のIssue");
    expect(markup).not.toContain("他CycleのIssue");
    expect(markup).not.toContain("削除済みIssue");
  });

  it("[代表値] Listは入力配列ではなく保存済みposition順で表示する", () => {
    const markup = renderToStaticMarkup(
      createElement(CyclesView, {
        ...view().props,
        issues: [
          issue({ id: "issue-2", identifier: "TASK-2", title: "後のIssue", position: 2 }),
          issue({ id: "issue-1", identifier: "TASK-1", title: "先のIssue", position: 1 }),
        ],
        workflowStates,
      }),
    );

    expect([...markup.matchAll(/class="issue-id">([^<]+)/g)].map(([, value]) => value)).toContain(
      "TASK-1",
    );
    expect(markup.indexOf("先のIssue")).toBeLessThan(markup.indexOf("後のIssue"));
  });
});
