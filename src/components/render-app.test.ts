import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../lib/query";
import { routeTree } from "../routeTree.gen";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

let dom: JSDOM;
let app: RenderedApp | undefined;
const payload = reviewBootstrap([reviewIssue("issue-1", { title: "needle" })]);

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) =>
      Promise.resolve(
        new Response(JSON.stringify(path.includes("background-runs") ? { run: null } : payload), {
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("renderApp", () => {
  it("[代表値] 本番の routeTree と memory history で指定 URL のページを描画する", async () => {
    app = await renderApp({
      url: "/issues",
      container: dom.window.document.getElementById("root")!,
    });
    expect(app.router.routeTree).toBe(routeTree);
    expect(app.router.state.location.pathname).toBe("/issues");
    await vi.waitFor(() => expect(dom.window.document.body.textContent).toContain("needle"));
  });

  it("[代表値] 描画前に queryClient のキャッシュを空にし、unmount 後も空にする", async () => {
    queryClient.setQueryData(["stale-from-previous-test"], "stale");
    app = await renderApp({ url: "/", container: dom.window.document.getElementById("root")! });
    expect(queryClient.getQueryData(["stale-from-previous-test"])).toBeUndefined();
    await app.unmount();
    app = undefined;
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("[代表値] seed は clear の後・描画の前に呼ばれ、仕込んだキャッシュが描画に使われる", async () => {
    const seeded = reviewBootstrap([reviewIssue("issue-9", { title: "seeded-only" })]);
    app = await renderApp({
      url: "/issues",
      container: dom.window.document.getElementById("root")!,
      seed: (client) => client.setQueryData(["bootstrap"], seeded),
    });
    expect(dom.window.document.body.textContent).toContain("seeded-only");
  });

  it("[代表値] root を Outlet に差し替えるので console.error が呼ばれない", async () => {
    const consoleError = vi.spyOn(console, "error");
    app = await renderApp({
      url: "/issues",
      container: dom.window.document.getElementById("root")!,
    });
    await vi.waitFor(() => expect(dom.window.document.body.textContent).toContain("needle"));
    expect(consoleError).not.toHaveBeenCalled();
  });
});
