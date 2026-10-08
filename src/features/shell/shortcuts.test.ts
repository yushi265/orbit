import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutAction } from "../../components/issue-core-ui";
import { useShortcutDispatcher, type ShortcutHandlers } from "./shortcuts";

let dom: JSDOM;
let root: Root;

function Probe(props: { blocked: boolean; handlers: ShortcutHandlers }) {
  useShortcutDispatcher(props.blocked, props.handlers);
  return null;
}

beforeEach(() => {
  dom = new JSDOM(
    "<!doctype html><div id='root'></div><input id='field' /><textarea id='area'></textarea><div id='editable' contenteditable='true'></div><select id='choice'></select><div role='combobox'><span id='combo'></span></div>",
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function render(blocked: boolean, handlers: ShortcutHandlers) {
  await act(async () => root.render(createElement(Probe, { blocked, handlers })));
}

function press(init: KeyboardEventInit, target: EventTarget = dom.window) {
  const event = new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useShortcutDispatcher", () => {
  it.each<[string, KeyboardEventInit, ShortcutAction]>([
    ["Ctrl+K", { key: "k", ctrlKey: true }, "command"],
    ["c", { key: "c" }, "create"],
    ["?", { key: "?" }, "help"],
    ["Escape", { key: "Escape" }, "close"],
    ["Ctrl+F", { key: "f", ctrlKey: true }, "focus-search"],
  ])(
    "[デシジョンテーブル] 抑止なし × %s → %s のハンドラを呼び、既定動作を止める",
    async (_, init, action) => {
      const handler = vi.fn();
      await render(false, { [action]: handler });
      const event = press(init);
      expect(handler).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it("[デシジョンテーブル] 抑止あり × ショートカット → ハンドラを呼ばず、既定動作も止めない", async () => {
    const handler = vi.fn();
    await render(true, { create: handler });
    const event = press({ key: "c" });
    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("[デシジョンテーブル] 抑止なし × ショートカット以外のキー → 何もしない", async () => {
    const handler = vi.fn();
    await render(false, { create: handler });
    const event = press({ key: "z" });
    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("[デシジョンテーブル] 抑止なし × ハンドラ未登録のショートカット → 既定動作だけ止める（現行と同じ）", async () => {
    await render(false, {});
    expect(press({ key: "c" }).defaultPrevented).toBe(true);
  });

  it("[同値分割] IME 変換中 → 何もしない", async () => {
    const handler = vi.fn();
    await render(false, { create: handler });
    const event = press({ key: "c", isComposing: true });
    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(["field", "area", "editable", "choice", "combo"])(
    "[同値分割] 入力欄・select・combobox（#%s）での単一キー → 何もしない",
    async (id) => {
      const handler = vi.fn();
      await render(false, { create: handler });
      const target = dom.window.document.getElementById(id)!;
      if (id === "editable") Object.defineProperty(target, "isContentEditable", { value: true });
      press({ key: "c" }, target);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("[状態遷移] 再描画で渡したハンドラと抑止状態が次のキー入力から使われる", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await render(false, { create: first });
    await render(false, { create: second });
    press({ key: "c" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    await render(true, { create: second });
    press({ key: "c" });
    expect(second).toHaveBeenCalledOnce();
  });

  it("[代表値] unmount 後はキー入力を受け取らない", async () => {
    const handler = vi.fn();
    await render(false, { create: handler });
    await act(async () => root.unmount());
    root = createRoot(dom.window.document.getElementById("root")!);
    press({ key: "c" });
    expect(handler).not.toHaveBeenCalled();
  });
});
