import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRunViewModel } from "../shared/view-models";
import { RunOverlay } from "./OrbitApp";
import { useBackgroundRun } from "./background-run";

const initialRun: PublicRunViewModel = {
  run_id: "run-recovery",
  kind: "maintenance",
  status: "running",
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

function runAt(processed: number, status: PublicRunViewModel["status"] = "running") {
  return {
    ...initialRun,
    status,
    progress: {
      ...initialRun.progress,
      cursor: String(processed),
      processed,
      percent: processed,
    },
  };
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const runPath = `/api/v1/background-runs/${initialRun.run_id}`;
const endpoints = {
  current: { path: "/api/v1/background-runs/current", method: "GET" },
  get: { path: runPath, method: "GET" },
  create: { path: "/api/v1/background-runs", method: "POST" },
  resume: { path: `${runPath}/resume`, method: "POST" },
  continue: { path: `${runPath}/continue`, method: "POST" },
} as const;
type ApiOperation = keyof typeof endpoints;
type ApiHandler = (init: RequestInit) => Response | Promise<Response>;
let unexpectedRequests: string[];

function stubApi(handlers: Partial<Record<ApiOperation, ApiHandler>>) {
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const operation = (Object.keys(endpoints) as ApiOperation[]).find(
      (key) => endpoints[key].path === path && endpoints[key].method === method,
    );
    const handler = operation && handlers[operation];
    if (!handler) {
      unexpectedRequests.push(`${method} ${path}`);
      throw new Error(`Unexpected API request: ${method} ${path}`);
    }
    return handler(init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const success = vi.fn();
const error = vi.fn();
let root: Root;
let dom: JSDOM;

function Runtime({ bootstrap }: { bootstrap: PublicRunViewModel | null }) {
  const { run, busy, start, resume } = useBackgroundRun(bootstrap, {
    onSucceeded: success,
    onError: error,
  });
  return createElement(
    "div",
    { "data-run-status": run?.status ?? "none" },
    createElement("button", { onClick: start }, "Runを開始"),
    run && ["pending", "running", "paused", "failed"].includes(run.status)
      ? createElement(RunOverlay, { run, busy, onResume: resume })
      : createElement("span", null, "操作可能"),
  );
}

async function render(bootstrap: PublicRunViewModel | null = initialRun) {
  await act(async () => root.render(createElement(Runtime, { bootstrap })));
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/settings",
  });
  // 既定は表示中タブ。jsdomは既定でdocument.hiddenがtrueのため、定期再検証の経路を通すには明示が要る。
  Object.defineProperty(dom.window.document, "hidden", { configurable: true, get: () => false });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
  unexpectedRequests = [];
  success.mockClear();
  error.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
});

describe("Background Run browser recovery", () => {
  it("[状態遷移] nullからstartしrunningを経てsucceededになる", async () => {
    let chunks = 0;
    const fetch = stubApi({
      current: () => response({ run: null }),
      create: () => response({ run: initialRun }, 202),
      continue: () => {
        chunks += 1;
        return response({
          run: runAt(chunks === 1 ? 20 : 100, chunks === 1 ? "running" : "succeeded"),
          next: chunks === 1 ? "continue" : "none",
        });
      },
    });
    await render(null);
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
    await act(async () =>
      (dom.window.document.querySelector("button") as HTMLButtonElement).click(),
    );
    expect(dom.window.document.body.textContent).toContain("ワークスペースを整えています");
    expect(success).not.toHaveBeenCalled();
    await advance(100);
    expect(dom.window.document.body.textContent).toContain("20%");
    expect(success).not.toHaveBeenCalled();
    await advance(100);
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
    expect(dom.window.document.body.textContent).toContain("操作可能");
    expect(success).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(fetch.mock.calls.map(([path, init]) => [path, init?.method ?? "GET"])).toEqual([
      [endpoints.current.path, "GET"],
      [endpoints.create.path, "POST"],
      [endpoints.continue.path, "POST"],
      [endpoints.continue.path, "POST"],
    ]);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      kind: "maintenance",
      idempotencyKey: expect.any(String),
    });
    expect(JSON.parse(fetch.mock.calls[2][1]?.body as string).expected_cursor).toBeNull();
    expect(JSON.parse(fetch.mock.calls[3][1]?.body as string).expected_cursor).toBe("20");
  });

  it.each(["failed", "paused"] as const)(
    "[状態遷移] %sからresumeしrunningを経てsucceededになる",
    async (status) => {
      const stopped = runAt(20, status);
      let chunks = 0;
      const fetch = stubApi({
        current: () => response({ run: stopped }),
        resume: () => response({ run: { ...runAt(20), resume_count: 1 } }),
        continue: () => {
          chunks += 1;
          return response({
            run: runAt(chunks === 1 ? 40 : 100, chunks === 1 ? "running" : "succeeded"),
            next: chunks === 1 ? "continue" : "none",
          });
        },
      });
      await render(stopped);
      // failed は role=alert、paused は role=status のバナー（ui.md AC-1）
      expect(
        dom.window.document.querySelector(
          status === "failed" ? '[role="alert"]' : '[role="status"]',
        ),
      ).not.toBeNull();
      const resumeButton = dom.window.document.querySelector(
        ".run-banner button",
      ) as HTMLButtonElement;
      expect(resumeButton.textContent).toBe("同じRunを再開");
      expect(resumeButton.disabled).toBe(false);
      await act(async () => resumeButton.click());
      expect(dom.window.document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(dom.window.document.body.textContent).toContain("ワークスペースを整えています");
      expect(success).not.toHaveBeenCalled();
      await advance(100);
      expect(dom.window.document.body.textContent).toContain("40%");
      expect(success).not.toHaveBeenCalled();
      await advance(100);
      expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
      expect(dom.window.document.body.textContent).toContain("操作可能");
      expect(success).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      expect(fetch.mock.calls.map(([path, init]) => [path, init?.method ?? "GET"])).toEqual([
        [endpoints.current.path, "GET"],
        [endpoints.resume.path, "POST"],
        [endpoints.continue.path, "POST"],
        [endpoints.continue.path, "POST"],
      ]);
      expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
        idempotencyKey: expect.any(String),
      });
      expect(JSON.parse(fetch.mock.calls[2][1]?.body as string).expected_cursor).toBe("20");
      expect(JSON.parse(fetch.mock.calls[3][1]?.body as string).expected_cursor).toBe("40");
    },
  );

  it("[状態遷移] 再読込で復元したrunningを5Chunk以上継続し、成功時だけOverlayを解除する", async () => {
    let chunks = 0;
    const fetch = stubApi({
      current: () => response({ run: initialRun }),
      continue: () => {
        chunks += 1;
        const done = chunks === 7;
        return response({
          run: runAt(chunks, done ? "succeeded" : "running"),
          next: done ? "none" : "continue",
        });
      },
    });
    await render();
    expect(dom.window.document.querySelector('[role="dialog"]')).not.toBeNull();
    await advance(750);
    expect(chunks).toBe(7);
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
    expect(dom.window.document.body.textContent).toContain("操作可能");
    expect(success).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    const requests = fetch.mock.calls.filter(([path]) => path.endsWith("/continue"));
    expect(JSON.parse((requests[6][1] as RequestInit).body as string).expected_cursor).toBe("6");
  });

  it("[障害注入/状態遷移] continue通信失敗後にcurrentを再取得し、pausedをResumeできる", async () => {
    let currentCalls = 0;
    let resumed = false;
    stubApi({
      current: () => {
        currentCalls += 1;
        return response({ run: currentCalls === 1 ? initialRun : runAt(20, "paused") });
      },
      resume: () => {
        resumed = true;
        return response({ run: { ...runAt(20), resume_count: 1 } });
      },
      continue: () => {
        if (!resumed) throw new TypeError("Network interrupted");
        return response({ run: runAt(100, "succeeded"), next: "none" });
      },
    });
    await render();
    await advance(100);
    expect(currentCalls).toBe(2);
    expect(success).not.toHaveBeenCalled();
    expect(dom.window.document.body.textContent).toContain("処理が一時停止しました");
    const button = dom.window.document.querySelector(".run-banner button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await advance(100);
    expect(success).toHaveBeenCalledTimes(1);
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
  });

  it("[障害注入/境界値] 通信中断が続いても30秒current再検証を続け、Lease失効後にResumeを表示する", async () => {
    let currentCalls = 0;
    stubApi({
      current: () => {
        currentCalls += 1;
        if (currentCalls === 1) return response({ run: initialRun });
        if (currentCalls === 2) throw new TypeError("Offline");
        return response({ run: runAt(10, "paused") });
      },
      continue: () => {
        throw new TypeError("Offline");
      },
    });
    await render();
    await advance(100);
    await advance(29_899);
    expect(currentCalls).toBe(2);
    await advance(1);
    expect(currentCalls).toBe(3);
    expect(dom.window.document.querySelector(".run-banner button")?.textContent).toBe(
      "同じRunを再開",
    );
    expect(success).not.toHaveBeenCalled();
  });

  it("[同時実行] stale Bootstrap更新・focus・onlineが重なっても、進捗を戻さず二重continueを作らない", async () => {
    let finishChunk: (value: Response) => void = () => undefined;
    let current = initialRun;
    const fetch = stubApi({
      current: () => response({ run: current }),
      continue: () =>
        new Promise<Response>((resolve) => {
          finishChunk = resolve;
        }),
    });
    await render();
    await advance(100);
    await render(runAt(0));
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("focus"));
      dom.window.dispatchEvent(new dom.window.Event("online"));
    });
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/continue"))).toHaveLength(1);
    current = runAt(40, "paused");
    await act(async () => finishChunk(response({ run: current, next: "resume" })));
    await advance(0);
    await render(initialRun);
    expect(dom.window.document.body.textContent).toContain("40%");
    expect(dom.window.document.body.textContent).toContain("処理が一時停止しました");
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/continue"))).toHaveLength(1);
  });

  it("[端末間/状態遷移] paused Runが別端末で完了しcurrentから消えたら、同じRunの成功を確認する", async () => {
    const fetch = stubApi({
      current: () => response({ run: null }),
      get: () => response({ run: runAt(100, "succeeded") }),
    });
    await render(runAt(20, "paused"));
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/background-runs/${initialRun.run_id}`,
      expect.anything(),
    );
    expect(success).toHaveBeenCalledTimes(1);
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
    await render(initialRun);
    expect(dom.window.document.querySelector(".run-overlay")).toBeNull();
    expect(success).toHaveBeenCalledTimes(1);
  });

  it.each(["succeeded", "rejected"] as const)(
    "[current null/通知/404] 既知%sを保持し新eligibleと404へだけ切り替える",
    async (status) => {
      let current: PublicRunViewModel | null = null;
      let notFound = false;
      stubApi({
        current: () =>
          notFound
            ? response({ error: { code: "NOT_FOUND", message: "見つかりません" } }, 404)
            : response({ run: current }),
      });
      await render(runAt(100, status));
      const state = () =>
        dom.window.document.querySelector("[data-run-status]")?.getAttribute("data-run-status");
      expect(state()).toBe(status);
      await advance(30_000);
      expect(state()).toBe(status);
      expect(success).toHaveBeenCalledTimes(status === "succeeded" ? 1 : 0);
      current = { ...runAt(20, "paused"), run_id: "new-run" };
      await act(async () => dom.window.dispatchEvent(new dom.window.Event("focus")));
      expect(state()).toBe("paused");
      notFound = true;
      await advance(30_000);
      expect(state()).toBe("none");
      expect(success).toHaveBeenCalledTimes(status === "succeeded" ? 1 : 0);
      expect(error).not.toHaveBeenCalled();
    },
  );

  it("[同時実行/境界値] 同値cursorのcontinue応答は5秒待って再試行し、tight loopを作らない", async () => {
    const fetch = stubApi({
      current: () => response({ run: initialRun }),
      continue: () => response({ run: initialRun, next: "continue" }),
    });
    await render();
    await advance(100);
    await advance(4_999);
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/continue"))).toHaveLength(1);
    await advance(1);
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/continue"))).toHaveLength(2);
    expect(success).not.toHaveBeenCalled();
  });

  it("[ライフサイクル] unmount後に到着したcontinue応答は、通知も次Chunkも発生させない", async () => {
    let finishChunk: (value: Response) => void = () => undefined;
    const fetch = stubApi({
      current: () => response({ run: initialRun }),
      continue: () =>
        new Promise<Response>((resolve) => {
          finishChunk = resolve;
        }),
    });
    await render();
    await advance(100);
    await act(async () => root.unmount());
    await act(async () => finishChunk(response({ run: runAt(100, "succeeded"), next: "none" })));
    await advance(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("[同時実行] 開始操作の連打はRun作成を1回だけ送信する", async () => {
    let finishStart: (value: Response) => void = () => undefined;
    const fetch = stubApi({
      current: () => response({ run: null }),
      create: () =>
        new Promise<Response>((resolve) => {
          finishStart = resolve;
        }),
    });
    await render(null);
    const button = dom.window.document.querySelector("button")!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(fetch.mock.calls.filter(([path]) => path === "/api/v1/background-runs")).toHaveLength(1);
    await act(async () => finishStart(response({ run: runAt(10, "failed") })));
    expect(dom.window.document.body.textContent).toContain("処理が失敗しました");
    expect(success).not.toHaveBeenCalled();
  });

  describe("非表示タブの定期再検証", () => {
    function setHidden(hidden: boolean) {
      Object.defineProperty(dom.window.document, "hidden", {
        configurable: true,
        get: () => hidden,
      });
    }
    const visibilityChange = () =>
      act(
        async () =>
          void dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")),
      );
    const currentCalls = (fetch: ReturnType<typeof stubApi>) =>
      fetch.mock.calls.filter(([path]) => path === endpoints.current.path).length;
    const settledApi = (run: PublicRunViewModel | null) =>
      stubApi({
        current: () =>
          response({
            run:
              run && ["pending", "running", "paused", "failed"].includes(run.status) ? run : null,
          }),
        continue: () => response({ run: run!, next: "none" }),
      });

    it.each([
      [true, "none", false],
      [true, "succeeded", false],
      [true, "rejected", false],
      [true, "pending", true],
      [true, "running", true],
      [true, "paused", true],
      [true, "failed", true],
      [false, "none", true],
      [false, "succeeded", true],
      [false, "rejected", true],
      [false, "pending", true],
      [false, "running", true],
      [false, "paused", true],
      [false, "failed", true],
    ] as const)(
      "[デシジョンテーブル] hidden=%s かつ Run=%s の30秒経過時、current再検証は発生=%s",
      async (hidden, status, polls) => {
        const known = status === "none" ? null : runAt(50, status);
        const fetch = settledApi(known);
        setHidden(hidden);
        await render(known);
        await advance(1_000);
        const before = currentCalls(fetch);
        await advance(30_000);
        expect(currentCalls(fetch) - before).toBe(polls ? 1 : 0);
      },
    );

    it("[状態遷移] 非表示で停止し、表示に戻ると1回だけ再検証して以後30秒ごとに再開する", async () => {
      const fetch = settledApi(null);
      setHidden(true);
      await render(null);
      await advance(1_000);
      const base = currentCalls(fetch);
      await advance(90_000);
      expect(currentCalls(fetch)).toBe(base);
      setHidden(false);
      await visibilityChange();
      expect(currentCalls(fetch)).toBe(base + 1);
      await advance(30_000);
      expect(currentCalls(fetch)).toBe(base + 2);
      await advance(30_000);
      expect(currentCalls(fetch)).toBe(base + 3);
    });

    it("[代表値] 非表示になるvisibilitychangeでは再検証しない", async () => {
      const fetch = settledApi(null);
      setHidden(false);
      await render(null);
      await advance(1_000);
      const base = currentCalls(fetch);
      setHidden(true);
      await visibilityChange();
      expect(currentCalls(fetch)).toBe(base);
    });

    it("[代表値] unmount後のvisibilitychangeでは再検証しない", async () => {
      const fetch = settledApi(null);
      setHidden(true);
      await render(null);
      await advance(1_000);
      const base = currentCalls(fetch);
      const removeListener = vi.spyOn(dom.window.document, "removeEventListener");
      await act(async () => root.unmount());
      expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      setHidden(false);
      await visibilityChange();
      expect(currentCalls(fetch)).toBe(base);
    });
  });
});
