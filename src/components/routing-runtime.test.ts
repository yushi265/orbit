import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleViewModel } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

// REFACTOR-ui-architecture AC-1: 既存 12 URL と各 validateSearch の正規化が、ルート構造の変更後も同じ結果になる。
// 見出しの期待値は Phase 3a 着手時に現行アプリで描画した値（特性テスト）。

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
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
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
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { value: vi.fn() });
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
const h1 = () => doc().querySelector("h1")?.textContent;
const value = (selector: string) =>
  (doc().querySelector(selector) as HTMLInputElement | HTMLSelectElement | null)?.value;
const completedChecked = () =>
  (doc().querySelector(".completed-toggle input") as HTMLInputElement).checked;

describe("AC-1 既存 URL のページ描画", () => {
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
    ["/projects/project-1", "Project 1"],
    ["/settings", "Settings"],
    ["/settings/labels", "Settings"],
  ])("[同値分割] %s → 見出し「%s」", async (url, heading) => {
    await open(url);
    expect(h1()).toBe(heading);
    expect(app!.router.state.location.pathname).toBe(url);
  });

  it.each([
    ["/projects/missing", "Projectが見つかりません"],
    ["/cycles/missing", "Cycleが見つかりません"],
    ["/settings/unknown", "Settings"],
  ])("[同値分割] 存在しない %s → 見出し「%s」", async (url, heading) => {
    await open(url);
    expect(h1()).toBe(heading);
  });

  it("[同値分割] 存在しない /issues/<id> → 一覧の上の詳細に「Issueが見つかりません」", async () => {
    await open("/issues/missing");
    // queryClient の既定 retry: 1 で 404 を 1 回再試行してから表示する
    await vi.waitFor(() => expect(doc().body.textContent).toContain("Issueが見つかりません"), {
      timeout: 3000,
    });
    expect(h1()).toBe("Issues");
  });

  it("[代表値] /issues/<存在するID> を直接開く → 一覧の上に詳細が開く", async () => {
    await open("/issues/issue-1");
    await vi.waitFor(() => expect(doc().querySelector("#issue-detail-title")).not.toBeNull());
    expect((doc().querySelector("#issue-detail-title") as HTMLTextAreaElement).value).toBe(
      "needle",
    );
    expect(doc().querySelector('button[data-issue-id="issue-1"]')).not.toBeNull();
  });
});

describe("AC-1 search params の正規化", () => {
  it("[代表値] /issues?status=all&order=updated_desc&completed=false → status・order は既定の表示のまま、completed=false の一覧（root の生 search が子へ届く既存挙動を含む特性テスト）", async () => {
    await open("/issues?status=all&order=updated_desc&completed=false");
    expect(value("#issues-status-filter")).toBe("all");
    expect(value("#issues-sort-select")).toBe("updated_desc");
    expect(completedChecked()).toBe(false);
  });

  it("[代表値] 子ルートが親の正規化を継承: /issues/<id>?status=all&completed=false → 詳細が開き、背後の一覧は completed=false", async () => {
    await open("/issues/issue-1?status=all&completed=false&order=title_asc");
    await vi.waitFor(() => expect(doc().querySelector("#issue-detail-title")).not.toBeNull());
    expect(value("#issues-status-filter")).toBe("all");
    expect(value("#issues-sort-select")).toBe("title_asc");
    expect(completedChecked()).toBe(false);
  });

  it.each([
    ["/projects?active=true", { active: true }],
    ["/views?view=v1", { view: "v1" }],
  ])("[代表値] %s → 正規化後の search を保持する", async (url, expected) => {
    await open(url);
    expect(app!.router.state.matches.at(-1)!.search).toMatchObject(expected);
  });
});

describe("AC-5 型付きにした遷移の遷移先", () => {
  const notification = (entityType: string, entityId: string) => ({
    id: `n-${entityType}`,
    userId: "owner",
    type: "cycle_started",
    title: `${entityType} notification`,
    body: "",
    entityType,
    entityId,
    readAt: 1,
    deletedAt: null,
    createdAt: 1,
  });

  it.each([
    ["project", "project-1", "/projects/project-1"],
    ["cycle", "cycle-1", "/cycles/cycle-1"],
  ])("[同値分割] Inbox の %s 通知を開く → %s の詳細 URL へ遷移する", async (type, id, pathname) => {
    payload.notifications = [notification(type, id)];
    await open("/inbox");
    await act(async () => (doc().querySelector(".notification-main") as HTMLButtonElement).click());
    await vi.waitFor(() => expect(app!.router.state.location.pathname).toBe(pathname));
  });

  it.each([
    ["/", "a.home-project-item"],
    ["/projects", "a.project-card"],
  ])("[代表値] %s の Project リンク（%s）は /projects/<id> を指す", async (url, selector) => {
    await open(url);
    expect(doc().querySelector(selector)?.getAttribute("href")).toBe("/projects/project-1");
  });

  it("[代表値] Issues・Search 以外で Ctrl+F → /search へ遷移する", async () => {
    await open("/");
    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
      );
    });
    await vi.waitFor(() => expect(app!.router.state.location.pathname).toBe("/search"));
  });

  it.each([
    ["Label設定を開く", "/settings"],
    ["子Issue", "/issues/child-1"],
    ["Relation の相手", "/issues/related-1"],
  ])("[同値分割] 詳細の「%s」→ %s へ遷移する", async (target, pathname) => {
    payload.labels = [];
    detail = {
      ...reviewDetail(issue),
      children: [{ id: "child-1", identifier: "TASK-child-1", title: "child", statusId: "todo" }],
      relations: [
        {
          id: "relation-1",
          userId: "owner",
          sourceIssueId: "issue-1",
          targetIssueId: "related-1",
          type: "related",
          createdAt: 1,
          target: {
            id: "related-1",
            identifier: "TASK-related-1",
            title: "related",
            statusId: "todo",
          },
        },
      ],
    };
    await open("/issues/issue-1");
    await vi.waitFor(() => expect(doc().querySelector(".child-issue-link")).not.toBeNull());
    const button = {
      Label設定を開く: () => doc().querySelector('[aria-label="Label設定を開く"]'),
      子Issue: () => doc().querySelector(".child-issue-link"),
      "Relation の相手": () => doc().querySelector(".relation-target"),
    }[target]!() as HTMLButtonElement;
    await act(async () => button.click());
    await vi.waitFor(() => expect(app!.router.state.location.pathname).toBe(pathname));
  });
});
