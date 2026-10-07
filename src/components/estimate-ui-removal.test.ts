import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../lib/query";
import { OrbitApp } from "./OrbitApp";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

let dom: JSDOM;
let root: Root;

// 旧Estimate導線: Scope points / Estimate入力 / Estimate設定 / Estimateソート / 合計表示。
const ESTIMATE_UI = /estimate|scope points/i;

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
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
  queryClient.clear();
  // estimateEnabled: true / estimate付きIssueでも、UIにはEstimate導線が出ない。
  const issue = reviewIssue("issue-1", { estimate: 5 });
  const boot = reviewBootstrap([issue]);
  queryClient.setQueryData(["bootstrap"], boot);
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      if (path === "/api/v1/bootstrap") return Promise.resolve(json(boot));
      if (path === "/api/v1/background-runs/current") return Promise.resolve(json({ run: null }));
      if (path === "/api/v1/issues/issue-1") return Promise.resolve(json(reviewDetail(issue)));
      return Promise.resolve(json({}));
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// 表示テキスト・aria-label・title・placeholder・option文言を集める。
function visibleLabels(): string[] {
  const document = dom.window.document;
  const labels = [document.body.textContent ?? ""];
  for (const element of document.querySelectorAll("*")) {
    for (const name of ["aria-label", "title", "placeholder", "value"]) {
      const value = element.getAttribute(name);
      if (value) labels.push(value);
    }
  }
  return labels;
}

async function renderApp(props: Record<string, unknown>) {
  await act(async () => root.render(createElement(OrbitApp, props as never)));
  await act(async () => vi.advanceTimersByTimeAsync(0));
}

describe("Estimate UI removal contract", () => {
  it.each([
    ["Settings", { initialSection: "settings" }],
    ["Issue一覧", { initialSection: "issues" }],
    ["Issue詳細", { initialSection: "issues", issueId: "issue-1" }],
    ["Cycle", { initialSection: "cycles" }],
    ["Home", { initialSection: "home" }],
  ])("[代表値] 現行UI(%s)にEstimateとScope pointsの導線を出さない", async (_name, props) => {
    await renderApp(props);

    expect(dom.window.document.querySelector("#root")?.children.length).toBeGreaterThan(0);
    expect(visibleLabels().filter((label) => ESTIMATE_UI.test(label))).toEqual([]);
  });

  it("[代表値] 新規Issue ComposerにEstimate入力を出さない", async () => {
    await renderApp({ initialSection: "issues" });
    const create = [...dom.window.document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("新しいIssue"),
    ) as HTMLButtonElement;
    await act(async () => create.click());

    expect(
      dom.window.document.querySelector('[aria-label="新しいIssueのタイトル"]'),
    ).not.toBeNull();
    expect(visibleLabels().filter((label) => ESTIMATE_UI.test(label))).toEqual([]);
  });
});
