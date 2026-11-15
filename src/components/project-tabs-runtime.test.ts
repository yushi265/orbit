import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapViewModel, ProjectViewModel } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";
import { LAST_ISSUES_PROJECT_STORAGE_KEY } from "./project-tabs";

// Issues画面をProjectタブ起点にする: タブで出し分け、ヘッダーからProject詳細へ。
// Project詳細のIssue一覧は「Issuesで開く」リンクに置き換える。

let dom: JSDOM;
let app: RenderedApp | undefined;
let payload: BootstrapViewModel;

function bootstrap(): BootstrapViewModel {
  const base = reviewBootstrap([
    reviewIssue("a1", { identifier: "TASK-1", title: "Project1の課題", projectId: "project-1" }),
    reviewIssue("a2", {
      identifier: "TASK-4",
      title: "Project1の完了済み",
      projectId: "project-1",
      statusId: "done",
    }),
    reviewIssue("c1", { identifier: "TASK-2", title: "Project3の課題", projectId: "project-3" }),
    reviewIssue("n1", { identifier: "TASK-3", title: "Projectなしの課題", projectId: null }),
  ]);
  const template = base.projects[0];
  const extra = (
    id: string,
    name: string,
    statusId: string,
    position: number,
  ): ProjectViewModel => ({
    ...template,
    id,
    name,
    statusId,
    position,
  });
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
    projectStatuses: [
      ...base.projectStatuses,
      {
        id: "project-done",
        userId: "owner",
        name: "Completed",
        category: "completed",
        color: "#888888",
        position: 1,
        isDefault: false,
      },
    ],
    projects: [
      { ...template, targetAt: Date.UTC(2026, 11, 20) },
      extra("project-2", "Project 2", "project-done", 1),
      extra("project-3", "Project 3", "project-status", 2),
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
  payload = bootstrap();
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
    vi.fn(async (path: string) => {
      if (path === "/api/v1/bootstrap") return json(payload);
      if (path.startsWith("/api/v1/background-runs")) return json({ run: null });
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
const tabs = () => [...doc().querySelectorAll('[role="tablist"] [role="tab"]')] as HTMLElement[];
const tabLabels = () => tabs().map((tab) => tab.querySelector(".project-tab-name")?.textContent);
const selectedTab = () =>
  tabs()
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.querySelector(".project-tab-name")?.textContent;
const tabNamed = (name: string) =>
  tabs().find((tab) => tab.querySelector(".project-tab-name")?.textContent === name)!;
const rowTitles = () =>
  [...doc().querySelectorAll(".issue-row .issue-main strong")].map((el) => el.textContent);
const location = () => app!.router.state.location;
const navButton = (label: string) =>
  ([...doc().querySelectorAll(".sidebar button.nav-item")] as HTMLButtonElement[]).find((button) =>
    button.textContent?.includes(label),
  )!;

describe("Issues画面のProjectタブ", () => {
  it("[代表値] 完了以外のProjectを並び順で出し、最後に「すべて」を置き、未完了件数を添える", async () => {
    await open("/issues?project=project-1");
    expect(tabLabels()).toEqual(["Project 1", "Project 3", "すべて"]);
    expect(tabNamed("Project 1").querySelector(".project-tab-count")?.textContent).toBe("1");
    expect(selectedTab()).toBe("Project 1");
    expect(rowTitles().sort()).toEqual(["Project1の完了済み", "Project1の課題"]);
  });

  it("[代表値] ツールバーにProjectのプルダウンを出さない", async () => {
    await open("/issues?project=project-1");
    expect(doc().querySelector("#issues-project-filter")).toBeNull();
  });

  it("[代表値] Projectヘッダーに名前と「Projectの詳細」リンクを出す", async () => {
    await open("/issues?project=project-1");
    const header = doc().querySelector(".project-tab-header")!;
    expect(header.textContent).toContain("Project 1");
    expect(header.textContent).toContain("In progress");
    expect(header.textContent).toContain("期限 12月20日");
    expect(header.textContent).toContain("50%（1/2）");
    const link = header.querySelector("a.project-tab-detail-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/projects/project-1");
    await act(async () => link.click());
    await settle();
    expect(location().pathname).toBe("/projects/project-1");
  });

  it("[代表値] /issues（project指定なし）は「すべて」で、Projectヘッダーを出さない", async () => {
    await open("/issues");
    expect(selectedTab()).toBe("すべて");
    expect(doc().querySelector(".project-tab-header")).toBeNull();
    expect(rowTitles()).toHaveLength(4);
  });

  it("[状態遷移] タブを押すとURLのprojectが変わり、そのタブを覚える", async () => {
    await open("/issues?project=project-1");
    await act(async () => tabNamed("Project 3").click());
    await settle();
    expect((location().search as { project?: string }).project).toBe("project-3");
    expect(selectedTab()).toBe("Project 3");
    expect(rowTitles()).toEqual(["Project3の課題"]);
    expect(dom.window.localStorage.getItem(LAST_ISSUES_PROJECT_STORAGE_KEY)).toBe("project-3");
    await act(async () => tabNamed("すべて").click());
    await settle();
    expect((location().search as { project?: string }).project).toBeUndefined();
    expect(dom.window.localStorage.getItem(LAST_ISSUES_PROJECT_STORAGE_KEY)).toBe("all");
  });

  it("[状態遷移] 完了済みProjectをURLで開くと、そのタブを一時的に出す", async () => {
    await open("/issues?project=project-2");
    expect(tabLabels()).toEqual(["Project 1", "Project 2", "Project 3", "すべて"]);
    expect(selectedTab()).toBe("Project 2");
  });

  it.each([
    ["覚えていない", null, "project-1"],
    ["Project 3を覚えている", "project-3", "project-3"],
    ["すべてを覚えている", "all", undefined],
  ] as const)(
    "[デシジョンテーブル] サイドバーのIssues: %s → project=%s",
    async (_l, stored, expected) => {
      if (stored) dom.window.localStorage.setItem(LAST_ISSUES_PROJECT_STORAGE_KEY, stored);
      await open("/");
      await act(async () => navButton("Issues").click());
      await settle();
      expect(location().pathname).toBe("/issues");
      expect((location().search as { project?: string }).project).toBe(expected);
    },
  );

  it("[回帰] フィルターを解除しても選んでいるタブのProjectは残る", async () => {
    await open("/issues?project=project-1&priority=low");
    const clear = [...doc().querySelectorAll("button")].find((button) =>
      button.textContent?.includes("フィルターを解除"),
    ) as HTMLButtonElement;
    await act(async () => clear.click());
    await settle();
    expect((location().search as { project?: string; priority?: string }).priority).toBeUndefined();
    expect(selectedTab()).toBe("Project 1");
  });

  it("[代表値] C キーのクイック追加も選んでいるタブのProjectが初期値になる", async () => {
    await open("/issues?project=project-3");
    await act(async () => {
      doc().body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "c", bubbles: true }),
      );
    });
    await settle();
    const select = doc().querySelector("#new-issue-project") as HTMLSelectElement;
    expect(select.value).toBe("project-3");
  });

  it("[代表値] 新しいIssueは選んでいるタブのProjectが初期値になる", async () => {
    await open("/issues?project=project-3");
    const create = doc().querySelector(".create-sidebar") as HTMLButtonElement;
    await act(async () => create.click());
    await settle();
    const select = doc().querySelector("#new-issue-project") as HTMLSelectElement;
    expect(select.value).toBe("project-3");
  });
});

describe("Project詳細のIssue一覧をリンクにする", () => {
  it("[代表値] Issue一覧を出さず、「Issuesで開く」リンクで未完了件数を示す", async () => {
    await open("/projects/project-1");
    expect(doc().body.textContent).not.toContain("PROJECT ISSUES");
    expect(doc().querySelector(".project-issues-workspace")).toBeNull();
    const link = doc().querySelector("a.project-open-issues") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/issues?project=project-1");
    expect(link.textContent).toContain("1件");
    await act(async () => link.click());
    await settle();
    expect(location().pathname).toBe("/issues");
    expect(selectedTab()).toBe("Project 1");
  });
});
