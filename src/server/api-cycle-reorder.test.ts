import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap, createIssue, reorderIssue } from "./api";
import { getOrbitStore, resetOrbitStores } from "./store";

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function mutation(value: unknown): Request {
  return new Request("http://orbit.local/api/v1/issues/reorder", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(value),
  });
}

function cycle(id: string, number: number, status: "active" | "upcoming") {
  return {
    id,
    userId: "dev-owner",
    number,
    name: `Cycle ${number}`,
    nameOverride: null,
    description: "",
    startsAt: number,
    endsAt: number + 1,
    status,
    completedAt: null,
    scheduleOverridden: false,
  } as const;
}

describe("Cycle scoped reorder HTTP boundary", () => {
  beforeEach(() => resetOrbitStores());

  it("[代表値] Cycle scopeを受け取り、Bootstrap再取得で順序を返す", async () => {
    const store = getOrbitStore("dev-owner");
    store.cycles.set("api-cycle-one", cycle("api-cycle-one", 1, "active"));
    store.cycles.set("api-cycle-two", cycle("api-cycle-two", 2, "upcoming"));
    const todo = store
      .ownedWorkflowStates("dev-owner")
      .find((state) => state.category === "unstarted")!.id;
    const firstResponse = await createIssue(
      new Request("http://orbit.local/api/v1/issues", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          idempotencyKey: "api-cycle-reorder-first",
          title: "Cycle 1 first",
          statusId: todo,
          cycleId: "api-cycle-one",
        }),
      }),
    );
    const outsideResponse = await createIssue(
      new Request("http://orbit.local/api/v1/issues", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          idempotencyKey: "api-cycle-reorder-outside",
          title: "Cycle 2 issue",
          statusId: todo,
          cycleId: "api-cycle-two",
        }),
      }),
    );
    const lastResponse = await createIssue(
      new Request("http://orbit.local/api/v1/issues", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          idempotencyKey: "api-cycle-reorder-last",
          title: "Cycle 1 last",
          statusId: todo,
          cycleId: "api-cycle-one",
        }),
      }),
    );
    const first = (await body<{ issue: { id: string; version: number } }>(firstResponse)).issue;
    const outside = (await body<{ issue: { id: string } }>(outsideResponse)).issue;
    const last = (await body<{ issue: { id: string; version: number } }>(lastResponse)).issue;

    const reordered = await reorderIssue(
      mutation({
        idempotencyKey: "api-cycle-reorder-end",
        issueId: first.id,
        version: first.version,
        beforeIssueId: null,
        cycleId: "api-cycle-one",
      }),
    );
    expect(reordered.status).toBe(200);
    const result = await body<{ issue: { id: string; version: number } }>(reordered);
    expect(result.issue.version).toBeGreaterThan(first.version);

    const reloaded = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    const issues = (await body<{ issues: Array<{ id: string }> }>(reloaded)).issues.map(
      (issue) => issue.id,
    );
    expect(issues.filter((id) => [first.id, outside.id, last.id].includes(id))).toEqual([
      last.id,
      outside.id,
      first.id,
    ]);
  });

  it("[デシジョンテーブル] scope不正とstatusId単独をErrorEnvelopeへ変換する", async () => {
    const store = getOrbitStore("dev-owner");
    store.cycles.set("api-cycle-one", cycle("api-cycle-one", 1, "active"));
    store.cycles.set("api-cycle-two", cycle("api-cycle-two", 2, "upcoming"));
    const issue = store.createIssue("dev-owner", {
      idempotencyKey: "api-cycle-boundary-issue",
      title: "Cycle 1 issue",
      cycleId: "api-cycle-one",
    });
    const status = store.ownedWorkflowStates("dev-owner")[0].id;

    const statusOnly = await reorderIssue(
      mutation({
        idempotencyKey: "api-cycle-boundary-status-only",
        issueId: issue.id,
        version: issue.version,
        beforeIssueId: null,
        statusId: status,
      }),
    );
    expect(statusOnly.status).toBe(400);

    const wrongCycle = await reorderIssue(
      mutation({
        idempotencyKey: "api-cycle-boundary-wrong-cycle",
        issueId: issue.id,
        version: issue.version,
        beforeIssueId: null,
        cycleId: "api-cycle-two",
      }),
    );
    expect(wrongCycle.status).toBe(404);
    expect(store.issues.get(issue.id)).toMatchObject({ cycleId: "api-cycle-one", version: 1 });
  });
});
