import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { OrbitDatePicker } from "./orbit-date-picker";

describe("OrbitDatePicker", () => {
  it("[状態遷移] カレンダーで月を移動して日付を選択し、未設定へ戻せる", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(dom.window.document.getElementById("root")!);
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(OrbitDatePicker, {
          id: "due",
          label: "Due date",
          value: "2026-10-31",
          onChange,
        }),
      ),
    );
    const calendarTrigger = dom.window.document.querySelector(
      'button[aria-label="Due dateのカレンダー"]',
    )!;
    expect(calendarTrigger.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(calendarTrigger.textContent).toBe("");
    await act(async () => calendarTrigger.click());
    expect(
      dom.window.document.querySelector('[role="group"][aria-label="Due dateのカレンダー"]'),
    ).not.toBeNull();
    await act(async () =>
      dom.window.document.querySelector('button[aria-label="次の月"]')!.click(),
    );
    await act(async () =>
      dom.window.document.querySelector('button[aria-label="2026年11月1日"]')!.click(),
    );
    expect(onChange).toHaveBeenCalledWith("2026-11-01");
    await act(async () =>
      dom.window.document.querySelector('button[aria-label="Due dateのカレンダー"]')!.click(),
    );
    await act(async () =>
      dom.window.document.querySelector('button[aria-label="日付を解除"]')!.click(),
    );
    expect(onChange).toHaveBeenCalledWith("");
    await act(async () =>
      dom.window.document.querySelector('button[aria-label="Due dateのカレンダー"]')!.click(),
    );
    await act(async () =>
      dom.window.document.body.dispatchEvent(
        new dom.window.Event("pointerdown", { bubbles: true }),
      ),
    );
    expect(
      dom.window.document.querySelector('[role="group"][aria-label="Due dateのカレンダー"]'),
    ).toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
  });
});
