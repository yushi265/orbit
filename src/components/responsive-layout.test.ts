import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CyclesView, IssuesView } from "./OrbitApp";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));

afterEach(() => vi.unstubAllGlobals());

const rules = parseStyleRules();
const MOBILE = "(max-width: 767px)";
const TABLET = "(min-width: 768px) and (max-width: 1023px)";
const BELOW_DESKTOP = "(max-width: 1199px)";

const columns = (selector: string, media: string | null = null) =>
  declarationsFor(rules, selector, media).get("grid-template-columns");
// 行と見出しは常に同じ列数で並ぶ必要があるため、両方の selector を同時に検証する。
const rowAndHeaderColumns = (scope: string, media: string | null = null) => [
  columns(`${scope} .issue-row`, media),
  columns(`${scope} .table-header`, media),
];
const NOT_MANUAL = ".issue-table:not(.manual-order)";
const MANUAL = ".issue-table.manual-order";

describe("responsive issue layout contract", () => {
  it("[境界値] mobileのIssue一覧は本文幅を確保し期限を2行目で編集できる", () => {
    const expected = "44px minmax(0, 1fr) 96px 44px";
    expect(rowAndHeaderColumns(NOT_MANUAL, MOBILE)).toEqual([expected, expected]);

    const due = declarationsFor(rules, ".issue-row .due-cell", BELOW_DESKTOP);
    expect(due.get("grid-column")).toBe("2 / -1");
    expect(due.get("grid-row")).toBe("2");
    const dateInput = declarationsFor(rules, '.due-cell input[type="date"]');
    expect(dateInput.get("width")).toBe("130px");
    expect(dateInput.get("max-width")).toBe("100%");
    expect(dateInput.get("font-size")).toBe("11px");
    // 期限セルは mobile を含むどの breakpoint でも非表示にしない。
    const hiddenDueRule = rules.filter(
      (rule) =>
        rule.selectors.some((selector) => selector.startsWith(".issue-row .due-cell")) &&
        rule.declarations.get("display") === "none",
    );
    expect(hiddenDueRule).toEqual([]);
  });

  it("[境界値] tabletのIssue一覧はProjectを省略し期限は本文下で表示する", () => {
    const expected = "28px minmax(0, 1fr) 105px 100px";
    expect(rowAndHeaderColumns(NOT_MANUAL, TABLET)).toEqual([expected, expected]);
    expect(declarationsFor(rules, ".issue-row .due-cell", BELOW_DESKTOP).get("grid-row")).toBe("2");
    expect(declarationsFor(rules, ".issue-row", BELOW_DESKTOP).has("grid-template-columns")).toBe(
      true,
    );
    expect(declarationsFor(rules, ".issue-row .project-cell", TABLET).get("display")).toBe("none");
    expect(declarationsFor(rules, ".table-header > .due-cell", BELOW_DESKTOP).get("display")).toBe(
      "none",
    );
  });

  it("[境界値] manual orderも表示中の列数とグリッド列数を一致させる", () => {
    const tablet = "32px 28px minmax(0, 1fr) 105px 52px";
    const mobile = "88px 44px minmax(0, 1fr) 80px 44px";
    expect(rowAndHeaderColumns(MANUAL, TABLET)).toEqual([tablet, tablet]);
    expect(rowAndHeaderColumns(MANUAL, MOBILE)).toEqual([mobile, mobile]);
    // 並び替えハンドル列が増える分、期限は3列目から末尾まで伸びる。
    expect(declarationsFor(rules, `${MANUAL} .due-cell`, BELOW_DESKTOP).get("grid-column")).toBe(
      "3 / -1",
    );
  });

  it("[状態遷移] toolbarのList/Board切替は一組で折り返す", () => {
    const markup = renderToStaticMarkup(
      createElement(IssuesView, {
        issues: [],
        scope: "active",
        scopeLoading: false,
        setScope: () => undefined,
        workflowStates: [],
        filterText: "",
        setFilterText: () => undefined,
        priorityFilter: "all",
        setPriorityFilter: () => undefined,
        projectFilter: "all",
        setProjectFilter: () => undefined,
        labelFilter: "all",
        setLabelFilter: () => undefined,
        showCompleted: true,
        setShowCompleted: () => undefined,
        issueSort: "updated_desc",
        setIssueSort: () => undefined,
        projects: [],
        allIssues: [],
        cycles: [],
        labels: [],
        viewMode: "list",
        setViewMode: () => undefined,
        selected: [],
        setSelected: () => undefined,
        pendingIssueId: null,
        reorderBusy: false,
        onUpdate: () => undefined,
        onRestore: () => undefined,
        onFocusIssue: () => undefined,
        filterInputRef: { current: null },
        displayInputRef: { current: null },
        modifierLabel: "Ctrl",
        onReorder: () => undefined,
        onBulk: async () => undefined,
        bulkBusy: false,
        resetBulkMutation: () => undefined,
        onCreate: () => undefined,
        onOpenIssue: () => undefined,
      } as never),
    );
    const group = new JSDOM(markup).window.document.querySelector(".view-toggle-group");

    expect(
      [...group!.querySelectorAll("button")].map((button) => button.textContent?.trim()),
    ).toEqual(["☷ List", "▦ Board"]);
    expect(declarationsFor(rules, ".view-toggle-group").get("display")).toBe("flex");
  });

  it("[境界値] mobileの詳細操作はスクロール領域下端で見切れない", () => {
    // 固定フッターは全幅（メディアクエリ外）で効き、mobileはsafe-areaを下パディングに含める。
    const foot = declarationsFor(rules, ".detail-foot");
    expect(foot.get("position")).toBe("sticky");
    expect(foot.get("bottom")).toBe("0");
    expect(declarationsFor(rules, ".detail-actions", MOBILE).get("padding")).toContain(
      "env(safe-area-inset-bottom)",
    );
    const button = declarationsFor(rules, ".detail-actions .button", MOBILE);
    expect(button.get("flex")).toBe("0 0 auto");
    expect(button.get("min-height")).toBe("44px");
    expect(button.get("padding")).toBe("0 12px");
    expect(button.get("font-size")).toBe("14px");
    expect(button.get("white-space")).toBe("nowrap");
  });

  it("[境界値] 詳細の閉じる操作は固定し、Composerは画面幅に応じて広がる", () => {
    expect(declarationsFor(rules, ".composer.modal-panel").get("width")).toBe("90vw");
    const header = declarationsFor(rules, ".detail-header");
    expect(header.get("position")).toBe("sticky");
    expect(header.get("top")).toBe("0");
    expect(declarationsFor(rules, ".detail-close").get("flex")).toBe("0 0 44px");
    expect(declarationsFor(rules, ".composer.modal-panel", MOBILE).get("width")).toBe("100%");
  });

  it("[境界値] Cycle日付編集はmobileで1列へ縮退し固定幅を持たない", async () => {
    expect(columns(".cycle-schedule-fields")).toBe("repeat(2, minmax(0, 1fr))");
    expect(declarationsFor(rules, ".cycle-schedule-fields").get("display")).toBe("grid");
    expect(columns(".cycle-schedule-fields", MOBILE)).toBe("minmax(0, 1fr)");

    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(dom.window.document.getElementById("root")!);
    const upcoming = {
      id: "cycle-upcoming",
      userId: "owner",
      number: 2,
      name: "Cycle 2",
      nameOverride: null,
      description: "次のCycle",
      startsAt: Date.parse("2026-09-06T15:00:00.000Z"),
      endsAt: Date.parse("2026-09-20T15:00:00.000Z"),
      status: "upcoming" as const,
      completedAt: null,
      scheduleOverridden: false,
    };
    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles: [upcoming],
          cycleId: upcoming.id,
          timezone: "Asia/Tokyo",
          issues: [],
          workflowStates: [],
          pendingIssueId: null,
          onUpdateIssue: () => undefined,
          onRefresh: async () => undefined,
          onNavigateIssues: () => undefined,
          onNavigateCycles: () => undefined,
          closeBusy: false,
          startBusy: false,
          onClose: () => undefined,
          onStart: async () => false,
        }),
      );
    });
    await act(async () =>
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を調整")
        ?.click(),
    );

    const fields = dom.window.document.querySelector(".cycle-schedule-fields")!;
    const inputs = [...fields.querySelectorAll('input[type="date"]')];
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual([
      "Cycle開始日",
      "Cycle終了日",
    ]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("[境界値] tablet(768〜1023px)の設定グリッドは1列のままで暗黙の2列目を作らない", () => {
    const label = declarationsFor(rules, ".label-settings-card");
    expect(label.get("grid-column")).toBe("1 / -1");
    // どの media でも span / auto へ上書きしない。
    for (const rule of rules.filter((r) => r.selectors.includes(".label-settings-card"))) {
      expect(rule.declarations.get("grid-column") ?? "1 / -1").toBe("1 / -1");
    }
    expect(columns(".settings-grid", TABLET)).toBe("minmax(0, 1fr)");
    expect(columns(".settings-grid")).toBe("repeat(2, minmax(280px, 1fr))");
    expect(declarationsFor(rules, ".settings-grid").get("display")).toBe("grid");
  });
});
