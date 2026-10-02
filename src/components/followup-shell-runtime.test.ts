import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import type { BootstrapViewModel, PublicRunViewModel } from "../shared/view-models";
import { reviewBootstrap } from "./review-ui.test-fixtures";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));
let dom: JSDOM;
let root: Root;
let data: BootstrapViewModel;
let requests: Array<{ path: string; method: string }>;
let unexpected: string[];
let bootstrapFails = false;
function run(status: PublicRunViewModel["status"]): PublicRunViewModel {
  return {
    run_id: "shell-run",
    kind: "maintenance",
    status,
    progress: {
      current_step: status === "succeeded" ? null : "purge",
      step_index: 1,
      step_count: 3,
      cursor: null,
      processed: 25,
      total: 25,
      percent: status === "succeeded" ? 100 : 50,
    },
    error: null,
    requested_at: 1,
    started_at: 1,
    heartbeat_at: 1,
    finished_at: status === "succeeded" ? 2 : null,
    resume_count: 0,
  };
}
function response(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 2, 3));
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
  queryClient.clear();
  data = reviewBootstrap();
  requests = [];
  unexpected = [];
  bootstrapFails = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      requests.push({ path, method });
      if (path === "/api/v1/bootstrap" && method === "GET") {
        if (bootstrapFails)
          return new Response(
            JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Bootstrap更新失敗" } }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        return response(data);
      }
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return response({ run: data.background.run });
      if (path === "/api/v1/issues?scope=trash" && method === "GET") return response({ items: [] });
      if (path === "/api/v1/background-runs/shell-run/continue" && method === "POST") {
        const completed = run("succeeded");
        data = { ...data, background: { run: null, lastRun: completed } };
        return response({ run: completed, next: "none" });
      }
      unexpected.push(`${method} ${path}`);
      throw new Error("Unexpected request");
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});
async function render(
  section: "home" | "settings" | "issues" = "settings",
  strict = false,
  seed = true,
) {
  if (seed) queryClient.setQueryData(["bootstrap"], data);
  await act(async () =>
    root.render(
      strict
        ? createElement(StrictMode, null, createElement(OrbitApp, { initialSection: section }))
        : createElement(OrbitApp, { initialSection: section }),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
describe("followup shell state", () => {
  it("[最新Run/再読込] completed current=nullでも成功結果をSettingsに残す", async () => {
    data.background.lastRun = run("succeeded");
    await render();
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain("完了");
    expect(dom.window.document.querySelector(".run-progress-ring")?.textContent).toBe("100%");
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
    await act(async () => {
      root.unmount();
      queryClient.clear();
      root = createRoot(dom.window.document.getElementById("root")!);
    });
    await render("settings", false, false);
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain("完了");
    expect(dom.window.document.querySelector(".run-progress-ring")?.textContent).toBe("100%");
  });
  it("[terminal/current null/Bootstrap500] 30秒再取得でも最新UI完了を忘れない", async () => {
    data.background = {
      run: run("running"),
      lastRun: { ...run("rejected"), run_id: "old-run", requested_at: 0 },
    };
    bootstrapFails = true;
    await render("settings");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain("完了");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(requests.filter(({ path }) => path === "/api/v1/bootstrap").length).toBeGreaterThan(0);
    expect(
      requests.filter(({ path }) => path === "/api/v1/background-runs/current").length,
    ).toBeGreaterThan(1);
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain("完了");
    expect(dom.window.document.querySelector(".run-progress-ring")?.textContent).toBe("100%");
    expect(requests.filter(({ method }) => method !== "GET")).toHaveLength(1);
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "最新情報を取得できませんでした",
    );
    bootstrapFails = false;
    const retry = dom.window.document.querySelector('[role="alert"] button') as HTMLButtonElement;
    await act(async () => retry.click());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull();
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain("完了");
  });
  it("[初回Bootstrap500] Cacheがなければ従来ErrorScreenとRetryを維持する", async () => {
    bootstrapFails = true;
    await render("settings", false, false);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(dom.window.document.body.textContent).toContain("接続できません");
    expect(dom.window.document.querySelector(".run-status-box")).toBeNull();
    bootstrapFails = false;
    await act(async () =>
      (dom.window.document.querySelector(".error-screen button") as HTMLButtonElement).click(),
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(dom.window.document.querySelector(".run-status-box")).not.toBeNull();
    expect(dom.window.document.querySelector(".error-screen")).toBeNull();
  });
  it("[active優先] 最新結果より復旧対象Runを優先する", async () => {
    data.background = { run: run("paused"), lastRun: run("succeeded") };
    await render();
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain(
      "一時停止中",
    );
  });
  it("[最新拒否] rejectedを完了扱いしない", async () => {
    data.background.lastRun = run("rejected");
    await render();
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain(
      "開始できませんでした",
    );
  });
  it.each([3, 1])(
    "[最新terminal同期] controller成功後にBootstrapへ新terminal(requested_at=%i)が来たらserver truthを表示する",
    async (requestedAt) => {
      data.background.run = run("running");
      await render("settings");
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain("完了");
      data = {
        ...data,
        background: {
          run: null,
          lastRun: { ...run("rejected"), run_id: "other-run", requested_at: requestedAt },
        },
      };
      await act(async () => queryClient.setQueryData(["bootstrap"], data));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain(
        "開始できませんでした",
      );
    },
  );
  it("[controller新terminal] 古いBootstrapが届いても新しいUI成功を巻き戻さない", async () => {
    data.background.run = run("running");
    await render("settings");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    data = {
      ...data,
      background: {
        run: null,
        lastRun: { ...run("rejected"), run_id: "old-run", requested_at: 0 },
      },
    };
    await act(async () => queryClient.setQueryData(["bootstrap"], data));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(dom.window.document.querySelector(".run-status-box")?.textContent).toContain("完了");
    expect(dom.window.document.querySelector(".run-progress-ring")?.textContent).toBe("100%");
  });
  it("[Home/brand] 挨拶をHomeと日付へ置き換えMVP spanを除去する", async () => {
    await render("home");
    expect(dom.window.document.querySelector(".home-heading h1")?.textContent).toBe("Home");
    expect(dom.window.document.querySelector(".home-date")?.textContent).toContain("10月2日");
    expect(dom.window.document.querySelector(".brand-version")).toBeNull();
    expect(dom.window.document.body.textContent).not.toContain("おかえりなさい");
  });
  it("[StrictMode冷Cache計測] Bootstrap共有Queryを1回取得し業務Mutationを送らない", async () => {
    await render("issues", true, false);
    expect(requests.filter(({ path }) => path === "/api/v1/bootstrap")).toHaveLength(1);
    expect(requests.filter(({ path }) => path === "/api/v1/background-runs/current")).toHaveLength(
      1,
    );
    expect(requests.filter(({ method }) => method !== "GET")).toHaveLength(0);
  });
  it("[StrictMode既存Run計測] currentの再mount読取2回でもContinueを重複実行しない", async () => {
    data.background.run = run("running");
    await render("issues", true);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(requests.filter(({ path }) => path === "/api/v1/background-runs/current")).toHaveLength(
      2,
    );
    expect(
      requests.filter(({ path, method }) => path.endsWith("/continue") && method === "POST"),
    ).toHaveLength(1);
    expect(requests.filter(({ method }) => method !== "GET")).toHaveLength(1);
    expect(requests.filter(({ path }) => path === "/api/v1/bootstrap")).toHaveLength(1);
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
  });
});
