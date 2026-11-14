import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleProgressViewModel, CycleViewModel } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

// CYC-16 AC-5: Bootstrapの cycleProgress がCycle詳細のバーンダウンへ配線される。

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
let payload = {
  ...reviewBootstrap([issue]),
  cycles: [cycle],
  cycleProgress: [] as CycleProgressViewModel[],
};
let detail = reviewDetail(issue);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  payload = { ...reviewBootstrap([issue]), cycles: [cycle], cycleProgress: [] };
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
  await vi.waitFor(() => expect(doc().querySelector(".cycle-burndown-section")).not.toBeNull());
}

const progressFor = (cycleId: string): CycleProgressViewModel => ({
  cycleId,
  trackedFrom: "2026-10-01",
  days: [
    {
      date: "2026-10-01",
      tracked: true,
      scope: 1,
      completed: 0,
      canceled: 0,
      remaining: 1,
      added: 0,
      removed: 0,
    },
  ],
});

describe("Cycle詳細のバーンダウン配線", () => {
  it("[代表値] 選択中Cycleの進捗を描画する", async () => {
    payload.cycleProgress = [
      {
        cycleId: "cycle-1",
        trackedFrom: "2026-10-01",
        days: [
          {
            date: "2026-10-01",
            tracked: true,
            scope: 3,
            completed: 1,
            canceled: 0,
            remaining: 2,
            added: 0,
            removed: 0,
          },
        ],
      },
    ];
    await open("/cycles/cycle-1");
    const svg = doc().querySelector(".cycle-burndown-section svg");
    expect(svg?.getAttribute("aria-label")).toBe("Cycle 1のバーンダウン。残り2件、記録開始時3件");
  });

  it("[代表値] 別Cycleの進捗しかなければ空状態", async () => {
    payload.cycleProgress = [{ ...progressFor("cycle-other") }];
    await open("/cycles/cycle-1");
    expect(doc().querySelector(".cycle-burndown-section")?.textContent).toContain(
      "このCycleの日別記録はまだありません",
    );
  });
});
