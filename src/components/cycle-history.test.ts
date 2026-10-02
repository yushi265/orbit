import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CyclesView, IssueCycleHistorySection } from "./OrbitApp";

const cycles = [
  {
    id: "cycle-history-ui-from",
    userId: "owner",
    number: 1,
    name: "Cycle 1",
    nameOverride: null,
    description: "",
    startsAt: Date.parse("2026-08-03T00:00:00.000Z"),
    endsAt: Date.parse("2026-08-17T00:00:00.000Z"),
    status: "completed" as const,
    completedAt: Date.parse("2026-08-17T00:00:00.000Z"),
    scheduleOverridden: false,
  },
  {
    id: "cycle-history-ui-to",
    userId: "owner",
    number: 2,
    name: "Cycle 2",
    nameOverride: "Current focus",
    description: "",
    startsAt: Date.parse("2026-08-17T00:00:00.000Z"),
    endsAt: Date.parse("2026-08-31T00:00:00.000Z"),
    status: "active" as const,
    completedAt: null,
    scheduleOverridden: false,
  },
];

const cycleHistory = [
  {
    id: "cycle-history-ui-entry",
    issue: { id: "issue-history-ui", identifier: "TASK-1", title: "繰越Issue" },
    fromCycle: { id: "cycle-history-ui-from", number: 1, name: "Cycle 1" },
    toCycle: { id: "cycle-history-ui-to", number: 2, name: "Current focus" },
    movedAt: Date.parse("2026-08-17T00:00:00.000Z"),
  },
];

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

function renderCycles() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(dom.window.document.getElementById("root")!);
  return { dom, root };
}

afterEach(() => vi.unstubAllGlobals());

describe("Cycle history UI", () => {
  it("[代表値] Cycle履歴に繰越件数と繰越Issueの元Cycleを表示する", async () => {
    const { dom, root } = renderCycles();

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles,
          cycleHistory,
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
        }),
      );
    });

    expect(dom.window.document.body.textContent).toContain("繰越 1件");
    expect(dom.window.document.body.textContent).toContain("TASK-1");
    expect(dom.window.document.body.textContent).toContain("繰越Issue");
    expect(dom.window.document.body.textContent).toContain("元Cycle: Cycle 1");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[代表値] Issue詳細に繰越回数と元Cycleから移行先Cycleを表示する", async () => {
    const { dom, root } = renderCycles();

    await act(async () => {
      root.render(
        createElement(IssueCycleHistorySection, {
          cycleHistory,
          carryoverCount: 1,
        }),
      );
    });

    expect(dom.window.document.body.textContent).toContain("繰越 1回");
    expect(dom.window.document.body.textContent).toContain("Cycle 1 → Current focus");
    expect(dom.window.document.body.textContent).toContain("8月17日");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] Cycle履歴0件は件数0と説明的な空状態を表示する", async () => {
    const { dom, root } = renderCycles();

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles: [cycles[1]],
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
        }),
      );
    });

    expect(dom.window.document.body.textContent).toContain("繰越 0件");
    expect(dom.window.document.body.textContent).toContain(
      "このCycleへ繰り越されたIssueはありません。",
    );
    expect(
      dom.window.document.querySelector('[aria-label="このCycleへ繰り越されたIssue"]'),
    ).not.toBeNull();

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] Issue詳細の繰越履歴0件は件数0と空状態を表示する", async () => {
    const { dom, root } = renderCycles();

    await act(async () => {
      root.render(
        createElement(IssueCycleHistorySection, {
          cycleHistory: [],
          carryoverCount: 0,
        }),
      );
    });

    expect(dom.window.document.body.textContent).toContain("繰越 0回");
    expect(dom.window.document.body.textContent).toContain("このIssueの繰越履歴はありません。");
    expect(dom.window.document.querySelector('[aria-label="IssueのCycle履歴"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] Issue詳細の複数履歴を受け取った順に表示する", async () => {
    const { dom, root } = renderCycles();
    const entries = [
      cycleHistory[0],
      {
        ...cycleHistory[0],
        id: "cycle-history-ui-older",
        fromCycle: { id: "cycle-history-ui-older-from", number: 0, name: "Cycle 0" },
        movedAt: Date.parse("2026-08-03T00:00:00.000Z"),
      },
    ];

    await act(async () => {
      root.render(
        createElement(IssueCycleHistorySection, {
          cycleHistory: entries,
          carryoverCount: entries.length,
        }),
      );
    });

    expect(
      [...dom.window.document.querySelectorAll(".cycle-history-route strong")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Cycle 1 → Current focus", "Cycle 0 → Current focus"]);

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] Cycle履歴rowはfocus可能でPointer選択を維持する", async () => {
    const { dom, root } = renderCycles();

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles,
          cycleHistory,
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
        }),
      );
    });

    const firstCycleRow = dom.window.document.querySelector(
      ".cycle-row-button",
    ) as HTMLButtonElement;
    expect(firstCycleRow).not.toBeNull();
    expect(firstCycleRow.disabled).toBe(false);
    firstCycleRow.focus();
    expect(dom.window.document.activeElement).toBe(firstCycleRow);
    await act(async () => {
      firstCycleRow.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(dom.window.document.body.textContent).toContain("COMPLETED CYCLE · #1");
    await act(async () => {
      firstCycleRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(dom.window.document.body.textContent).toContain("COMPLETED CYCLE · #1");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[デシジョンテーブル] Cycle履歴のincoming件数をCycleごとに分離する", async () => {
    const { dom, root } = renderCycles();
    const thirdCycle = {
      ...cycles[1],
      id: "cycle-history-ui-third",
      number: 3,
      name: "Cycle 3",
      nameOverride: null,
      status: "upcoming" as const,
      completedAt: null,
    };
    const entries = [
      cycleHistory[0],
      {
        ...cycleHistory[0],
        id: "cycle-history-ui-third-entry",
        issue: { id: "issue-history-ui-third", identifier: "TASK-2", title: "別の繰越Issue" },
        fromCycle: { id: "cycle-history-ui-to", number: 2, name: "Current focus" },
        toCycle: { id: thirdCycle.id, number: 3, name: "Cycle 3" },
        movedAt: Date.parse("2026-08-24T00:00:00.000Z"),
      },
    ];

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles: [...cycles, thirdCycle],
          cycleHistory: entries,
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
        }),
      );
    });

    expect(
      [...dom.window.document.querySelectorAll(".cycle-carryover-count")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["繰越 0件", "繰越 1件", "繰越 1件"]);
    const thirdRow = [...dom.window.document.querySelectorAll(".cycle-row-button")].find((row) =>
      row.textContent?.includes("Cycle 3"),
    );
    expect(thirdRow).not.toBeUndefined();
    await act(async () => {
      thirdRow?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(dom.window.document.body.textContent).toContain("別の繰越Issue");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[境界値] Cycle履歴表示は390pxで縦積み・wrapできるCSS契約を持つ", () => {
    expect(appSource).toContain('aria-label="IssueのCycle履歴"');
    expect(appSource).toContain('aria-label="このCycleへ繰り越されたIssue"');
    expect(styles).toContain(".cycle-history-route strong");
    expect(styles).toContain("white-space: normal;");
    expect(styles).toContain(
      "@media (max-width: 767px) { .cycle-carryover-row { align-items: flex-start; flex-direction: column;",
    );
    expect(styles).toContain(".cycle-history-row { display: flex; align-items: flex-start;");
    expect(styles).toContain(
      ':root[data-theme="dark"] .cycle-history-route strong { color: var(--orbit-text); }',
    );
    expect(styles).toContain(
      ':root[data-theme="dark"] .cycle-history-row { border-color: var(--orbit-border); }',
    );
  });

  it("[境界値] 390px相当のIssue履歴DOMは固定幅を持たず折り返し対象になる", async () => {
    const { dom, root } = renderCycles();
    const rootElement = dom.window.document.getElementById("root")!;
    rootElement.style.width = "390px";
    const longEntry = {
      ...cycleHistory[0],
      fromCycle: { ...cycleHistory[0].fromCycle, name: "元Cycle ".repeat(30) },
      toCycle: { ...cycleHistory[0].toCycle, name: "移行先Cycle ".repeat(30) },
    };

    await act(async () => {
      root.render(
        createElement(IssueCycleHistorySection, {
          cycleHistory: [longEntry],
          carryoverCount: 1,
        }),
      );
    });

    const row = dom.window.document.querySelector(".cycle-history-row") as HTMLElement;
    expect(rootElement.style.width).toBe("390px");
    expect(row.style.width).toBe("");
    expect(row.querySelector(".cycle-history-route strong")?.textContent).toContain("元Cycle");
    expect(styles).toContain(".cycle-history-route strong");
    expect(styles).toContain("white-space: normal;");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] Bootstrapのloading/error/retry導線と履歴prop配線を維持する", () => {
    expect(appSource).toContain("if (bootstrap.isLoading)");
    // Cached refetch failures and initial failures are behavior-tested in
    // followup-shell-runtime.test.ts, rather than tied to a source guard string.
    expect(appSource).toContain("onClick={() => bootstrap.refetch()}");
    expect(appSource).toContain("cycleHistory={data.cycleHistory}");
  });
});
