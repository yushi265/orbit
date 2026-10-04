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

  const render = async (value: string) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () =>
      root.render(
        createElement(OrbitDatePicker, { id: "d", label: "D", value, onChange: vi.fn() }),
      ),
    );
    await act(async () =>
      dom.window.document.querySelector('button[aria-label="Dのカレンダー"]')!.click(),
    );
    const grid = dom.window.document.querySelector(".orbit-calendar-grid")!;
    return { dom, root, grid };
  };

  it("[境界値] 曜日見出しは日曜始まり", async () => {
    const { dom, root, grid } = await render("2026-06-15");
    const heads = [...grid.querySelectorAll(".orbit-calendar-weekday")].map((e) => e.textContent);
    expect(heads).toEqual(["日", "月", "火", "水", "木", "金", "土"]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it.each([
    ["2026-02-10", 0, "1日が日曜"],
    ["2026-11-10", 0, "1日が日曜"],
    ["2026-08-10", 6, "1日が土曜"],
    ["2026-06-10", 1, "1日が月曜"],
  ])("[境界値] %s の月初の空白セルは %i (%s)", async (value, blanks) => {
    const { dom, root, grid } = await render(value);
    const children = [...grid.children];
    const firstDay = children.findIndex((e) => e.tagName === "BUTTON");
    expect(firstDay - 7).toBe(blanks);
    expect(children.slice(7, firstDay).every((e) => e.textContent === "")).toBe(true);
    // 15日のボタンが、その日の曜日の列（日曜=0列目）に入っている。
    const [year, month] = value.split("-").map(Number);
    const fifteenth = children.findIndex((e) => e.getAttribute("aria-label")?.endsWith("月15日"));
    expect(fifteenth % 7).toBe(new Date(year, month - 1, 15).getDay());
    await act(async () => root.unmount());
    dom.window.close();
  });
});
