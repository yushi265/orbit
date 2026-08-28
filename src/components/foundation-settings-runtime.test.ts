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

const workflowStates = [
  {
    id: "state-todo",
    userId: "owner",
    name: "Todo",
    category: "unstarted" as const,
    color: "#8B93A1",
    position: 0,
    isDefault: true,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function setSelectValue(select: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value");
  descriptor?.set?.call(select, value);
  const EventConstructor = select.ownerDocument.defaultView!.Event;
  select.dispatchEvent(new EventConstructor("change", { bubbles: true }));
}

describe("Phase 1 Settings runtime interactions", () => {
  it("[状態遷移] saves a timezone selection through the existing Preferences API callback", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/settings",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onPreferences = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          preferences,
          cycleSettings,
          workflowStates,
          labels: [],
          onRefresh: () => undefined,
          run: null,
          runBusy: false,
          onRun: () => undefined,
          onResume: () => undefined,
          onPreferences,
          onCycleSettings: async () => undefined,
          onColorTheme: async () => undefined,
          canInstallPwa: false,
          onInstallPwa: () => undefined,
        }),
      );
    });

    const timezone = dom.window.document.querySelector(
      'select[aria-label="タイムゾーン"]',
    ) as HTMLSelectElement;
    await act(async () => {
      setSelectValue(timezone, "UTC");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onPreferences).toHaveBeenCalledWith({ timezone: "UTC" }, expect.any(String));
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] keeps the previous value and exposes a field error when Preferences save fails", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/settings",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onPreferences = vi.fn().mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "入力内容を確認してください。", {
        timezone: ["timezoneが不正です。"],
      }),
    );
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          preferences,
          cycleSettings,
          workflowStates,
          labels: [],
          onRefresh: () => undefined,
          run: null,
          runBusy: false,
          onRun: () => undefined,
          onResume: () => undefined,
          onPreferences,
          onCycleSettings: async () => undefined,
          onColorTheme: async () => undefined,
          canInstallPwa: false,
          onInstallPwa: () => undefined,
        }),
      );
    });

    const timezone = dom.window.document.querySelector(
      'select[aria-label="タイムゾーン"]',
    ) as HTMLSelectElement;
    await act(async () => {
      setSelectValue(timezone, "UTC");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onPreferences).toHaveBeenCalled();
    expect(timezone.value).toBe("Asia/Tokyo");
    expect(timezone.getAttribute("aria-invalid")).toBe("true");
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "timezoneが不正です。",
    );
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] moves a Workflow state with a PATCH and refreshes the Bootstrap query", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://orbit.example/settings",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          workflowState: { ...workflowStates[0], position: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(dom.window.document.getElementById("root")!);
    const states = [
      ...workflowStates,
      {
        ...workflowStates[0],
        id: "state-done",
        name: "Done",
        category: "completed" as const,
        position: 1,
        isDefault: false,
      },
    ];

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          preferences,
          cycleSettings,
          workflowStates: states,
          labels: [],
          onRefresh,
          run: null,
          runBusy: false,
          onRun: () => undefined,
          onResume: () => undefined,
          onPreferences: async () => undefined,
          onCycleSettings: async () => undefined,
          onColorTheme: async () => undefined,
          canInstallPwa: false,
          onInstallPwa: () => undefined,
        }),
      );
    });

    const moveDown = dom.window.document.querySelector(
      'button[aria-label="Todoを下へ移動"]',
    ) as HTMLButtonElement;
    expect(moveDown.disabled).toBe(false);
    await act(async () => {
      moveDown.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/workflow-states/state-todo",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body).position).toBe(1);
    expect(onRefresh).toHaveBeenCalled();
    const makeDefault = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "既定にする" && !button.disabled,
    )!;
    await act(async () => {
      makeDefault.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/workflow-states/state-done",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body).isDefault).toBe(true);

    const remove = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "削除" && !button.disabled,
    )!;
    await act(async () => {
      remove.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/workflow-states/state-done",
      expect.objectContaining({ method: "DELETE" }),
    );

    const edit = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "編集",
    )!;
    await act(async () => edit.click());
    expect(
      dom.window.document.querySelector('input[aria-label="TodoのWorkflow名"]'),
    ).not.toBeNull();
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
