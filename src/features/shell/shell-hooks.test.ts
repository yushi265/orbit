import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewBootstrap } from "../../components/review-ui.test-fixtures";
import { colorThemeOptions } from "../../components/theme";
import { useClockNow } from "./clock";
import { useCompletedFallback } from "./completed-fallback";
import { useDocumentEffects } from "./document-effects";
import { usePwaInstall } from "./pwa-install";

// REFACTOR-ui-architecture Phase 3b-1a: OrbitAppInner から切り出したシェルの hook。

let dom: JSDOM;
let root: Root;
let matchMediaListeners: (() => void)[];
let darkScheme: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM(
    "<!doctype html><html><head><meta name='theme-color' content='#000'></head><body><div id='root'></div></body></html>",
    { url: "https://orbit.example/" },
  );
  matchMediaListeners = [];
  darkScheme = false;
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      get matches() {
        return darkScheme;
      },
      addEventListener: (_: string, listener: () => void) => matchMediaListeners.push(listener),
      removeEventListener: (_: string, listener: () => void) => {
        matchMediaListeners = matchMediaListeners.filter((item) => item !== listener);
      },
    }),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(element: Parameters<typeof root.render>[0]) {
  await act(async () => root.render(element));
}

describe("useClockNow", () => {
  let latest = 0;
  function Probe() {
    latest = useClockNow();
    return null;
  }

  it("[状態遷移] 60 秒ごと・window の focus / online で現在時刻を更新する", async () => {
    vi.setSystemTime(1_000);
    await render(createElement(Probe));
    expect(latest).toBe(1_000);
    vi.setSystemTime(30_000);
    await act(async () => vi.advanceTimersByTime(59_999 - 29_000));
    expect(latest).toBe(1_000);
    await act(async () => vi.advanceTimersByTime(29_001));
    expect(latest).toBe(90_000);
    vi.setSystemTime(200_000);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("focus")));
    expect(latest).toBe(200_000);
    vi.setSystemTime(300_000);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("online")));
    expect(latest).toBe(300_000);
  });
});

describe("useCompletedFallback", () => {
  let latest: ReturnType<typeof useCompletedFallback>;
  function Probe(props: { completed?: boolean }) {
    latest = useCompletedFallback(props.completed);
    return null;
  }

  it.each([
    [null, true],
    ["false", false],
    ["true", true],
    ["broken", true],
  ])("[同値分割] localStorage が %s → 既定値 %s で ready になる", async (stored, expected) => {
    if (stored !== null) dom.window.localStorage.setItem("orbit.issues.showCompleted", stored);
    await render(createElement(Probe, {}));
    expect(latest).toEqual({ completedFallback: expected, ready: true });
  });

  it("[状態遷移] ready の後は表示中の completed（search 優先、無ければ既定値）を localStorage へ書き込む", async () => {
    dom.window.localStorage.setItem("orbit.issues.showCompleted", "false");
    await render(createElement(Probe, {}));
    expect(dom.window.localStorage.getItem("orbit.issues.showCompleted")).toBe("false");
    await render(createElement(Probe, { completed: true }));
    expect(dom.window.localStorage.getItem("orbit.issues.showCompleted")).toBe("true");
    expect(latest.completedFallback).toBe(false);
  });
});

describe("useDocumentEffects", () => {
  function Probe(props: { preferences?: ReturnType<typeof reviewBootstrap>["preferences"] }) {
    useDocumentEffects(props.preferences);
    return null;
  }
  const html = () => dom.window.document.documentElement;
  const themeColor = () =>
    dom.window.document.querySelector('meta[name="theme-color"]')!.getAttribute("content");

  it("[同値分割] preferences 未取得 → テーマと lang を変えない", async () => {
    await render(createElement(Probe, {}));
    expect(html().dataset.theme).toBeUndefined();
    expect(html().lang).toBe("");
  });

  it("[デシジョンテーブル] theme=light / dark → data-theme・theme-color を設定し、lang は ja に固定", async () => {
    const preferences = { ...reviewBootstrap().preferences, locale: "en" as const };
    await render(
      createElement(Probe, { preferences: { ...preferences, theme: "light" as const } }),
    );
    expect(html().dataset.theme).toBe("light");
    expect(html().lang).toBe("ja");
    expect(themeColor()).toBe(colorThemeOptions[0].accent);
    await render(createElement(Probe, { preferences: { ...preferences, theme: "dark" as const } }));
    expect(html().dataset.theme).toBe("dark");
    expect(themeColor()).toBe("#11151d");
  });

  it("[状態遷移] theme=system → OS の配色変更に追従する", async () => {
    const preferences = { ...reviewBootstrap().preferences, theme: "system" as const };
    await render(createElement(Probe, { preferences }));
    expect(html().dataset.theme).toBe("light");
    darkScheme = true;
    await act(async () => matchMediaListeners.forEach((listener) => listener()));
    expect(html().dataset.theme).toBe("dark");
  });

  it("[代表値] ServiceWorker を 1 回登録する", async () => {
    const register = vi.fn(() => Promise.resolve());
    Object.defineProperty(dom.window.navigator, "serviceWorker", { value: { register } });
    await render(createElement(Probe, {}));
    expect(register).toHaveBeenCalledWith("/sw.js?v=4", { updateViaCache: "none" });
  });
});

describe("usePwaInstall", () => {
  let latest: ReturnType<typeof usePwaInstall>;
  const onResult = vi.fn();
  function Probe() {
    latest = usePwaInstall(onResult);
    return null;
  }
  function promptEvent(outcome: "accepted" | "dismissed" | Error) {
    const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () =>
        outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ outcome }),
    });
    return event;
  }

  beforeEach(() => onResult.mockReset());

  it("[状態遷移] beforeinstallprompt → インストール可能、install で accepted → 成功を通知して不可に戻る", async () => {
    await render(createElement(Probe));
    expect(latest.canInstall).toBe(false);
    const event = promptEvent("accepted");
    await act(async () => dom.window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(latest.canInstall).toBe(true);
    await act(async () => latest.install());
    expect(onResult).toHaveBeenCalledWith("installed");
    expect(latest.canInstall).toBe(false);
  });

  it("[同値分割] dismissed → 何も通知せず不可に戻る / prompt 失敗 → 失敗を通知", async () => {
    await render(createElement(Probe));
    await act(async () => dom.window.dispatchEvent(promptEvent("dismissed")));
    await act(async () => latest.install());
    expect(onResult).not.toHaveBeenCalled();
    expect(latest.canInstall).toBe(false);
    await act(async () => dom.window.dispatchEvent(promptEvent(new Error("blocked"))));
    await act(async () => latest.install());
    expect(onResult).toHaveBeenCalledWith("failed");
  });

  it("[状態遷移] appinstalled → インストール不可", async () => {
    await render(createElement(Probe));
    await act(async () => dom.window.dispatchEvent(promptEvent("accepted")));
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("appinstalled")));
    expect(latest.canInstall).toBe(false);
  });
});
