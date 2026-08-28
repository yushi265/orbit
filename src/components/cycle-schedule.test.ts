import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CyclesView } from "./OrbitApp";

const cycles = [
  {
    id: "cycle-upcoming",
    userId: "owner",
    number: 2,
    name: "Cycle 2",
    nameOverride: null,
    description: "次のCycle",
    startsAt: Date.parse("2026-09-06T15:00:00.000Z"),
    endsAt: Date.parse("2026-09-20T15:00:00.000Z"),
    status: "upcoming" as const,
    completedAt: null,
    scheduleOverridden: false,
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("Cycle schedule UI", () => {
  it("[状態遷移] Upcoming Cycleの日付を編集して保存できる", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ cycle: cycles[0] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles,
          cycleId: "cycle-upcoming",
          timezone: "Asia/Tokyo",
          issues: [],
          workflowStates: [],
          pendingIssueId: null,
          onUpdateIssue: () => undefined,
          onRefresh,
          onNavigateIssues: () => undefined,
          onNavigateCycles: () => undefined,
          closeBusy: false,
          startBusy: false,
          onClose: () => undefined,
          onStart: async () => false,
        }),
      );
    });

    const editSchedule = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "日付を調整",
    ) as HTMLButtonElement;
    expect(editSchedule).not.toBeUndefined();
    await act(async () => editSchedule.click());

    const startDate = dom.window.document.querySelector(
      'input[aria-label="Cycle開始日"]',
    ) as HTMLInputElement;
    const endDate = dom.window.document.querySelector(
      'input[aria-label="Cycle終了日"]',
    ) as HTMLInputElement;
    expect(startDate.value).toBe("2026-09-07");
    expect(endDate.value).toBe("2026-09-21");
    expect(
      [...dom.window.document.querySelectorAll(".cycle-tabs button")].every(
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true);
    expect(
      [...dom.window.document.querySelectorAll(".cycle-row-button")].every(
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true);

    const setInputValue = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setInputValue.call(startDate, "2026-09-14");
    await act(async () => {
      startDate.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const latestEndDate = dom.window.document.querySelector(
      'input[aria-label="Cycle終了日"]',
    ) as HTMLInputElement;
    setInputValue.call(latestEndDate, "2026-09-28");
    await act(async () => {
      latestEndDate.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を保存")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/cycles/cycle-upcoming/schedule",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      startDate: "2026-09-14",
      endDate: "2026-09-28",
    });
    expect(onRefresh).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] 409再取得後も編集値とRetry導線を保持する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const mutableCycles = cycles.map((cycle) => ({ ...cycle }));
    let refreshed = false;
    const onRefresh = vi.fn().mockImplementation(async () => {
      if (refreshed) return;
      refreshed = true;
      mutableCycles[0].startsAt = Date.parse("2026-09-07T15:00:00.000Z");
      mutableCycles[0].endsAt = Date.parse("2026-09-21T15:00:00.000Z");
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "IDEMPOTENCY_KEY_REUSED", message: "最新のCycleを確認してください。" },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles: mutableCycles,
          cycleId: "cycle-upcoming",
          timezone: "Asia/Tokyo",
          issues: [],
          workflowStates: [],
          pendingIssueId: null,
          onUpdateIssue: () => undefined,
          onRefresh,
          onNavigateIssues: () => undefined,
          onNavigateCycles: () => undefined,
          closeBusy: false,
          startBusy: false,
          onClose: () => undefined,
          onStart: async () => false,
        }),
      );
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を調整")
        ?.click();
    });
    const startDate = dom.window.document.querySelector(
      'input[aria-label="Cycle開始日"]',
    ) as HTMLInputElement;
    const setInputValue = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setInputValue.call(startDate, "2026-09-14");
    await act(async () => {
      startDate.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を保存")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      (dom.window.document.querySelector('input[aria-label="Cycle開始日"]') as HTMLInputElement)
        .value,
    ).toBe("2026-09-14");
    expect(
      [...dom.window.document.querySelectorAll("button")].some(
        (button) => button.textContent === "日付編集を取消",
      ),
    ).toBe(true);
    expect(
      [...dom.window.document.querySelectorAll("button")].some(
        (button) => button.textContent === "再試行",
      ),
    ).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] 日付保存のエラーでは入力値を保持して再試行できる", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "入力内容を確認してください。",
              fieldErrors: { endDate: ["終了日は開始日より後にしてください。"] },
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ cycle: cycles[0] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles,
          cycleId: "cycle-upcoming",
          timezone: "Asia/Tokyo",
          issues: [],
          workflowStates: [],
          pendingIssueId: null,
          onUpdateIssue: () => undefined,
          onRefresh,
          onNavigateIssues: () => undefined,
          onNavigateCycles: () => undefined,
          closeBusy: false,
          startBusy: false,
          onClose: () => undefined,
          onStart: async () => false,
        }),
      );
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を調整")
        ?.click();
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を保存")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      (dom.window.document.querySelector('input[aria-label="Cycle開始日"]') as HTMLInputElement)
        .value,
    ).toBe("2026-09-07");
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "終了日は開始日より後にしてください。",
    );
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "再試行")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] 日付保存中はdate inputと保存操作を無効化する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let resolveRequest: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles,
          cycleId: "cycle-upcoming",
          timezone: "Asia/Tokyo",
          issues: [],
          workflowStates: [],
          pendingIssueId: null,
          onUpdateIssue: () => undefined,
          onRefresh: () => undefined,
          onNavigateIssues: () => undefined,
          onNavigateCycles: () => undefined,
          closeBusy: false,
          startBusy: false,
          onClose: () => undefined,
          onStart: async () => false,
        }),
      );
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を調整")
        ?.click();
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を保存")
        ?.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      [...dom.window.document.querySelectorAll('input[aria-label^="Cycle"]')].every(
        (input) => (input as HTMLInputElement).disabled,
      ),
    ).toBe(true);
    expect(
      [...dom.window.document.querySelectorAll("button")].find(
        (button) => button.textContent === "保存中…",
      ),
    ).toMatchObject({ disabled: true });

    await act(async () => {
      resolveRequest?.(
        new Response(JSON.stringify({ cycle: cycles[0] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] 423後のRetryを維持し、500でも入力値を保持する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "OPERATION_IN_PROGRESS", message: "ロック中です。" } }),
          {
            status: 423,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "一時的な障害です。" } }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles,
          cycleId: "cycle-upcoming",
          timezone: "Asia/Tokyo",
          issues: [],
          workflowStates: [],
          pendingIssueId: null,
          onUpdateIssue: () => undefined,
          onRefresh: () => undefined,
          onNavigateIssues: () => undefined,
          onNavigateCycles: () => undefined,
          closeBusy: false,
          startBusy: false,
          onClose: () => undefined,
          onStart: async () => false,
        }),
      );
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を調整")
        ?.click();
    });
    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "日付を保存")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "ロック中です。",
    );
    expect(
      (dom.window.document.querySelector('input[aria-label="Cycle開始日"]') as HTMLInputElement)
        .value,
    ).toBe("2026-09-07");

    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "再試行")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "一時的な障害です。",
    );
    expect(
      [...dom.window.document.querySelectorAll("button")].some(
        (button) => button.textContent === "再試行",
      ),
    ).toBe(true);

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[境界値] Active / Completed Cycleでは日付調整UIを表示しない", async () => {
    for (const status of ["active", "completed"] as const) {
      const dom = new JSDOM("<!doctype html><div id='root'></div>");
      vi.stubGlobal("window", dom.window);
      vi.stubGlobal("document", dom.window.document);
      vi.stubGlobal("navigator", dom.window.navigator);
      vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
      vi.stubGlobal("Node", dom.window.Node);
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const cycle = { ...cycles[0], id: `cycle-${status}`, status };
      const root = createRoot(dom.window.document.getElementById("root")!);

      await act(async () => {
        root.render(
          createElement(CyclesView, {
            cycles: [cycle],
            cycleId: cycle.id,
            timezone: "Asia/Tokyo",
            issues: [],
            workflowStates: [],
            pendingIssueId: null,
            onUpdateIssue: () => undefined,
            onRefresh: () => undefined,
            onNavigateIssues: () => undefined,
            onNavigateCycles: () => undefined,
            closeBusy: false,
            startBusy: false,
            onClose: () => undefined,
            onStart: async () => false,
          }),
        );
      });

      expect(
        [...dom.window.document.querySelectorAll("button")].some(
          (button) => button.textContent === "日付を調整",
        ),
      ).toBe(false);
      await act(async () => {
        root.unmount();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  });
});
