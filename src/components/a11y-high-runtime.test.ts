import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRunViewModel } from "../shared/view-models";
import { RunOverlay, ToastRegion, useToast } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap } from "./review-ui.test-fixtures";

let dom: JSDOM;
let root: Root;
let app: RenderedApp | undefined;
const doc = () => dom.window.document;

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom は IE 系の attachEvent を持たないため、React の入力フォーカス追跡用に補う。
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
  root = createRoot(doc().getElementById("root")!);
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function runWith(
  status: PublicRunViewModel["status"],
  overrides: Partial<PublicRunViewModel> = {},
): PublicRunViewModel {
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
      percent: 10,
    },
    error: null,
    requested_at: 1,
    started_at: 1,
    heartbeat_at: 1,
    finished_at: null,
    resume_count: 0,
    ...overrides,
  };
}
const failure: NonNullable<PublicRunViewModel["error"]> = {
  code: "RUN_STEP_FAILED",
  message: "D1が一時的に応答しませんでした",
  failed_step: "cycle_transition",
  retryable: true,
  request_id: "req-1",
};

async function renderRun(run: PublicRunViewModel, onResume = vi.fn()) {
  await act(async () => root.render(createElement(RunOverlay, { run, busy: false, onResume })));
  return onResume;
}
const buttonByText = (text: string) =>
  [...doc().querySelectorAll("button")].find((button) => button.textContent === text) as
    | HTMLButtonElement
    | undefined;

describe("AC-1 Run banner", () => {
  it.each(["pending", "running"] as const)(
    "[状態遷移] %s はブロッキングのダイアログのまま",
    async (status) => {
      await renderRun(runWith(status));
      const dialog = doc().querySelector('[role="dialog"]')!;
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(doc().querySelector(".run-overlay")).not.toBeNull();
      expect(doc().querySelector(".run-banner")).toBeNull();
    },
  );

  it("[状態遷移] paused は全画面要素なしのバナー(role=status)で step 名と操作を出す", async () => {
    await renderRun(runWith("paused"));
    expect(doc().querySelector(".run-overlay")).toBeNull();
    expect(doc().querySelector('[role="dialog"]')).toBeNull();
    const banner = doc().querySelector(".run-banner")!;
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toContain("処理が一時停止しました");
    expect(banner.textContent).toContain("Cycleの切り替え");
    expect(buttonByText("同じRunを再開")).toBeDefined();
    expect(buttonByText("閉じる")).toBeDefined();
  });

  it("[状態遷移] failed は role=alert で error.message と step 名を出す", async () => {
    await renderRun(runWith("failed", { error: failure }));
    const banner = doc().querySelector(".run-banner")!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("処理が失敗しました");
    expect(banner.textContent).toContain("D1が一時的に応答しませんでした");
    expect(banner.textContent).toContain("Cycleの切り替え");
  });

  it.each([
    ["purge", "ゴミ箱の整理"],
    ["outbox_retry", "通知の再送"],
    ["custom_step", "custom_step"],
  ])("[同値分割] step %s は %s と表示する", async (step, label) => {
    await renderRun(
      runWith("failed", {
        error: { ...failure, failed_step: step } as PublicRunViewModel["error"],
      }),
    );
    expect(doc().querySelector(".run-banner")!.textContent).toContain(label);
  });

  it("[代表値] error が null の failed は失敗理由の行なしで表示する", async () => {
    await renderRun(runWith("failed", { error: null }));
    const banner = doc().querySelector(".run-banner")!;
    expect(banner.querySelector(".run-banner-reason")).toBeNull();
    expect(banner.textContent).toContain("Cycleの切り替え");
  });

  it("[代表値] 同じRunを再開で onResume が呼ばれる", async () => {
    const onResume = await renderRun(runWith("paused"));
    await act(async () => buttonByText("同じRunを再開")!.click());
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("[状態遷移] 閉じるで消え、同じ run_id・status の更新では再表示せず、status 変化で再表示する", async () => {
    await renderRun(runWith("failed", { error: failure }));
    await act(async () => buttonByText("閉じる")!.click());
    expect(doc().querySelector(".run-banner")).toBeNull();
    await renderRun(runWith("failed", { error: failure, heartbeat_at: 99 }));
    expect(doc().querySelector(".run-banner")).toBeNull();
    await renderRun(runWith("paused"));
    expect(doc().querySelector(".run-banner")).not.toBeNull();
    await act(async () => buttonByText("閉じる")!.click());
    await renderRun(runWith("running"));
    expect(doc().querySelector('[role="dialog"]')).not.toBeNull();
    await renderRun(runWith("paused"));
    expect(doc().querySelector(".run-banner")).not.toBeNull();
  });

  it("[代表値] 別の run_id は同じ status でも再表示する", async () => {
    await renderRun(runWith("paused"));
    await act(async () => buttonByText("閉じる")!.click());
    await renderRun(runWith("paused", { run_id: "run-2" }));
    expect(doc().querySelector(".run-banner")).not.toBeNull();
  });
});

let showToastRef: ReturnType<typeof useToast>["showToast"];
function ToastHarness() {
  const { toast, showToast, dismissToast } = useToast();
  useEffect(() => {
    showToastRef = showToast;
  });
  return createElement(ToastRegion, { toast, onDismiss: dismissToast });
}
async function renderToasts() {
  await act(async () => root.render(createElement(ToastHarness)));
}
const statusRegion = () => doc().querySelector('[role="status"]')!;
const alertRegion = () => doc().querySelector('[role="alert"]')!;
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

describe("AC-4 toast", () => {
  it("[代表値] トーストが無くても status と alert のライブリージョンがある", async () => {
    await renderToasts();
    expect(statusRegion()).not.toBeNull();
    expect(alertRegion()).not.toBeNull();
    expect(doc().querySelector(".toast")).toBeNull();
  });

  it("[デシジョンテーブル] 成功・アクションなしは status に出て 3.5 秒後に消える", async () => {
    await renderToasts();
    await act(async () => showToastRef("success", "保存しました"));
    expect(statusRegion().textContent).toContain("保存しました");
    expect(alertRegion().textContent).toBe("");
    expect(doc().querySelector('[aria-label="通知を閉じる"]')).toBeNull();
    await advance(3499);
    expect(doc().querySelector(".toast")).not.toBeNull();
    await advance(1);
    expect(doc().querySelector(".toast")).toBeNull();
  });

  it("[デシジョンテーブル] 成功・アクションありは 10 秒後も残り、閉じるで消える", async () => {
    const undo = vi.fn();
    await renderToasts();
    await act(async () =>
      showToastRef("success", "削除しました", { label: "元に戻す", onClick: undo }),
    );
    await advance(10_000);
    expect(statusRegion().textContent).toContain("削除しました");
    const close = doc().querySelector('[aria-label="通知を閉じる"]') as HTMLButtonElement;
    expect(close).not.toBeNull();
    await act(async () => close.click());
    expect(doc().querySelector(".toast")).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });

  it("[デシジョンテーブル] エラーは alert に出て自動で消えず、閉じるで消える", async () => {
    await renderToasts();
    await act(async () => showToastRef("error", "失敗しました"));
    expect(alertRegion().textContent).toContain("失敗しました");
    expect(statusRegion().textContent).toBe("");
    await advance(10_000);
    expect(alertRegion().textContent).toContain("失敗しました");
    await act(async () =>
      (doc().querySelector('[aria-label="通知を閉じる"]') as HTMLButtonElement).click(),
    );
    expect(doc().querySelector(".toast")).toBeNull();
  });

  it("[状態遷移] 後続の成功トーストは自動で消えないトーストを置き換え、前のタイマーを残さない", async () => {
    await renderToasts();
    await act(async () => showToastRef("error", "失敗しました"));
    await act(async () => showToastRef("success", "完了しました"));
    expect(alertRegion().textContent).toBe("");
    await advance(3500);
    expect(doc().querySelector(".toast")).toBeNull();
  });
});

const bootstrap = reviewBootstrap();
async function openApp(entry: string, locale: "ja" | "en" = "ja") {
  const payload = { ...bootstrap, preferences: { ...bootstrap.preferences, locale } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      const body = path === "/api/v1/bootstrap" ? payload : { run: null };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const container = doc().createElement("div");
  doc().body.append(container);
  app = await renderApp({ url: entry, container });
  await advance(0);
}
function pressKey(key: string) {
  doc().body.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("AC-7 language", () => {
  it.each(["ja", "en"] as const)(
    "[同値分割] preferences.locale=%s でも html lang は ja",
    async (locale) => {
      await openApp("/", locale);
      expect(doc().documentElement.lang).toBe("ja");
    },
  );

  it("[代表値] English は disabled の「English（準備中）」で、保存済み locale は選択値のまま", async () => {
    await openApp("/settings", "en");
    const select = doc().querySelector(
      'select[aria-labelledby="setting-language-label"]',
    ) as HTMLSelectElement;
    const english = [...select.options].find((option) => option.value === "en")!;
    expect(english.textContent).toBe("English（準備中）");
    expect(english.disabled).toBe(true);
    expect(select.value).toBe("en");
  });
});

describe("AC-11 single-key shortcut setting", () => {
  const toggle = () =>
    doc().querySelector('input[aria-label="1文字ショートカット"]') as HTMLInputElement;

  it("[代表値] 初期値は ON で、c で Composer が開く", async () => {
    await openApp("/settings");
    expect(toggle().checked).toBe(true);
    await act(async () => pressKey("c"));
    expect(doc().querySelector("#issue-composer-title")).not.toBeNull();
  });

  it("[代表値] localStorage が off なら OFF 表示で c は Composer を開かない", async () => {
    dom.window.localStorage.setItem("orbit.singleKeyShortcuts", "off");
    await openApp("/settings");
    expect(toggle().checked).toBe(false);
    await act(async () => pressKey("c"));
    expect(doc().querySelector("#issue-composer-title")).toBeNull();
  });

  it("[代表値] トグルを OFF にすると off を保存し c が効かず、修飾キー付きは効く。ON に戻すと復帰する", async () => {
    await openApp("/settings");
    await act(async () => toggle().click());
    expect(dom.window.localStorage.getItem("orbit.singleKeyShortcuts")).toBe("off");
    expect(toggle().checked).toBe(false);
    await act(async () => pressKey("c"));
    expect(doc().querySelector("#issue-composer-title")).toBeNull();
    await act(async () =>
      doc().body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      ),
    );
    expect(doc().querySelector(".command-palette")).not.toBeNull();
    await act(async () => pressKey("Escape"));
    await act(async () => toggle().click());
    expect(dom.window.localStorage.getItem("orbit.singleKeyShortcuts")).toBe("on");
    await act(async () => pressKey("c"));
    expect(doc().querySelector("#issue-composer-title")).not.toBeNull();
  });

  it("[代表値] SELECT にフォーカスがあると c は Composer を開かない", async () => {
    await openApp("/settings");
    const select = doc().querySelector(
      'select[aria-labelledby="setting-language-label"]',
    ) as HTMLSelectElement;
    await act(async () => {
      select.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "c", bubbles: true }));
    });
    expect(doc().querySelector("#issue-composer-title")).toBeNull();
  });

  it.each(["combobox", "listbox"])(
    "[代表値] role=%s にフォーカスがあると c は Composer を開かない",
    async (role) => {
      await openApp("/settings");
      const control = doc().createElement("div");
      control.setAttribute("role", role);
      control.tabIndex = 0;
      const option = doc().createElement("span");
      control.append(option);
      doc().body.append(control);
      await act(async () => {
        option.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "c", bubbles: true }));
      });
      expect(doc().querySelector("#issue-composer-title")).toBeNull();
      control.remove();
      await act(async () => pressKey("c"));
      expect(doc().querySelector("#issue-composer-title")).not.toBeNull();
    },
  );

  it("[代表値] localStorage の getItem が例外でも ON として動く", async () => {
    vi.spyOn(dom.window.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await openApp("/settings");
    expect(toggle().checked).toBe(true);
    await act(async () => pressKey("c"));
    expect(doc().querySelector("#issue-composer-title")).not.toBeNull();
  });
});
