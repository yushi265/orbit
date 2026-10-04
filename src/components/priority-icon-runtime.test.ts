import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { PriorityIcon } from "./OrbitApp";
import { priorityIconFor } from "./issue-priority";

describe("PriorityIcon runtime", () => {
  it.each([
    ["urgent", "urgent", "Urgent", 2],
    ["high", "high", "High", 1],
    ["medium", "medium", "Medium", 2],
    ["low", "low", "Low", 1],
    ["no_priority", "none", "No priority", 1],
  ] as const)("[同値分割] %s はSVGシェブロンで描画される", async (priority, name, label, count) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => root.render(createElement(PriorityIcon, { priority })));
    const doc = dom.window.document;
    const icon = doc.querySelector(`.priority-icon.${name}`)!;
    expect(icon.getAttribute("role")).toBe("img");
    expect(icon.getAttribute("aria-label")).toBe(label);
    expect(icon.querySelectorAll("svg.priority-glyph path")).toHaveLength(count);
    // 選択欄の細い「⌄」と見分けられるよう、太め・大きめの線で描く。
    const glyph = icon.querySelector("svg.priority-glyph")!;
    expect(glyph.getAttribute("width")).toBe("18");
    expect(glyph.getAttribute("height")).toBe("18");
    expect(glyph.getAttribute("stroke-width")).toBe("2.5");
    const drawn = [...glyph.querySelectorAll("path")].map((path) => ({
      d: path.getAttribute("d"),
      dash: path.getAttribute("stroke-dasharray"),
    }));
    expect(drawn).toEqual(
      priorityIconFor(priority).paths.map((path) => ({ d: path.d, dash: path.dash ?? null })),
    );
    expect(drawn.some((path) => path.dash !== null)).toBe(name === "none");
    expect(
      doc.querySelector(".priority-bars, .priority-urgent-mark, .priority-none-mark"),
    ).toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
  });
});
