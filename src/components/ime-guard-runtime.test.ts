import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./OrbitApp";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

let dom: JSDOM;
let app: RenderedApp | undefined;
let settingsRoot: Root | undefined;
let requests: Array<{ path: string; method: string }>;
let unexpected: string[];
let boot = reviewBootstrap();

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function setValue(input: HTMLInputElement, value: string) {
  input.focus();
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  input.dispatchEvent(
    Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
      propertyName: "value",
    }),
  );
}
async function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  await act(async () =>
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    ),
  );
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
function q<T extends Element>(selector: string) {
  return dom.window.document.querySelector(selector) as T | null;
}
const IME_EVENTS = [{ isComposing: true }, { keyCode: 229 }];

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/search" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  for (const [name, method] of [
    ["attachEvent", "addEventListener"],
    ["detachEvent", "removeEventListener"],
  ] as const) {
    Object.defineProperty(dom.window.HTMLElement.prototype, name, {
      value: function (this: HTMLElement, event: string, handler: EventListener) {
        this[method](event.replace(/^on/, ""), handler);
      },
    });
  }
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  boot = reviewBootstrap();
  requests = [];
  unexpected = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      requests.push({ path, method });
      if (path === "/api/v1/bootstrap") return Promise.resolve(json(boot));
      if (path === "/api/v1/background-runs/current") return Promise.resolve(json({ run: null }));
      if (path === "/api/v1/recent") return Promise.resolve(json({ issueViews: [], searches: [] }));
      if (path === "/api/v1/recent-searches" && method === "POST") return Promise.resolve(json({}));
      if (path.startsWith("/api/v1/search?"))
        return Promise.resolve(json({ items: [reviewIssue("hit")] }));
      if (path === "/api/v1/issues/hit" && method === "GET")
        return Promise.resolve(json(reviewDetail(reviewIssue("hit"))));
      if (path === "/api/v1/recent-issue-views" && method === "POST")
        return Promise.resolve(json({}));
      if (path === "/api/v1/labels" && method === "POST") return Promise.resolve(json({}));
      if (path === "/api/v1/workflow-states" && method === "POST") return Promise.resolve(json({}));
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error(`Unexpected API request: ${method} ${path}`));
    }),
  );
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  if (settingsRoot) await act(async () => settingsRoot!.unmount());
  settingsRoot = undefined;
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});

async function renderOrbit(url = "/search") {
  app = await renderApp({ url, container: dom.window.document.getElementById("root")! });
  await advance(0);
}
async function renderSettings() {
  const state = reviewBootstrap().workflowStates;
  settingsRoot = createRoot(dom.window.document.getElementById("root")!);
  await act(async () =>
    settingsRoot!.render(
      createElement(SettingsView, {
        preferences: reviewBootstrap().preferences,
        cycleSettings: reviewBootstrap().cycleSettings,
        workflowStates: state,
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
      }),
    ),
  );
}
const posts = (path: string) =>
  requests.filter((r) => r.path === path && r.method === "POST").length;

describe("IME composition guard: command palette", () => {
  async function openPalette() {
    await renderOrbit();
    await press(dom.window.document.body, "k", { ctrlKey: true });
    return q<HTMLInputElement>("#command-palette-options")!.parentElement!.querySelector("input")!;
  }
  it.each(IME_EVENTS)("[同値分割] 変換中Enter %j はコマンドを実行しない", async (ime) => {
    const input = await openPalette();
    await press(input, "Enter", ime);
    expect(q("#command-palette-options")).not.toBeNull();
    expect(q("textarea")).toBeNull();
  });
  it.each(IME_EVENTS)("[同値分割] 変換中Escape %j はパレットを閉じない", async (ime) => {
    const input = await openPalette();
    await press(input, "Escape", ime);
    expect(q("#command-palette-options")).not.toBeNull();
  });
  it("[同値分割] 変換中でないEnterはコマンドを実行する", async () => {
    const input = await openPalette();
    await press(input, "Enter");
    expect(q("#command-palette-options")).toBeNull();
  });
  it("[同値分割] 変換中でないEscapeはパレットを閉じる", async () => {
    const input = await openPalette();
    await press(input, "Escape");
    expect(q("#command-palette-options")).toBeNull();
  });
});

describe("IME composition guard: Search input", () => {
  async function searchHit() {
    await renderOrbit();
    const input = q<HTMLInputElement>("#global-search-input")!;
    await act(async () => setValue(input, "hit"));
    await advance(300);
    return input;
  }
  it.each(IME_EVENTS)("[同値分割] 変換中Enter %j は結果を開かない", async (ime) => {
    const input = await searchHit();
    const historyLength = app!.router.history.length;
    await press(input, "Enter", ime);
    expect(app!.router.state.location.pathname).toBe("/search");
    expect(app!.router.history.length).toBe(historyLength);
  });
  it("[同値分割] 変換中でないEnterは先頭結果を開く", async () => {
    const input = await searchHit();
    await press(input, "Enter");
    expect(app!.router.state.location.pathname).toBe("/issues/hit");
  });
});

describe("IME composition guard: Label name / Workflow create", () => {
  it.each(IME_EVENTS)("[同値分割] Label名 変換中Enter %j は保存しない", async (ime) => {
    await renderSettings();
    const input = q<HTMLInputElement>('input[aria-label="Label名"]')!;
    await act(async () => setValue(input, "Bug"));
    await press(input, "Enter", ime);
    expect(posts("/api/v1/labels")).toBe(0);
  });
  it.each(IME_EVENTS)("[同値分割] Label名 変換中Escape %j は編集を取り消さない", async (ime) => {
    await renderSettings();
    const input = q<HTMLInputElement>('input[aria-label="Label名"]')!;
    await act(async () => setValue(input, "Bug"));
    await press(input, "Escape", ime);
    expect(input.value).toBe("Bug");
  });
  it.each(IME_EVENTS)("[同値分割] Label色 変換中Enter/Escape %j は無視する", async (ime) => {
    await renderSettings();
    const name = q<HTMLInputElement>('input[aria-label="Label名"]')!;
    await act(async () => setValue(name, "Bug"));
    const color = q<HTMLInputElement>('input[aria-label="Label色"]')!;
    await press(color, "Enter", ime);
    await press(color, "Escape", ime);
    expect(posts("/api/v1/labels")).toBe(0);
    expect(name.value).toBe("Bug");
  });
  it("[同値分割] 変換中でないLabel Enterは保存、Escapeは取消", async () => {
    await renderSettings();
    const name = q<HTMLInputElement>('input[aria-label="Label名"]')!;
    await act(async () => setValue(name, "Bug"));
    await press(name, "Escape");
    expect(name.value).toBe("");
    await act(async () => setValue(name, "Bug"));
    await press(name, "Enter");
    expect(posts("/api/v1/labels")).toBe(1);
  });
  it.each(IME_EVENTS)("[同値分割] Workflow名 変換中Enter %j は作成しない", async (ime) => {
    await renderSettings();
    const input = q<HTMLInputElement>('input[aria-label="Workflow名"]')!;
    await act(async () => setValue(input, "Review"));
    await press(input, "Enter", ime);
    expect(posts("/api/v1/workflow-states")).toBe(0);
  });
  it("[同値分割] 変換中でないWorkflow名Enterは作成する", async () => {
    await renderSettings();
    const input = q<HTMLInputElement>('input[aria-label="Workflow名"]')!;
    await act(async () => setValue(input, "Review"));
    await press(input, "Enter");
    expect(posts("/api/v1/workflow-states")).toBe(1);
  });
});

describe("IME composition guard: window shortcut Escape", () => {
  it.each(IME_EVENTS)(
    "[同値分割] 変換中Escape %j はwindowショートカットを発火しない",
    async (ime) => {
      await renderOrbit();
      // window経路のEscape(close)は変換中ならpreventDefaultもしない
      const event = new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        ...ime,
      });
      await act(async () => {
        dom.window.document.body.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
    },
  );
});

const NOW = Date.UTC(2026, 0, 10);
function cycle(id: string, number: number, status: "active" | "upcoming") {
  return {
    id,
    userId: "owner",
    number,
    name: `Cycle ${number}`,
    nameOverride: null,
    description: "",
    startsAt: status === "active" ? NOW - 86400000 : NOW + 5 * 86400000,
    endsAt: status === "active" ? NOW + 86400000 : NOW + 12 * 86400000,
    status,
    completedAt: null,
    scheduleOverridden: false,
  };
}
function buttonByText(text: string) {
  return [...dom.window.document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  )!;
}

describe("IME composition guard: Cycle / Project editors", () => {
  async function openCycles() {
    boot.cycles.push(cycle("c1", 1, "active"), cycle("c2", 2, "upcoming"));
    await renderOrbit("/cycles");
  }
  it.each(IME_EVENTS)("[同値分割] Cycle名 変換中Escape %j は編集を取り消さない", async (ime) => {
    await openCycles();
    await act(async () => buttonByText("編集").click());
    const input = q<HTMLInputElement>('input[aria-label="Cycle名"]')!;
    await press(input, "Escape", ime);
    expect(q('input[aria-label="Cycle名"]')).not.toBeNull();
  });
  it("[同値分割] Cycle名 変換中でないEscapeは編集を取り消す", async () => {
    await openCycles();
    await act(async () => buttonByText("編集").click());
    await press(q('input[aria-label="Cycle名"]')!, "Escape");
    expect(q('input[aria-label="Cycle名"]')).toBeNull();
  });
  async function openScheduleEditor() {
    await openCycles();
    await act(async () =>
      [...dom.window.document.querySelectorAll(".cycle-tabs button")]
        .find((b) => b.textContent?.startsWith("Upcoming"))!
        .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })),
    );
    await act(async () => buttonByText("日付を調整").click());
    return q<HTMLElement>("#cycle-start-date")!;
  }
  it.each(IME_EVENTS)(
    "[同値分割] Cycleスケジュール 変換中Escape %j は取り消さない",
    async (ime) => {
      const field = await openScheduleEditor();
      await press(field, "Escape", ime);
      expect(q(".cycle-schedule-editor")).not.toBeNull();
    },
  );
  it("[同値分割] Cycleスケジュール 変換中でないEscapeは取り消す", async () => {
    const field = await openScheduleEditor();
    await press(field, "Escape");
    expect(q(".cycle-schedule-editor")).toBeNull();
  });
  async function openProjectEditor() {
    await renderOrbit("/projects/project-1");
    await act(async () => buttonByText("Projectを編集").click());
    return q<HTMLElement>("#project-target-detail")!;
  }
  it.each(IME_EVENTS)(
    "[同値分割] Project Target date 変換中Escape %j は取り消さない",
    async (ime) => {
      const field = await openProjectEditor();
      await press(field, "Escape", ime);
      expect(q("#project-target-detail")).not.toBeNull();
    },
  );
  it("[同値分割] Project Target date 変換中でないEscapeは取り消す", async () => {
    const field = await openProjectEditor();
    await press(field, "Escape");
    expect(q("#project-target-detail")).toBeNull();
  });
});

describe("IME composition guard: 正の対照", () => {
  it("[同値分割] window経路 変換中でないEscapeはpreventDefaultされる", async () => {
    await renderOrbit();
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      dom.window.document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });
  it("[同値分割] Label色 変換中でないEscapeは取消、Enterは保存", async () => {
    await renderSettings();
    const name = q<HTMLInputElement>('input[aria-label="Label名"]')!;
    await act(async () => setValue(name, "Bug"));
    const color = q<HTMLInputElement>('input[aria-label="Label色"]')!;
    await press(color, "Enter");
    expect(posts("/api/v1/labels")).toBe(1);
    await act(async () => setValue(name, "Bug2"));
    await press(color, "Escape");
    expect(name.value).toBe("");
  });
});
