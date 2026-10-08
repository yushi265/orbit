import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRunViewModel } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

// REFACTOR-ui-architecture Phase 3b-1a: OrbitAppInner から shell の hook へ切り出した部分の結線を、アプリ描画で固定する。
// AC-2 のショートカット × 抑止条件のデシジョンテーブルを先行して置く。抑止中はどのショートカットも効かないので、
// 観測には条件と別の画面を開くショートカット（c / ?）を使う。

let dom: JSDOM;
let app: RenderedApp | undefined;
let run: PublicRunViewModel | null;
const issue = reviewIssue("issue-1");

function runWith(status: PublicRunViewModel["status"]): PublicRunViewModel {
  return {
    run_id: "run-1",
    kind: "maintenance",
    status,
    progress: {
      current_step: "cycle_transition",
      step_index: 0,
      step_count: 3,
      cursor: null,
      processed: 0,
      total: null,
      percent: 0,
    },
    error: null,
    requested_at: 1,
    started_at: 1,
    heartbeat_at: 1,
    finished_at: null,
    resume_count: 0,
  };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  run = null;
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  for (const name of ["attachEvent", "detachEvent"] as const)
    Object.defineProperty(dom.window.HTMLElement.prototype, name, {
      value: function (this: HTMLElement, event: string, handler: EventListener) {
        const type = event.replace(/^on/, "");
        if (name === "attachEvent") this.addEventListener(type, handler);
        else this.removeEventListener(type, handler);
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/v1/bootstrap")
        return json({ ...reviewBootstrap([issue]), background: { run } });
      if (path.startsWith("/api/v1/background-runs")) return json({ run });
      if (path === "/api/v1/issues/issue-1") return json(reviewDetail(issue));
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
}
async function press(init: KeyboardEventInit) {
  await act(async () => {
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}
const composerOpen = () => doc().querySelector(".composer") !== null;
const shortcutListOpen = () => doc().querySelector(".shortcut-list") !== null;

describe("ショートカット × 抑止条件（デシジョンテーブル）", () => {
  it("[デシジョンテーブル] 抑止条件なし → c で Composer、? でショートカット一覧が開く", async () => {
    await open("/");
    await press({ key: "c" });
    expect(composerOpen()).toBe(true);
    await app!.unmount();
    await open("/");
    await press({ key: "?" });
    expect(shortcutListOpen()).toBe(true);
  });

  it("[デシジョンテーブル] IME 変換中 → c を無視", async () => {
    await open("/");
    await press({ key: "c", isComposing: true });
    expect(composerOpen()).toBe(false);
  });

  it.each(["pending", "running"] as const)(
    "[デシジョンテーブル] Background Run が %s → c を無視",
    async (status) => {
      run = runWith(status);
      await open("/");
      await press({ key: "c" });
      expect(composerOpen()).toBe(false);
    },
  );

  it("[デシジョンテーブル] Composer 表示中 → ? を無視", async () => {
    await open("/");
    await press({ key: "c" });
    expect(composerOpen()).toBe(true);
    await press({ key: "?" });
    expect(shortcutListOpen()).toBe(false);
  });

  it("[デシジョンテーブル] CommandPalette 表示中 → c を無視", async () => {
    await open("/");
    await press({ key: "k", ctrlKey: true });
    expect(doc().querySelector(".command-palette")).not.toBeNull();
    await press({ key: "c" });
    expect(composerOpen()).toBe(false);
  });

  it("[デシジョンテーブル] Project 作成モーダルなしの /projects → c で Composer が開く（対照）", async () => {
    await open("/projects");
    await press({ key: "c" });
    expect(composerOpen()).toBe(true);
  });

  it("[デシジョンテーブル] Project 作成モーダル表示中 → c を無視", async () => {
    await open("/projects");
    await act(async () =>
      (
        [...doc().querySelectorAll("button")].find((button) =>
          button.textContent?.includes("新しいProject"),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(doc().body.textContent).toContain("新しいProject");
    expect(doc().querySelector('[role="dialog"]')).not.toBeNull();
    await press({ key: "c" });
    expect(composerOpen()).toBe(false);
  });

  it("[デシジョンテーブル] ショートカット一覧表示中 → c を無視", async () => {
    await open("/");
    await press({ key: "?" });
    expect(shortcutListOpen()).toBe(true);
    await press({ key: "c" });
    expect(composerOpen()).toBe(false);
  });

  it("[デシジョンテーブル] 一覧から詳細を開いた後 → ? と c を無視", async () => {
    await open("/issues");
    await act(async () =>
      (doc().querySelector('button[data-issue-id="issue-1"]') as HTMLButtonElement).click(),
    );
    await vi.waitFor(() => expect(doc().querySelector("#issue-detail-title")).not.toBeNull());
    expect(app!.router.state.location.pathname).toBe("/issues/issue-1");
    await press({ key: "?" });
    await press({ key: "c" });
    expect(shortcutListOpen()).toBe(false);
    expect(composerOpen()).toBe(false);
  });

  it("[デシジョンテーブル] Issue 詳細表示中 → ? を無視", async () => {
    await open("/issues/issue-1");
    await vi.waitFor(() => expect(doc().querySelector("#issue-detail-title")).not.toBeNull());
    await press({ key: "?" });
    expect(shortcutListOpen()).toBe(false);
  });
});

describe("shell の hook の結線", () => {
  it("[状態遷移] PWA: beforeinstallprompt → Settings の Install Orbit → accepted でインストール完了の Toast", async () => {
    await open("/settings");
    const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt: () => Promise.resolve({ outcome: "accepted" }) });
    await act(async () => dom.window.dispatchEvent(event));
    const install = [...doc().querySelectorAll("button")].find(
      (button) => button.textContent === "Install Orbit",
    ) as HTMLButtonElement;
    await act(async () => install.click());
    await vi.waitFor(() =>
      expect(doc().querySelector(".toast")?.textContent).toContain("Orbitをインストールしました"),
    );
    expect(
      [...doc().querySelectorAll("button")].some(
        (button) => button.textContent === "Install Orbit",
      ),
    ).toBe(false);
  });

  it("[同値分割] Issues の completed: URL の completed=false を localStorage の既定値として保存する", async () => {
    dom.window.localStorage.setItem("orbit.issues.showCompleted", "true");
    await open("/issues?completed=false");
    await vi.waitFor(() =>
      expect(dom.window.localStorage.getItem("orbit.issues.showCompleted")).toBe("false"),
    );
  });
});
