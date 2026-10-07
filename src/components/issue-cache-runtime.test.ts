import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../lib/query";
import type { IssueViewModel as Issue } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

// REFACTOR-ui-architecture AC-6: 一覧のインライン更新も詳細保存と同じく 3 scope を同期する。

let dom: JSDOM;
let app: RenderedApp | undefined;
const target = reviewIssue("issue-1");
const activeOther = reviewIssue("issue-2");
const archivedOther = reviewIssue("issue-3", { archivedAt: 50 });

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/issues" });
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
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.unstubAllGlobals();
});

describe("Issue cache sync from the list (AC-6)", () => {
  it("[代表値] 一覧のインライン更新でアーカイブ済みになった Issue は archived に入り、active と bootstrap から消える", async () => {
    // 別端末でアーカイブされた直後に一覧で Priority を変えた場合、更新結果の archivedAt が値を持つ。
    const updated: Issue = { ...target, priority: "high", archivedAt: 100, version: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        if (path === "/api/v1/issues/issue-1" && method === "PATCH")
          return json({ issue: updated });
        if (path.startsWith("/api/v1/background-runs")) return json({ run: null });
        if (path === "/api/v1/bootstrap") return json(reviewBootstrap([target, activeOther]));
        return json({});
      }),
    );
    app = await renderApp({
      url: "/issues",
      container: dom.window.document.getElementById("root")!,
      seed: (client) => {
        client.setQueryData(["bootstrap"], reviewBootstrap([target, activeOther]));
        client.setQueryData(["issues", "active"], { items: [target, activeOther] });
        client.setQueryData(["issues", "archived"], { items: [archivedOther] });
      },
    });
    const select = dom.window.document.querySelector(
      'select[aria-label="TASK-issue-1のPriority"]',
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = "high";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/issues/issue-1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    await vi.waitFor(() =>
      expect(
        queryClient
          .getQueryData<{ items: Issue[] }>(["issues", "archived"])
          ?.items.map((item) => item.id),
      ).toEqual(["issue-3", "issue-1"]),
    );
    expect(
      queryClient
        .getQueryData<{ items: Issue[] }>(["issues", "active"])
        ?.items.map((item) => item.id),
    ).toEqual(["issue-2"]);
    expect(
      queryClient
        .getQueryData<ReturnType<typeof reviewBootstrap>>(["bootstrap"])
        ?.issues.map((item) => item.id),
    ).toEqual(["issue-2"]);
  });
});
