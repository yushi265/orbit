import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrbitSelect } from "./orbit-select";
import { SearchView } from "./OrbitApp";
import { reviewBootstrap } from "./review-ui.test-fixtures";

describe("OrbitSelect", () => {
  let dom: JSDOM;
  let root: Root;
  const options = Array.from({ length: 20 }, (_, index) => ({
    value: String(index),
    label: `Long Project name ${index}`,
  }));
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dom = new JSDOM(
      "<div id='root' style='overflow:hidden'></div><button id='outside'>Next</button>",
    );
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(dom.window, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(dom.window, "innerHeight", { value: 600, configurable: true });
    root = createRoot(dom.window.document.getElementById("root")!);
    onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(OrbitSelect, {
          label: "検索Project",
          value: "2",
          options,
          onChange,
        }),
      ),
    );
    vi.spyOn(trigger(), "getBoundingClientRect").mockReturnValue({
      x: 280,
      y: 510,
      left: 280,
      top: 510,
      right: 380,
      bottom: 554,
      width: 100,
      height: 44,
      toJSON: () => ({}),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
  });

  function trigger() {
    return dom.window.document.querySelector('[aria-label="検索Project"]') as HTMLButtonElement;
  }
  function listbox() {
    return dom.window.document.querySelector('[role="listbox"]') as HTMLElement | null;
  }
  async function key(value: string) {
    const event = new dom.window.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => trigger().dispatchEvent(event));
    return event;
  }

  it("[境界値] renders selectable candidates outside clipped content and inside a 390px viewport", async () => {
    await act(async () => trigger().click());
    const menu = listbox()!;
    expect(menu.parentElement).toBe(dom.window.document.body);
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(20);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(
      Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width),
    ).toBeLessThanOrEqual(382);
    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(510);
    expect(
      Number.parseFloat(menu.style.top) + Number.parseFloat(menu.style.maxHeight),
    ).toBeLessThanOrEqual(592);
    await act(async () => menu.querySelector<HTMLButtonElement>('[data-value="4"]')!.click());
    expect(onChange).toHaveBeenCalledWith("4");
    expect(listbox()).toBeNull();
    expect(dom.window.document.activeElement).toBe(trigger());
  });

  it("[境界値] opens below an upper trigger and repositions after viewport resize", async () => {
    vi.mocked(trigger().getBoundingClientRect).mockReturnValue({
      x: 16,
      y: 16,
      left: 16,
      top: 16,
      right: 170,
      bottom: 60,
      width: 154,
      height: 44,
      toJSON: () => ({}),
    });
    await act(async () => trigger().click());
    expect(Number.parseFloat(listbox()!.style.top)).toBe(66);
    Object.defineProperty(dom.window, "innerWidth", { value: 240, configurable: true });
    Object.defineProperty(dom.window, "innerHeight", { value: 220, configurable: true });
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("resize")));
    const menu = listbox()!;
    expect(
      Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width),
    ).toBeLessThanOrEqual(232);
    expect(
      Number.parseFloat(menu.style.top) + Number.parseFloat(menu.style.maxHeight),
    ).toBeLessThanOrEqual(212);
    const activeId = trigger().getAttribute("aria-activedescendant")!;
    expect(dom.window.document.getElementById(activeId)?.getAttribute("role")).toBe("option");
  });

  it("[状態遷移] supports arrows, Home, End and Enter while restoring trigger focus", async () => {
    trigger().focus();
    await key("ArrowDown");
    await key("ArrowDown");
    await key("Enter");
    expect(onChange).toHaveBeenLastCalledWith("3");
    expect(listbox()).toBeNull();
    await key("ArrowUp");
    await key("Home");
    await key("ArrowUp");
    await key("Enter");
    expect(onChange).toHaveBeenLastCalledWith("19");
    await key("ArrowDown");
    await key("End");
    await key("ArrowDown");
    await key("Enter");
    expect(onChange).toHaveBeenLastCalledWith("0");
    expect(dom.window.document.activeElement).toBe(trigger());
  });

  it("[状態遷移] dismisses on Escape, Tab and outside pointer without committing a value", async () => {
    trigger().focus();
    await key("ArrowDown");
    await key("Escape");
    expect(listbox()).toBeNull();
    expect(dom.window.document.activeElement).toBe(trigger());
    await key("ArrowDown");
    expect((await key("Tab")).defaultPrevented).toBe(false);
    expect(listbox()).toBeNull();
    await act(async () => trigger().click());
    await act(async () =>
      dom.window.document
        .getElementById("outside")!
        .dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })),
    );
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("[状態遷移] all six Search menus preserve their filter value callbacks", async () => {
    Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
      value: () => undefined,
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
      value: () => undefined,
    });
    const data = reviewBootstrap();
    const filters = {
      statusId: "all",
      priority: "all" as const,
      projectId: "all",
      cycleId: "all",
      labelId: "all",
      due: "all" as const,
    };
    const setFilters = vi.fn();
    await act(async () =>
      root.render(
        createElement(SearchView, {
          query: "",
          onQuery: vi.fn(),
          results: [],
          onOpen: vi.fn(),
          onOpenIssueId: vi.fn(),
          searchBusy: false,
          searchError: null,
          onRetry: vi.fn(),
          workflowStates: data.workflowStates,
          projects: data.projects,
          labels: data.labels,
          cycles: [
            {
              id: "cycle-1",
              userId: "owner",
              number: 1,
              name: "Cycle 1",
              nameOverride: "Named Cycle",
              description: "",
              startsAt: 0,
              endsAt: 1,
              status: "active",
              completedAt: null,
              scheduleOverridden: false,
            },
          ],
          filters,
          setFilters,
          recentIssueViews: [],
          recentSearches: [],
          modifierLabel: "Ctrl",
        }),
      ),
    );
    expect(dom.window.document.querySelector(".search-filters select")).toBeNull();
    for (const [label, property, value] of [
      ["検索Status", "statusId", "todo"],
      ["検索Priority", "priority", "high"],
      ["検索Project", "projectId", "project-1"],
      ["検索Cycle", "cycleId", "cycle-1"],
      ["検索Label", "labelId", "label-1"],
      ["検索Due", "due", "today"],
    ]) {
      const button = dom.window.document.querySelector(
        `[aria-label="${label}"]`,
      ) as HTMLButtonElement;
      await act(async () => button.click());
      expect(listbox()).not.toBeNull();
      const option = listbox()!.querySelector(`[data-value="${value}"]`) as HTMLButtonElement;
      await act(async () => option.click());
      expect(setFilters).toHaveBeenLastCalledWith({ ...filters, [property]: value });
      expect(dom.window.document.activeElement).toBe(button);
    }
  });
});
