import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleViewModel } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

// 見出し凝縮: パンくずとページ見出しの重複をなくし、ページ名は上部バーの h1 に1つだけ出す。

let dom: JSDOM;
let app: RenderedApp | undefined;
const issue = reviewIssue("issue-1", { title: "needle" });
const cycle: CycleViewModel = {
  id: "cycle-1",
  userId: "owner",
  number: 1,
  name: "Cycle 1",
  nameOverride: null,
  description: "",
  startsAt: Date.UTC(2026, 9, 1),
  endsAt: Date.UTC(2026, 9, 14),
  status: "active",
  completedAt: null,
  scheduleOverridden: false,
};
let payload = { ...reviewBootstrap([issue]), cycles: [cycle] };
let detail = reviewDetail(issue);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  payload = { ...reviewBootstrap([issue]), cycles: [cycle] };
  detail = reviewDetail(issue);
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  // node 環境の React が入力欄のフォーカスで呼ぶ（他の runtime テストと同じスタブ）
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
  // Label 設定への遷移後のスクロールが使う（jsdom に無い API）
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(callback, 0),
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/v1/bootstrap") return json(payload);
      if (path.startsWith("/api/v1/background-runs")) return json({ run: null });
      if (path === "/api/v1/issues/issue-1") return json(detail);
      if (path.startsWith("/api/v1/issues/"))
        return json({ error: { code: "NOT_FOUND", message: "見つかりません" } }, 404);
      if (path.startsWith("/api/v1/recent")) return json({ issueViews: [], searches: [] });
      return json({ items: [] });
    }),
  );
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.unstubAllGlobals();
});

const doc = () => dom.window.document;
async function open(url: string) {
  app = await renderApp({ url, container: doc().getElementById("root")! });
  await vi.waitFor(() => expect(doc().querySelector("h1")).not.toBeNull());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const h1s = () => [...doc().querySelectorAll("h1")];

describe("見出し凝縮: ページ名は上部バーの h1 だけ", () => {
  it.each([
    ["/", "Home"],
    ["/inbox", "Inbox"],
    ["/search", "Search"],
    ["/views", "Views"],
    ["/cycles", "Cycles"],
    ["/cycles/cycle-1", "Cycles"],
    ["/issues", "Issues"],
    ["/issues/issue-1", "Issues"],
    ["/projects", "Projects"],
    ["/projects/project-1", "Projects"],
    ["/settings", "Settings"],
  ])("[同値分割] %s → 上部バーの h1「%s」が1つだけ", async (url, title) => {
    await open(url);
    expect(h1s().map((h) => h.textContent)).toEqual([title]);
    expect(h1s()[0].closest("header.topbar")).not.toBeNull();
  });

  it.each(["/", "/inbox", "/search", "/views", "/cycles", "/issues", "/projects", "/settings"])(
    "[代表値] %s にパンくず・見出しラベル・説明文の重複が出ない",
    async (url) => {
      await open(url);
      expect(doc().querySelector(".breadcrumbs")).toBeNull();
      expect(doc().querySelector(".page-heading")).toBeNull();
      expect(doc().querySelector(".subheading")).toBeNull();
    },
  );

  it("[代表値] Project詳細のProject名は h2 として本文に残る", async () => {
    await open("/projects/project-1");
    expect(doc().querySelector(".project-detail-heading h2")?.textContent).toBe("Project 1");
  });

  it.each([
    ["/projects/missing", "Projects", "Projectが見つかりません"],
    ["/cycles/missing", "Cycles", "Cycleが見つかりません"],
  ])("[同値分割] 存在しない %s → 上部バー「%s」、本文 h2「%s」", async (url, title, message) => {
    await open(url);
    expect(h1s().map((h) => h.textContent)).toEqual([title]);
    expect([...doc().querySelectorAll("main h2")].map((h) => h.textContent)).toContain(message);
  });

  it("[代表値] Issuesの作成ボタンはツールバー行に移る", async () => {
    await open("/issues");
    const create = doc().querySelector(".toolbar .button.primary");
    expect(create?.textContent).toContain("新しいIssue");
  });

  it("[代表値] Homeの日付と操作ボタンは残る", async () => {
    await open("/");
    expect(doc().querySelector(".home-date")).not.toBeNull();
    expect(doc().querySelector(".page-actions")?.textContent).toContain("Issueを作成");
  });
});
