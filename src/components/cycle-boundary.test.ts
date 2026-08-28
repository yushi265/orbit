import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CyclesView } from "./OrbitApp";

const cycles = [
  {
    id: "cycle-upcoming",
    userId: "owner",
    number: 2,
    name: "Cycle 2",
    nameOverride: null,
    description: "Cooldown後",
    startsAt: Date.parse("2026-09-07T00:00:00.000Z"),
    endsAt: Date.parse("2026-09-21T00:00:00.000Z"),
    status: "upcoming" as const,
    completedAt: null,
    scheduleOverridden: false,
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("Cycle boundary UI", () => {
  it("[状態遷移] CurrentにActiveがない場合は次回開始時刻とUpcoming導線を表示する", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(
        createElement(CyclesView, {
          cycles,
          issues: [],
          workflowStates: [],
          pendingIssueId: null,
          onUpdateIssue: () => undefined,
          onRefresh: () => undefined,
          onNavigateIssues: () => undefined,
          onNavigateCycles: () => undefined,
          closeBusy: false,
          startBusy: false,
          onClose: () => undefined,
          onStart: async () => false,
        }),
      );
    });

    expect(dom.window.document.body.textContent).toContain("Active Cycleはありません");
    expect(dom.window.document.body.textContent).toContain("次回開始");
    expect(dom.window.document.body.textContent).toContain("Cooldown");
    expect(
      [...dom.window.document.querySelectorAll("button")].some(
        (button) => button.textContent === "Upcomingを確認",
      ),
    ).toBe(true);

    await act(async () => {
      [...dom.window.document.querySelectorAll("button")]
        .find((button) => button.textContent === "Upcomingを確認")
        ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(dom.window.document.body.textContent).toContain("UPCOMING CYCLE");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
