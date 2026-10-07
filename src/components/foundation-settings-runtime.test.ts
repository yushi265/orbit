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
  autoAddToCurrentCycle: false,
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
      'select[aria-labelledby="setting-timezone-label"]',
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
      'select[aria-labelledby="setting-timezone-label"]',
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

function mountSettingsDom() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/settings",
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom は IE 系の attachEvent を持たないため、React の入力値追跡用に補う。
  for (const eventName of ["attachEvent", "detachEvent"])
    Object.defineProperty(dom.window.HTMLElement.prototype, eventName, {
      value: function (this: HTMLElement, name: string, handler: EventListener) {
        if (eventName === "attachEvent") this.addEventListener(name.replace(/^on/, ""), handler);
        else this.removeEventListener(name.replace(/^on/, ""), handler);
      },
    });
  return { dom, root: createRoot(dom.window.document.getElementById("root")!) };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const window = input.ownerDocument.defaultView!;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
    input,
    value,
  );
  input.focus();
  input.dispatchEvent(
    Object.assign(new window.Event("propertychange", { bubbles: true }), {
      propertyName: "value",
    }),
  );
}

function errorResponse(status: number, code: string) {
  return new Response(JSON.stringify({ error: { code, message: "失敗しました。" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const settingsProps = {
  preferences,
  cycleSettings,
  workflowStates,
  labels: [],
  onRefresh: () => undefined,
  run: null,
  runBusy: false,
  onRun: () => undefined,
  onResume: () => undefined,
  onPreferences: async () => undefined,
  onCycleSettings: async () => undefined,
  onColorTheme: async () => undefined,
  canInstallPwa: false,
  onInstallPwa: () => undefined,
};

const sentKeys = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).idempotencyKey);

async function clickButton(dom: JSDOM, text: string, scope?: Element | null) {
  const button = [...(scope ?? dom.window.document).querySelectorAll("button")].find(
    (item) => item.textContent === text && !item.disabled,
  )!;
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Settings 冪等キーの保持", () => {
  it("[状態遷移] Preferences保存が失敗した後の再試行は同じ冪等キーで送る", async () => {
    const { dom, root } = mountSettingsDom();
    const onPreferences = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "失敗しました。"))
      .mockResolvedValueOnce(undefined);
    await act(async () => {
      root.render(createElement(SettingsView, { ...settingsProps, onPreferences }));
    });
    const timezone = dom.window.document.querySelector(
      'select[aria-labelledby="setting-timezone-label"]',
    ) as HTMLSelectElement;
    await act(async () => {
      setSelectValue(timezone, "UTC");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await clickButton(dom, "再試行");

    expect(onPreferences).toHaveBeenCalledTimes(2);
    const [first, second] = onPreferences.mock.calls.map(([, key]) => key);
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] Label作成が423で失敗した後の再試行は同じ冪等キーで送り、成功後の新規作成は新しいキーにする", async () => {
    const { dom, root } = mountSettingsDom();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(423, "OPERATION_IN_PROGRESS"))
      .mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      root.render(createElement(SettingsView, settingsProps));
    });
    const fillAndAdd = async () => {
      const name = dom.window.document.querySelector(
        'input[aria-label="Label名"]',
      ) as HTMLInputElement;
      await act(async () => setInputValue(name, "Bug"));
      await clickButton(dom, "追加", name.parentElement);
    };
    await fillAndAdd();
    await clickButton(dom, "再試行");

    expect(fetch).toHaveBeenCalledTimes(2);
    const keys = sentKeys(fetch);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);

    await fillAndAdd();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sentKeys(fetch)[2]).not.toBe(keys[0]);
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[状態遷移] Workflow追加が失敗した後の再試行は同じ冪等キーで送り、成功後の同内容の追加は新しいキーにする", async () => {
    const { dom, root } = mountSettingsDom();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR"))
      .mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      root.render(createElement(SettingsView, settingsProps));
    });
    const fillAndAdd = async () => {
      const name = dom.window.document.querySelector(
        'input[aria-label="Workflow名"]',
      ) as HTMLInputElement;
      await act(async () => setInputValue(name, "Review"));
      await clickButton(dom, "追加", name.parentElement);
    };
    await fillAndAdd();
    await clickButton(dom, "再試行");

    expect(fetch).toHaveBeenCalledTimes(2);
    const keys = sentKeys(fetch);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);

    await fillAndAdd();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sentKeys(fetch)[2]).not.toBe(keys[0]);
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
