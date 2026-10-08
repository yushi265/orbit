import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reviewBootstrap,
  reviewDetail,
  reviewIssue,
} from "../../components/review-ui.test-fixtures";
import { queryKeys } from "../../lib/queries/keys";
import { useIssueActions } from "./issue-actions";

// REFACTOR-ui-architecture Phase 3b-1a: OrbitAppInner から切り出した Issue 系の操作。
// 楽観更新・undo・409 の再取得などの詳細は既存の結合テスト（OrbitApp 描画）が担保する。

let dom: JSDOM;
let root: Root;
let client: QueryClient;
let latest: ReturnType<typeof useIssueActions>;
const showToast = vi.fn();
const dismissToast = vi.fn();
const refresh = vi.fn(() => Promise.resolve());
const issue = reviewIssue("issue-1");

function Probe() {
  latest = useIssueActions({ showToast, dismissToast, refresh });
  return null;
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

beforeEach(async () => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  showToast.mockReset();
  dismissToast.mockReset();
  refresh.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.bootstrap, reviewBootstrap([issue]));
  client.setQueryData(queryKeys.issueDetail("issue-1"), reviewDetail(issue));
  root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe))),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

describe("useIssueActions", () => {
  it("[状態遷移] updateIssue: 送信中は pendingIssueId が対象 ID、成功でキャッシュへ反映し undo 付きの Toast を出して null に戻る", async () => {
    let resolvePatch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => latest.updateIssue.mutate({ issue, patch: { title: "updated" } }));
    expect(latest.pendingIssueId).toBe("issue-1");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/v1/issues/issue-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      version: 1,
      patch: { title: "updated" },
    });
    const updated = { ...issue, title: "updated", version: 2 };
    await act(async () => resolvePatch(json({ issue: updated })));
    await vi.waitFor(() => expect(latest.pendingIssueId).toBeNull());
    expect(
      client.getQueryData<ReturnType<typeof reviewBootstrap>>(queryKeys.bootstrap)?.issues[0],
    ).toEqual(updated);
    expect(showToast).toHaveBeenCalledWith(
      "success",
      "変更を保存しました",
      expect.objectContaining({ label: "元に戻す" }),
    );
  });

  it("[代表値] reorderIssue: 成功で全体を再取得し、順序保存の Toast を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ issue }))),
    );
    await act(async () =>
      latest.reorderIssue.mutate({ issue, beforeIssueId: null, idempotencyKey: "key-1" }),
    );
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("success", "TASK-issue-1 の順序を保存しました"),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["archive", "TASK-issue-1をアーカイブしました"],
    ["restore", "TASK-issue-1を復元しました"],
    ["trash", "TASK-issue-1をゴミ箱へ移動しました"],
  ] as const)(
    "[同値分割] changeIssueLifecycle(%s) → API を呼び、再取得して「%s」",
    async (action, message) => {
      const fetchMock = vi.fn(() => Promise.resolve(json({ ok: true })));
      vi.stubGlobal("fetch", fetchMock);
      const invalidate = vi.spyOn(client, "invalidateQueries");
      await act(async () => latest.changeIssueLifecycle(issue, action));
      expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
        `/api/v1/issues/issue-1?action=${action}`,
      );
      expect(refresh).toHaveBeenCalledOnce();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["issues"] });
      expect(showToast).toHaveBeenCalledWith("success", message);
    },
  );
});
