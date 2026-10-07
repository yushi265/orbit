import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../routeTree.gen";
import { queryClient } from "../lib/query";
import { IssuesView, OrbitApp } from "./OrbitApp";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));

const issuesViewProps = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});
const renderIssues = (overrides: Record<string, unknown> = {}) =>
  new JSDOM(renderToStaticMarkup(createElement(IssuesView, issuesViewProps(overrides) as never)))
    .window.document;

describe("Issue experience UI contract", () => {
  describe("colorThemeの導線", () => {
    let dom: JSDOM;
    let root: Root;
    let patches: Array<Record<string, unknown>>;
    let failPatch: boolean;

    beforeEach(() => {
      vi.useFakeTimers();
      dom = new JSDOM("<!doctype html><div id='root'></div>", {
        url: "https://orbit.example/settings",
      });
      Object.defineProperty(dom.window, "matchMedia", {
        value: () => ({
          matches: false,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      });
      for (const [name, method] of [
        ["attachEvent", "addEventListener"],
        ["detachEvent", "removeEventListener"],
      ] as const) {
        Object.defineProperty(dom.window.HTMLElement.prototype, name, {
          value: function (this: HTMLElement, event: string, handler: EventListener) {
            this[method](event.replace(/^on/, ""), handler);
          },
        });
      }
      vi.stubGlobal("window", dom.window);
      vi.stubGlobal("document", dom.window.document);
      vi.stubGlobal("navigator", dom.window.navigator);
      vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
      vi.stubGlobal("Node", dom.window.Node);
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      root = createRoot(dom.window.document.getElementById("root")!);
      queryClient.clear();
      const boot = reviewBootstrap();
      queryClient.setQueryData(["bootstrap"], boot);
      patches = [];
      failPatch = false;
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        });
      vi.stubGlobal(
        "fetch",
        vi.fn((path: string, init: RequestInit = {}) => {
          if (path === "/api/v1/preferences" && init.method === "PATCH") {
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            patches.push(body);
            if (failPatch) return Promise.resolve(json({ error: { message: "failed" } }, 500));
            return Promise.resolve(
              json({ preferences: { ...boot.preferences, colorTheme: body.colorTheme } }),
            );
          }
          if (path === "/api/v1/bootstrap") return Promise.resolve(json(boot));
          if (path === "/api/v1/background-runs/current")
            return Promise.resolve(json({ run: null }));
          return Promise.resolve(json({}));
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

    const select = () =>
      dom.window.document.querySelector(
        'select[aria-labelledby="setting-color-theme-label"]',
      ) as HTMLSelectElement;
    async function changeColorTheme(value: string) {
      await act(async () => root.render(createElement(OrbitApp, { initialSection: "settings" })));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(
        select(),
        value,
      );
      await act(async () => {
        select().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTimeAsync(0));
    }

    it("[代表値] Settingsのcolor theme変更はPATCHされ、swatch・data属性・通知へ反映する", async () => {
      await changeColorTheme("ocean");

      expect(patches).toHaveLength(1);
      expect(patches[0]).toMatchObject({ colorTheme: "ocean" });
      expect(typeof patches[0].idempotencyKey).toBe("string");
      expect(dom.window.document.documentElement.dataset.colorTheme).toBe("ocean");
      expect(select().value).toBe("ocean");
      expect(dom.window.document.querySelector(".color-theme-swatch")).not.toBeNull();
      expect(dom.window.document.body.textContent).toContain("カラーテーマを変更しました");
    });

    it("[異常系] color theme保存に失敗したらselectを直前の値へ戻し再試行を出す", async () => {
      failPatch = true;
      await changeColorTheme("ocean");

      expect(patches).toHaveLength(1);
      expect(select().value).toBe("coral");
      expect(dom.window.document.documentElement.dataset.colorTheme).toBe("coral");
      expect(dom.window.document.body.textContent).not.toContain("カラーテーマを変更しました");
      expect(
        [...dom.window.document.querySelectorAll("button")].some(
          (button) => button.textContent === "再試行",
        ),
      ).toBe(true);
    });
  });

  it("[アクセシビリティ/境界値] Priority label、Keyboard移動、responsive幅の契約を持つ", () => {
    const issue = reviewIssue("1");
    const document = renderIssues({
      issues: [issue],
      allIssues: [issue],
      workflowStates: reviewBootstrap().workflowStates,
      issueSort: "manual",
    });

    expect(document.querySelector('.priority-icon[role="img"][aria-label]')).not.toBeNull();
    expect(document.querySelector(`[aria-label="${issue.identifier}のPriority"]`)).not.toBeNull();
    const handle = document.querySelector(`[aria-label="${issue.identifier}の並び替え"]`);
    expect(handle?.getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowUp Alt+ArrowDown");

    const rules = parseStyleRules();
    const manualColumns = (media: string | null) =>
      declarationsFor(rules, ".issue-table.manual-order .issue-row", media).get(
        "grid-template-columns",
      );
    expect(manualColumns(null)).toBeTruthy();
    expect(manualColumns("(max-width: 767px)")).toBeTruthy();
    expect(manualColumns("(min-width: 768px) and (max-width: 1023px)")).toBeTruthy();
    expect(manualColumns("(min-width: 768px) and (max-width: 1199px)")).toBeTruthy();
    expect(
      declarationsFor(rules, ':root[data-color-theme="ocean"]').get("--orbit-accent"),
    ).toBeTruthy();
    const prioritySelect = declarationsFor(rules, ".priority-icon-select");
    expect(prioritySelect.get("position")).toBe("absolute");
    expect(prioritySelect.get("opacity")).toBe("0");
  });

  it("[回帰] Project詳細の専用routeを維持する", () => {
    const routes = (
      routeTree as unknown as {
        children: Array<{
          options: { id?: string; component?: unknown; validateSearch?: unknown };
        }>;
      }
    ).children;
    const route = routes.find((child) => child.options.id === "/projects/$projectId");

    expect(route).toBeDefined();
    expect(route?.options.component).toBeTypeOf("function");
    expect(route?.options.validateSearch).toBeTypeOf("function");
  });

  it("[代表値] Issues見出しの補足文を表示しない", () => {
    const markup = renderToStaticMarkup(createElement(IssuesView, issuesViewProps() as never));

    expect(markup).toContain("<h1>Issues</h1>");
    expect(markup).toContain("＋ 新しいIssue");
    expect(markup).not.toContain("すべての作業を、ここから見渡します。");
  });
});
