import { act } from "react";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

type Section =
  | "home"
  | "issues"
  | "cycles"
  | "projects"
  | "search"
  | "inbox"
  | "views"
  | "settings";
let dom: JSDOM;
let app: RenderedApp | undefined;
let unexpected: string[];
let unread = 0;
let mediaListeners: Array<(event: { matches: boolean }) => void>;
const first = reviewIssue("issue-1", { title: "needle" });
const second = reviewIssue("issue-2", { title: "other", priority: "low", labelIds: [] });
function payload() {
  const base = reviewBootstrap([first, second]);
  const notifications = Array.from({ length: unread }, (_, index) => ({
    id: `notification-${index}`,
    userId: "owner",
    type: "issue",
    title: "unread",
    body: "",
    entityType: "issue",
    entityId: "issue-1",
    readAt: null,
    deletedAt: null,
    createdAt: 1,
  }));
  return { ...base, notifications };
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/issues" });
  mediaListeners = [];
  Object.defineProperty(dom.window, "matchMedia", {
    value: (query: string) => ({
      matches: false,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
        if (query === "(min-width: 768px)") mediaListeners.push(listener);
      },
      removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
        mediaListeners = mediaListeners.filter((item) => item !== listener);
      },
    }),
  });
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
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  unread = 0;
  unexpected = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET") return Promise.resolve(json(payload()));
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(json({ run: null }));
      if (path === "/api/v1/recent" && method === "GET")
        return Promise.resolve(json({ issueViews: [], searches: [] }));
      if (path === "/api/v1/recent-issue-views" && method === "POST")
        return Promise.resolve(json({}));
      if (path === "/api/v1/issues/issue-1" && method === "GET")
        return Promise.resolve(json(reviewDetail(first)));
      if (path === "/api/v1/issues?scope=archived" && method === "GET")
        return Promise.resolve(json({ items: [first] }));
      if (path === "/api/v1/issues?scope=trash" && method === "GET")
        return Promise.resolve(json({ items: [] }));
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error(`Unexpected API request: ${method} ${path}`));
    }),
  );
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const sectionUrls: Record<Section, string> = {
  home: "/",
  inbox: "/inbox",
  issues: "/issues",
  cycles: "/cycles",
  projects: "/projects",
  search: "/search",
  views: "/views",
  settings: "/settings",
};
async function render(url = "/issues") {
  app = await renderApp({ url, container: dom.window.document.getElementById("root")! });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settled();
  return app.router;
}
const doc = () => dom.window.document as unknown as Document;
const q = <T extends Element = HTMLElement>(selector: string) => doc().querySelector<T>(selector);
const qa = (selector: string) => [...doc().querySelectorAll<HTMLElement>(selector)];
async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).focus();
    (element as HTMLElement).click();
  });
}
async function press(target: Element, init: KeyboardEventInit) {
  await act(async () =>
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    ),
  );
}
const tabLabel = (element: Element) =>
  element.getAttribute("aria-label") ?? element.querySelector("span:nth-child(2)")?.textContent;
const menuTab = () => q<HTMLButtonElement>(".mobile-menu-tab")!;
const sheet = () => q('[role="dialog"][aria-label="メニュー"]');
const filterButton = () => q<HTMLButtonElement>(".filter-sheet-button")!;
const filterSheet = () => q('[role="dialog"][aria-label="フィルター"]');
const labelOf = (item: Element) => item.querySelector("span:nth-child(2)")?.textContent;

describe("mobile bottom navigation", () => {
  it("[代表値/AC-1] 下部タブは Home / Inbox / Create / Search / Menu の順に5つ", async () => {
    await render();
    const items = [...q(".mobile-nav")!.children];
    expect(items.map(tabLabel)).toEqual(["Home", "Inbox", "Issueを作成", "Search", "Menu"]);
    expect(items[2].classList.contains("mobile-create")).toBe(true);
  });
  it.each([
    [0, null],
    [3, "3"],
  ])("[同値分割/AC-1] Inboxバッジ: 未読%i件 -> %s", async (count, badge) => {
    unread = count;
    await render();
    expect(q(".mobile-nav .nav-badge")?.textContent ?? null).toBe(badge);
  });
  it("[代表値/AC-1] Createを押すとIssue作成ダイアログが開く", async () => {
    await render();
    expect(q(".composer")).toBeNull();
    await click(q(".mobile-create")!);
    expect(q(".composer")).not.toBeNull();
  });
});

describe("mobile Menu sheet", () => {
  it("[代表値/AC-2/AC-3] Menuタブでシートが開き、項目は Issues から Settings の順で最初へフォーカス", async () => {
    await render();
    expect(sheet()).toBeNull();
    expect(menuTab().getAttribute("aria-haspopup")).toBe("dialog");
    expect(menuTab().getAttribute("aria-expanded")).toBe("false");
    await click(menuTab());
    const dialog = sheet()!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(menuTab().getAttribute("aria-expanded")).toBe("true");
    const items = [...dialog.querySelectorAll(".nav-item")];
    expect(items.map(labelOf)).toEqual(["Issues", "Cycles", "Projects", "Views", "Settings"]);
    expect(doc().activeElement).toBe(items[0]);
  });
  it.each(["Issues", "Cycles", "Projects", "Views", "Settings"])(
    "[同値分割/AC-2] 項目 %s を押すと移動してシートが閉じる",
    async (name) => {
      const router = await render();
      const navigate = vi.spyOn(router, "navigate");
      await click(menuTab());
      const item = [...sheet()!.querySelectorAll(".nav-item")].find((i) => labelOf(i) === name)!;
      await click(item);
      await settled();
      expect(navigate).toHaveBeenCalledOnce();
      const to = router.state.location.pathname;
      expect(to).toBe(name === "Settings" ? "/settings" : `/${name.toLowerCase()}`);
      expect(sheet()).toBeNull();
    },
  );
  it("[状態遷移/AC-3] Escapeで閉じてMenuタブへフォーカスが戻る", async () => {
    await render();
    await click(menuTab());
    await press(doc().activeElement!, {});
    expect(sheet()).toBeNull();
    expect(doc().activeElement).toBe(menuTab());
  });
  it("[状態遷移/AC-3] 背景の押下で閉じる（シート内の押下では閉じない）", async () => {
    await render();
    await click(menuTab());
    await click(q(".mobile-menu-sheet")!);
    expect(sheet()).not.toBeNull();
    await click(q(".mobile-menu-backdrop")!);
    expect(sheet()).toBeNull();
    expect(doc().activeElement).toBe(menuTab());
  });
  it("[状態遷移/AC-3] 閉じるボタンで閉じる", async () => {
    await render();
    await click(menuTab());
    await click(q('[aria-label="メニューを閉じる"]')!);
    expect(sheet()).toBeNull();
    expect(doc().activeElement).toBe(menuTab());
  });
  it("[代表値] 開いたまま768px以上になると自動で閉じる", async () => {
    await render();
    await click(menuTab());
    expect(mediaListeners).toHaveLength(1);
    await act(async () => mediaListeners.forEach((listener) => listener({ matches: false })));
    expect(sheet()).not.toBeNull();
    await act(async () => mediaListeners.forEach((listener) => listener({ matches: true })));
    expect(sheet()).toBeNull();
    expect(mediaListeners).toHaveLength(0);
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "[同値分割/AC-3] IME変換中のEscapeでは閉じない: %j",
    async (ime) => {
      await render();
      await click(menuTab());
      await press(doc().activeElement!, ime);
      expect(sheet()).not.toBeNull();
      await press(doc().activeElement!, {});
      expect(sheet()).toBeNull();
    },
  );
});

describe("aria-current and selected Menu tab", () => {
  const menuSections = ["issues", "cycles", "projects", "views", "settings"];
  const tabSections = ["home", "inbox", "search"];
  it.each([...tabSections, ...menuSections] as Section[])(
    "[デシジョンテーブル/AC-4] 現在の画面 %s",
    async (current) => {
      await render(sectionUrls[current]);
      const label = current[0].toUpperCase() + current.slice(1);
      const tabs = [...q(".mobile-nav")!.querySelectorAll("[aria-current]")].map(labelOf);
      expect(tabs).toEqual(tabSections.includes(current) ? [label] : []);
      expect(menuTab().classList.contains("active")).toBe(menuSections.includes(current));
      expect(menuTab().hasAttribute("aria-current")).toBe(false);
      const sidebar = [...q(".sidebar")!.querySelectorAll("[aria-current]")].map(labelOf);
      expect(sidebar).toEqual([label]);
      await click(menuTab());
      const inSheet = [...sheet()!.querySelectorAll("[aria-current]")].map(labelOf);
      expect(inSheet).toEqual(menuSections.includes(current) ? [label] : []);
      for (const element of [
        ...q(".sidebar")!.querySelectorAll("[aria-current]"),
        ...sheet()!.querySelectorAll("[aria-current]"),
      ])
        expect(element.getAttribute("aria-current")).toBe("page");
    },
  );
});

describe("mobile filter sheet", () => {
  const closedLabels = () => qa(".filter-field-label").map((item) => item.textContent);
  it("[状態遷移/AC-5/AC-6] 閉: roleなし・完了ボタンなし → 開: dialog・見えるラベル7種・完了ボタン", async () => {
    await render("/issues");
    const fields = q(".filter-fields")!;
    expect(fields.hasAttribute("role")).toBe(false);
    expect(q(".filter-sheet-done")).toBeNull();
    expect(q(".filter-sheet-backdrop")).toBeNull();
    expect(filterButton().textContent).toContain("フィルター");
    expect(filterButton().getAttribute("aria-haspopup")).toBe("dialog");
    expect(filterButton().getAttribute("aria-expanded")).toBe("false");
    await click(filterButton());
    const dialog = filterSheet()!;
    expect(dialog).toBe(q(".filter-fields.open"));
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(filterButton().getAttribute("aria-expanded")).toBe("true");
    expect(doc().activeElement).toBe(q("#issues-status-filter"));
    expect(closedLabels()).toEqual([
      "Status",
      "Priority",
      "Project",
      "表示範囲",
      "Label",
      "並び順",
      "期限",
    ]);
    expect(dialog.querySelector("h2")?.textContent).toBe("フィルター");
    expect(q(".filter-sheet-done")?.textContent).toBe("完了");
    expect(dialog.querySelector(".completed-toggle input")).not.toBeNull();
  });
  it("[同値分割/AC-6] Project詳細ではProjectと表示範囲の欄を出さない", async () => {
    await render("/projects/project-1");
    await click(filterButton());
    expect(closedLabels()).toEqual(["Status", "Priority", "Label", "並び順", "期限"]);
    expect(q("#issues-project-filter")).toBeNull();
    expect(q("#issues-scope-filter")).toBeNull();
  });
  it("[代表値/AC-8] 各欄のidとaria-labelは従来どおり、欄は1組だけ描画される", async () => {
    await render("/issues");
    const ids = [
      "#issues-status-filter",
      "#issues-priority-filter",
      "#issues-project-filter",
      "#issues-scope-filter",
      "#issues-sort-select",
      "#issues-due-filter",
    ];
    for (const id of ids) expect(qa(id)).toHaveLength(1);
    expect(q("#issues-status-filter")!.getAttribute("aria-label")).toBe("Statusで絞り込む");
    expect(q("#issues-priority-filter")!.getAttribute("aria-label")).toBe("Priorityで絞り込む");
    expect(q("#issues-project-filter")!.getAttribute("aria-label")).toBe("Projectで絞り込む");
    expect(q("#issues-scope-filter")!.getAttribute("aria-label")).toBe("Issueの表示範囲");
    expect(q('select[aria-label="Labelで絞り込む"]')).not.toBeNull();
    expect(q("#issues-sort-select")!.getAttribute("aria-label")).toBe("Issueのソート");
    expect(q("#issues-due-filter")!.getAttribute("aria-label")).toBe("Due dateで絞り込む");
    expect(qa(".filter-select")).toHaveLength(7);
    expect(qa(".filter-field")).toHaveLength(7);
  });
  it.each([
    ["/issues", "0", null],
    ["/issues?priority=high", "1", "1"],
    ["/issues?status=todo&priority=high&label=label-1&scope=archived", "4", "4"],
  ])("[同値分割/AC-5] 条件数バッジ %s", async (entry, _n, badge) => {
    await render(entry);
    expect(filterButton().querySelector(".filter-count")?.textContent ?? null).toBe(badge);
  });
  it("[状態遷移/AC-7] Escapeで閉じてフィルターボタンへフォーカスが戻る", async () => {
    await render("/issues");
    await click(filterButton());
    await press(doc().activeElement!, {});
    expect(filterSheet()).toBeNull();
    expect(q(".filter-sheet-done")).toBeNull();
    expect(filterButton().getAttribute("aria-expanded")).toBe("false");
    expect(doc().activeElement).toBe(filterButton());
  });
  it("[状態遷移/AC-7] 背景の押下・完了ボタンで閉じる", async () => {
    await render("/issues");
    await click(filterButton());
    await click(q(".filter-fields")!);
    expect(filterSheet()).not.toBeNull();
    await click(q(".filter-sheet-backdrop")!);
    expect(filterSheet()).toBeNull();
    expect(doc().activeElement).toBe(filterButton());
    await click(filterButton());
    await click(q(".filter-sheet-done")!);
    expect(filterSheet()).toBeNull();
    expect(doc().activeElement).toBe(filterButton());
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "[同値分割/AC-7] IME変換中のEscapeでは閉じない: %j",
    async (ime) => {
      await render("/issues");
      await click(filterButton());
      await press(doc().activeElement!, ime);
      expect(filterSheet()).not.toBeNull();
    },
  );
  it("[代表値/AC-6] Statusを変えるとURLが更新され、シートは開いたままバッジが1になる", async () => {
    const router = await render("/issues");
    const navigate = vi.spyOn(router, "navigate");
    await click(filterButton());
    const status = q("#issues-status-filter") as unknown as HTMLSelectElement;
    await act(async () => {
      status.value = "todo";
      status.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await settled();
    expect(navigate).toHaveBeenCalled();
    expect(router.state.location.search).toMatchObject({ status: "todo" });
    expect(router.history.length).toBe(1);
    expect(filterSheet()).not.toBeNull();
    expect(filterButton().querySelector(".filter-count")?.textContent).toBe("1");
  });
  it("[同値分割/AC-6] 開いたまま768px以上になると自動で閉じる", async () => {
    await render("/issues");
    await click(filterButton());
    expect(mediaListeners).toHaveLength(1);
    await act(async () => mediaListeners.forEach((listener) => listener({ matches: false })));
    expect(filterSheet()).not.toBeNull();
    await act(async () => mediaListeners.forEach((listener) => listener({ matches: true })));
    expect(filterSheet()).toBeNull();
    expect(q(".filter-sheet-backdrop")).toBeNull();
  });
});
