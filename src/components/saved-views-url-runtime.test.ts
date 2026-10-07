import { act } from "react";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";
let dom: JSDOM;
let app: RenderedApp | undefined;
const data = reviewBootstrap([reviewIssue("high"), reviewIssue("low", { priority: "low" })]);
data.views = [
  {
    id: "high-view",
    name: "High",
    userId: "owner",
    createdAt: 1,
    updatedAt: 1,
    query: {
      mode: "list",
      filter: { priorities: ["high"] },
      order: "manual",
      layout: {},
      limit: 100,
      showEmptyGroups: false,
    },
    layout: {},
  },
];
beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/views" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  for (const [name, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    scrollTo: vi.fn(),
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(name, value);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(path === "/api/v1/background-runs/current" ? { run: null } : data),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.unstubAllGlobals();
});
async function render(url: string) {
  app = await renderApp({ url, container: dom.window.document.getElementById("root")! });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  return app;
}
describe("Saved View URL", () => {
  it("[URL/再読込] selecting updates the URL and a fresh router restores the filtered workspace", async () => {
    const { router } = await render("/views");
    await act(async () => {
      (dom.window.document.querySelector(".saved-view-select") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(router.state.location.search).toEqual({ view: "high-view" });
    const href = router.state.location.href;
    await app!.unmount();
    app = undefined;
    await render(href);
    expect(dom.window.document.querySelector('[aria-label="HighのIssue"]')?.textContent).toContain(
      "TASK-high",
    );
    expect(
      dom.window.document.querySelector('[aria-label="HighのIssue"]')?.textContent,
    ).not.toContain("TASK-low");
  });
});
