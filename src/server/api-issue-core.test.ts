import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveIssue,
  bootstrap,
  createIssue,
  getIssue,
  listIssues,
  listRecent,
  recordRecentIssueView,
  recordRecentSearch,
  restoreIssue,
  searchIssues,
  trashIssue,
} from "./api";
import { resetOrbitStores } from "./store";

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function mutation(url: string, method: string, value: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(value),
  });
}

describe("Phase 2 Issue core HTTP service", () => {
  beforeEach(() => resetOrbitStores());

  it("[代表値] Issue detail APIはparent / children / childProgressを返す", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const states = (
      await body<{ workflowStates: Array<{ id: string; category: string }> }>(initial)
    ).workflowStates;
    const completed = states.find((state) => state.category === "completed")!.id;
    const parentResponse = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-phase2-parent",
        title: "API parent",
      }),
    );
    const parent = (await body<{ issue: { id: string } }>(parentResponse)).issue;
    await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-phase2-child",
        title: "API child",
        parentId: parent.id,
        statusId: completed,
      }),
    );

    const response = await getIssue(
      new Request(`http://orbit.local/api/v1/issues/${parent.id}`),
      parent.id,
    );
    expect(response.status).toBe(200);
    expect(
      await body<{ children: Array<{ title: string }>; childProgress: { completed: number } }>(
        response,
      ),
    ).toMatchObject({
      children: [{ title: "API child" }],
      childProgress: { total: 1, completed: 1, progressPercent: 100 },
    });
  });

  it("[デシジョンテーブル] Issue scopeのactive / archived / trashを分離する", async () => {
    const ids: Record<string, string> = {};
    for (const [key, title] of Object.entries({
      active: "active",
      archived: "archived",
      trash: "trash",
    })) {
      const response = await createIssue(
        mutation("http://orbit.local/api/v1/issues", "POST", {
          idempotencyKey: `api-phase2-scope-${key}`,
          title,
        }),
      );
      ids[key] = (await body<{ issue: { id: string } }>(response)).issue.id;
    }
    await archiveIssue(
      new Request(`http://orbit.local/api/v1/issues/${ids.archived}`, {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest", "Idempotency-Key": "api-phase2-archive" },
      }),
      ids.archived,
    );
    await trashIssue(
      new Request(`http://orbit.local/api/v1/issues/${ids.trash}`, {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest", "Idempotency-Key": "api-phase2-trash" },
      }),
      ids.trash,
    );

    const archived = await listIssues(
      new Request("http://orbit.local/api/v1/issues?scope=archived"),
    );
    const trash = await listIssues(new Request("http://orbit.local/api/v1/issues?scope=trash"));
    expect(
      (await body<{ items: Array<{ id: string }> }>(archived)).items.map((item) => item.id),
    ).toEqual([ids.archived]);
    expect(
      (await body<{ items: Array<{ id: string }> }>(trash)).items.map((item) => item.id),
    ).toEqual([ids.trash]);
    const active = await listIssues(new Request("http://orbit.local/api/v1/issues?scope=active"));
    const activeIds = (await body<{ items: Array<{ id: string }> }>(active)).items.map(
      (item) => item.id,
    );
    expect(activeIds).toContain(ids.active);
    expect(activeIds).not.toContain(ids.archived);
    expect(activeIds).not.toContain(ids.trash);
  });

  it("[代表値] Search APIはqと属性Filterを組み合わせる", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const states = (
      await body<{ workflowStates: Array<{ id: string; category: string }> }>(initial)
    ).workflowStates;
    const started = states.find((state) => state.category === "started")!.id;
    await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-phase2-search-match",
        title: "検索対象 auth",
        statusId: started,
        priority: "high",
      }),
    );
    await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-phase2-search-other-priority",
        title: "検索対象 auth low",
        priority: "low",
      }),
    );

    const response = await searchIssues(
      new Request("http://orbit.local/api/v1/search?q=auth&priority=high&status=" + started),
    );
    expect(response.status).toBe(200);
    expect(
      (await body<{ items: Array<{ title: string }> }>(response)).items.map((item) => item.title),
    ).toEqual(["検索対象 auth"]);
  });

  it("[状態遷移] Recent APIはIssue viewとSearchを再読込可能にする", async () => {
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-phase2-recent-issue",
        title: "Recent対象",
      }),
    );
    const issueId = (await body<{ issue: { id: string } }>(created)).issue.id;
    const view = await recordRecentIssueView(
      mutation("http://orbit.local/api/v1/recent-issue-views", "POST", {
        idempotencyKey: "api-phase2-recent-view",
        issueId,
      }),
    );
    expect(view.status).toBe(200);
    const search = await recordRecentSearch(
      mutation("http://orbit.local/api/v1/recent-searches", "POST", {
        idempotencyKey: "api-phase2-recent-search",
        query: { text: "recent", filter: {} },
      }),
    );
    expect(search.status).toBe(200);

    const response = await listRecent(new Request("http://orbit.local/api/v1/recent"));
    expect(response.status).toBe(200);
    expect(
      await body<{
        issueViews: Array<{ issue: { id: string } }>;
        searches: Array<{ query: { text: string } }>;
      }>(response),
    ).toMatchObject({
      issueViews: [{ issue: { id: issueId } }],
      searches: [{ query: { text: "recent" } }],
    });
  });

  it("[境界値] Search queryの空文字は400でStoreへ到達しない", async () => {
    const response = await searchIssues(new Request("http://orbit.local/api/v1/search?q=%20%20"));
    expect(response.status).toBe(400);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("[状態遷移] Archived IssueをRestoreするとactive scopeへ戻る", async () => {
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "api-phase2-restore",
        title: "Restore対象",
      }),
    );
    const issueId = (await body<{ issue: { id: string } }>(created)).issue.id;
    await trashIssue(
      new Request(`http://orbit.local/api/v1/issues/${issueId}`, {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "api-phase2-trash-restore",
        },
      }),
      issueId,
    );
    const restored = await restoreIssue(
      new Request(`http://orbit.local/api/v1/issues/${issueId}`, {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": "api-phase2-restore-action",
        },
      }),
      issueId,
    );
    expect(restored.status).toBe(200);
    const active = await listIssues(new Request("http://orbit.local/api/v1/issues?scope=active"));
    expect(
      (await body<{ items: Array<{ id: string }> }>(active)).items.map((item) => item.id),
    ).toContain(issueId);
  });
});
