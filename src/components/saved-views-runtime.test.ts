import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ViewsView } from "./OrbitApp";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";
import type { SavedViewViewModel } from "../shared/view-models";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn() }),
}));
let dom: JSDOM;
let root: Root;
const query = {
  mode: "list" as const,
  filter: { priorities: ["high"] },
  group: "label",
  layout: { priority: false },
  showEmptyGroups: true,
  order: "updated",
  limit: 7,
  cursor: "preserved",
};
const view: SavedViewViewModel = {
  id: "view-1",
  userId: "owner",
  name: "High",
  query,
  layout: query.layout,
  createdAt: 1,
  updatedAt: 1,
};
const data = reviewBootstrap([
  reviewIssue("high", { dueAt: Date.UTC(2026, 9, 3) }),
  reviewIssue("low", { priority: "low" }),
]);
const onSelectView = vi.fn();
const onOpenIssue = vi.fn();
const onRefresh = vi.fn();
beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/views?view=view-1",
  });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(name, value);
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.addEventListener(name.replace(/^on/, ""), handler);
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.removeEventListener(name.replace(/^on/, ""), handler);
    },
  });
  root = createRoot(dom.window.document.getElementById("root")!);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});
async function render(selectedViewId: string | null = view.id, views = [view]) {
  await act(async () =>
    root.render(
      createElement(ViewsView, {
        views,
        data,
        selectedViewId,
        onSelectView,
        onOpenIssue,
        onRefresh,
        now: Date.UTC(2026, 9, 3),
      }),
    ),
  );
}
function button(text: string) {
  return [...dom.window.document.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  )!;
}
describe("Saved View workspace", () => {
  it("[期限表示] non-null due date renders with the Owner timezone without treating it as a locale", async () => {
    expect(data.preferences.timezone).toBe("Asia/Tokyo");
    await render();
    expect(
      dom.window.document.querySelector('[data-issue-id="high"] .saved-view-issue-meta')
        ?.textContent,
    ).toContain("10月3日");
  });
  it("[復元/条件適用/詳細] restored selection renders matching Issues and opens the target", async () => {
    await render();
    expect(dom.window.document.querySelector('[aria-label="HighのIssue"]')?.textContent).toContain(
      "TASK-high",
    );
    expect(
      dom.window.document.querySelector('[aria-label="HighのIssue"]')?.textContent,
    ).not.toContain("TASK-low");
    await act(async () =>
      (dom.window.document.querySelector('[data-issue-id="high"]') as HTMLButtonElement).click(),
    );
    expect(onOpenIssue).toHaveBeenCalledWith(data.issues[0]);
    await render(null);
    await act(async () =>
      (dom.window.document.querySelector(".saved-view-select") as HTMLButtonElement).click(),
    );
    expect(onSelectView).toHaveBeenCalledWith(view.id);
  });
  it("[切替/Board/空結果] switching selects the saved mode and updates the matching set", async () => {
    const board: SavedViewViewModel = {
      ...view,
      id: "board",
      name: "Low",
      query: { ...query, mode: "board", filter: { priorities: ["low"] } },
    };
    await render(board.id, [view, board]);
    expect(
      dom.window.document.querySelector('[aria-label="LowのIssue"] .board-grid'),
    ).not.toBeNull();
    expect(dom.window.document.querySelector('[aria-label="LowのIssue"]')?.textContent).toContain(
      "TASK-low",
    );
    expect(
      dom.window.document.querySelector('[aria-label="LowのIssue"]')?.textContent,
    ).not.toContain("TASK-high");
    const empty: SavedViewViewModel = {
      ...board,
      query: { ...board.query, filter: { text: "no matches" } },
    };
    await render(empty.id, [empty]);
    expect(dom.window.document.querySelector('[aria-label="LowのIssue"]')?.textContent).toContain(
      "条件に一致するIssueはありません",
    );
  });
  it("[編集保存] editing mode preserves multiple filters and advanced query fields", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ view }), { headers: { "content-type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await render();
    await act(async () => button("編集").click());
    await act(async () => {
      const select = dom.window.document.querySelector("#saved-view-mode") as HTMLSelectElement;
      select.value = "board";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => button("保存").click());
    expect(JSON.parse(fetch.mock.calls[0][1].body).query).toEqual({ ...query, mode: "board" });
    expect(onRefresh).toHaveBeenCalledOnce();
  });
  it("[作成保存] chosen filters are sent and the new View becomes selected", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ view }), { headers: { "content-type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await render(null, []);
    await act(async () => button("＋ Viewを保存").click());
    await act(async () => {
      const input = dom.window.document.querySelector("#saved-view-name") as HTMLInputElement;
      input.focus();
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "High",
      );
      input.dispatchEvent(
        Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
          propertyName: "value",
        }),
      );
      (
        dom.window.document.querySelector(
          'input[aria-label="View Priority: urgent"]',
        ) as HTMLInputElement
      ).click();
    });
    await act(async () => {
      (
        dom.window.document.querySelector(
          'input[aria-label="View Priority: high"]',
        ) as HTMLInputElement
      ).click();
    });
    await act(async () => button("保存").click());
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      name: "High",
      query: { filter: { priorities: ["urgent", "high"] } },
    });
    expect(onSelectView).toHaveBeenCalledWith(view.id);
  });
  it("[保存失敗/再試行] busy lock keeps the draft and reuses the request key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "OPERATION_IN_PROGRESS", message: "処理中です" } }),
          { status: 423, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ view }), { headers: { "content-type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await render();
    await act(async () => button("編集").click());
    await act(async () => button("保存").click());
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "処理中です",
    );
    expect((dom.window.document.querySelector("#saved-view-name") as HTMLInputElement).value).toBe(
      "High",
    );
    await act(async () => button("再試行").click());
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(
      JSON.parse(fetch.mock.calls[0][1].body),
    );
  });
  it("[Mobile条件/既存値] checkbox selection preserves unknown IDs and empty action opens creation", async () => {
    const legacy: SavedViewViewModel = {
      ...view,
      query: {
        ...query,
        order: "estimate",
        filter: { priorities: ["high"], projectIds: ["unknown"] },
      },
    };
    await render(legacy.id, [legacy]);
    expect(dom.window.document.querySelector(".view-inspector-meta")?.textContent).toContain(
      "estimate",
    );
    await act(async () => button("編集").click());
    expect(dom.window.document.querySelector("select[multiple]")).toBeNull();
    expect(
      (
        dom.window.document.querySelector(
          'input[aria-label="View Project: unknown（既存条件）"]',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    await act(async () => button("Priorityを解除").click());
    expect(dom.window.document.querySelector("details:first-of-type")?.textContent).toContain(
      "すべて",
    );
    await render(null, []);
    await act(async () => button("Viewを作成 →").click());
    expect(dom.window.document.querySelector(".view-editor")?.textContent).toContain(
      "Saved Viewを作成",
    );
  });
  it("[削除/空] delete clears URL selection and empty list gives an Issues action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await render();
    await act(async () => button("削除").click());
    expect(onSelectView).toHaveBeenCalledWith(null);
    await render(null, []);
    expect(dom.window.document.body.textContent).toContain("Saved Viewはまだありません");
  });
});
