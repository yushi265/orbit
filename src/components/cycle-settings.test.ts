import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./OrbitApp";
import { ApiError } from "../lib/api-client";

const preferences = {
  userId: "owner",
  timezone: "Asia/Tokyo",
  locale: "ja" as const,
  theme: "system" as const,
  colorTheme: "coral" as const,
  estimateEnabled: true,
  issueCounter: 0,
};
const cycleSettings = {
  userId: "owner",
  enabled: true,
  durationWeeks: 2,
  cooldownWeeks: 0,
  startWeekday: 1,
  futureCount: 3,
};
const baseProps = {
  preferences,
  cycleSettings,
  workflowStates: [],
  labels: [],
  onRefresh: () => undefined,
  run: null,
  runBusy: false,
  onRun: () => undefined,
  onResume: () => undefined,
  onPreferences: async () => undefined,
  onColorTheme: async () => undefined,
  onCycleSettings: async () => undefined,
  canInstallPwa: false,
  onInstallPwa: () => undefined,
};

afterEach(() => vi.unstubAllGlobals());

describe("Cycle settings UI", () => {
  it("[代表値] Settingsに期間・開始曜日・Timezoneの説明を表示する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(createElement(SettingsView, baseProps));
    });

    expect(dom.window.document.querySelector('select[aria-label="Cycle期間"]')).not.toBeNull();
    expect(dom.window.document.querySelector('select[aria-label="Cycle開始曜日"]')).not.toBeNull();
    expect(dom.window.document.body.textContent).toContain("Asia/Tokyo");
    expect(dom.window.document.body.textContent).toContain("Cycle設定を保存");
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] 期間と開始曜日を選択して保存する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onCycleSettings = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(createElement(SettingsView, { ...baseProps, onCycleSettings }));
    });
    const duration = dom.window.document.querySelector(
      'select[aria-label="Cycle期間"]',
    ) as HTMLSelectElement;
    const weekday = dom.window.document.querySelector(
      'select[aria-label="Cycle開始曜日"]',
    ) as HTMLSelectElement;
    await act(async () => {
      duration.value = "4";
      duration.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => {
      weekday.value = "5";
      weekday.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => {
      (dom.window.document.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onCycleSettings).toHaveBeenCalledWith(
      { durationWeeks: 4, startWeekday: 5 },
      expect.any(String),
    );
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] 保存エラーでは選択値を戻してfield errorを表示する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onCycleSettings = vi.fn().mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "入力内容を確認してください。", {
        durationWeeks: ["Cycle期間が不正です。"],
      }),
    );
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(createElement(SettingsView, { ...baseProps, onCycleSettings }));
    });
    const duration = dom.window.document.querySelector(
      'select[aria-label="Cycle期間"]',
    ) as HTMLSelectElement;
    duration.value = "4";
    await act(async () => {
      duration.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      (dom.window.document.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(duration.value).toBe("4");
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "Cycle期間が不正です。",
    );
    await act(async () => {
      const retry = [...dom.window.document.querySelectorAll("button")].find(
        (button) => button.textContent === "再試行",
      ) as HTMLButtonElement;
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onCycleSettings).toHaveBeenLastCalledWith(
      { durationWeeks: 4, startWeekday: 1 },
      expect.any(String),
    );
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] 409では最新設定を再取得して競合を表示する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onCycleSettings = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "別の内容で保存されています。"),
      );
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(createElement(SettingsView, { ...baseProps, onRefresh, onCycleSettings }));
    });
    const duration = dom.window.document.querySelector(
      'select[aria-label="Cycle期間"]',
    ) as HTMLSelectElement;
    await act(async () => {
      duration.value = "4";
      duration.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => {
      (dom.window.document.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "別の内容で保存されています。",
    );
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
