import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapViewModel, IssueViewModel } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

// FEAT-inbox-triage: InboxはProjectなしの未完了Issueを振り分ける置き場（通知は表示しない）。

let dom: JSDOM;
let app: RenderedApp | undefined;
let payload: BootstrapViewModel;
let patchResponse: () => Response;
const fetchCalls: { path: string; init?: RequestInit }[] = [];

const untriagedOld = reviewIssue("inbox-old", {
  identifier: "TASK-1",
  title: "古い振り分け待ち",
  projectId: null,
  createdAt: 10,
});
const untriagedNew = reviewIssue("inbox-new", {
  identifier: "TASK-2",
  title: "新しい振り分け待ち",
  projectId: null,
  createdAt: 20,
});
const assigned = reviewIssue("assigned", { identifier: "TASK-3", title: "Project済み" });
const doneWithoutProject = reviewIssue("done", {
  identifier: "TASK-4",
  title: "完了済み",
  projectId: null,
  statusId: "done",
});

function bootstrap(issues: IssueViewModel[]): BootstrapViewModel {
  const base = reviewBootstrap(issues);
  return {
    ...base,
    workflowStates: [
      ...base.workflowStates,
      {
        id: "done",
        userId: "owner",
        name: "Done",
        category: "completed",
        color: "#888888",
        position: 1,
        isDefault: false,
      },
    ],
    notifications: [
      {
        id: "notification-1",
        userId: "owner",
        type: "due_soon",
        title: "通知タイトル",
        body: "通知本文",
        entityType: "issue",
        entityId: "inbox-old",
        readAt: null,
        deletedAt: null,
        createdAt: 1,
      },
    ],
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchCalls.length = 0;
  payload = bootstrap([untriagedOld, untriagedNew, assigned, doneWithoutProject]);
  patchResponse = () => json({ issue: { ...untriagedNew, projectId: "project-1", version: 2 } });
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
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
    vi.fn(async (path: string, init?: RequestInit) => {
      fetchCalls.push({ path, init });
      if (path === "/api/v1/bootstrap") return json(payload);
      if (path.startsWith("/api/v1/background-runs")) return json({ run: null });
      if (path === "/api/v1/issues/inbox-new" && init?.method === "PATCH") return patchResponse();
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
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function open(url: string) {
  app = await renderApp({ url, container: doc().getElementById("root")! });
  await vi.waitFor(() => expect(doc().querySelector("h1")).not.toBeNull());
  await settle();
}
const inboxTitles = () =>
  [...doc().querySelectorAll(".inbox-triage-list .issue-main strong")].map((el) => el.textContent);
const inboxNavBadges = () =>
  [...doc().querySelectorAll("button.nav-item")]
    .filter((button) => button.textContent?.includes("Inbox"))
    .map((button) => button.querySelector(".nav-badge")?.textContent ?? null);

describe("Inbox: 振り分け待ちIssueの置き場", () => {
  it("[代表値] Projectなしの未完了Issueだけを新しい順に表示し、件数を示し、説明ボックスは出さない（AC-1・AC-6）", async () => {
    await open("/inbox");
    expect(inboxTitles()).toEqual(["新しい振り分け待ち", "古い振り分け待ち"]);
    expect(doc().querySelector(".inbox-triage-count")?.textContent).toContain("2件");
    expect(doc().querySelector(".inbox-guide")).toBeNull();
  });

  it("[回帰] 通知の一覧・既読操作・上部バーの通知ボタンを表示しない（AC-6）", async () => {
    await open("/inbox");
    expect(doc().body.textContent).not.toContain("通知タイトル");
    expect(doc().body.textContent).not.toContain("すべて既読");
    expect(doc().querySelector(".notification-row")).toBeNull();
    expect(doc().querySelector('header.topbar [aria-label^="通知"]')).toBeNull();
  });

  it("[状態遷移] Projectを選ぶと保存され、その行がInboxから消える（AC-2）", async () => {
    await open("/inbox");
    payload = bootstrap([
      untriagedOld,
      { ...untriagedNew, projectId: "project-1", version: 2 },
      assigned,
      doneWithoutProject,
    ]);
    const select = doc().querySelector('select[aria-label="TASK-2のProject"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "project-1";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await settle();
    const patch = fetchCalls.find((call) => call.init?.method === "PATCH");
    expect(patch?.path).toBe("/api/v1/issues/inbox-new");
    expect(JSON.parse(String(patch?.init?.body)).patch).toEqual({ projectId: "project-1" });
    await vi.waitFor(() => expect(inboxTitles()).toEqual(["古い振り分け待ち"]));
  });

  it("[異常系] Projectの保存に失敗するとエラーを出し、行はInboxに残る（AC-2）", async () => {
    patchResponse = () =>
      json({ error: { code: "INTERNAL_ERROR", message: "保存できませんでした。" } }, 500);
    await open("/inbox");
    const select = doc().querySelector('select[aria-label="TASK-2のProject"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "project-1";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await settle();
    await vi.waitFor(() => expect(doc().body.textContent).toContain("保存できませんでした。"));
    expect(inboxTitles()).toEqual(["新しい振り分け待ち", "古い振り分け待ち"]);
  });

  it("[代表値] 行を開くとIssue詳細へ移動する（AC-3）", async () => {
    await open("/inbox");
    const row = doc().querySelector(".inbox-triage-list .issue-main") as HTMLButtonElement;
    await act(async () => row.click());
    await settle();
    expect(app!.router.state.location.pathname).toBe("/issues/inbox-new");
  });

  it("[境界値] 振り分け待ち2件でサイドバー・下部タブのバッジは2（AC-4）", async () => {
    await open("/");
    expect(inboxNavBadges()).toEqual(["2", "2"]);
  });

  it("[境界値] 振り分け待ち0件ならバッジを出さず、空状態と作成導線を出す（AC-4・AC-5）", async () => {
    payload = bootstrap([assigned, doneWithoutProject]);
    await open("/inbox");
    expect(inboxNavBadges()).toEqual([null, null]);
    expect(doc().body.textContent).toContain("振り分け待ちのIssueはありません");
    const create = (
      [...doc().querySelectorAll(".inbox-triage button")] as HTMLButtonElement[]
    ).find((button) => button.textContent?.startsWith("Issueを作成"));
    expect(create).toBeDefined();
    await act(async () => create!.click());
    await settle();
    expect(doc().querySelector('[role="dialog"]')).not.toBeNull();
  });
});
