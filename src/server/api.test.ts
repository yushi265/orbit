import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  continueBackgroundRun,
  createIssue,
  startBackgroundRun,
  updateIssue,
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

describe("HTTP service boundary", () => {
  beforeEach(() => resetOrbitStores());

  it("[代表値] dev ownerのbootstrapとIssue createがJSON契約を返す", async () => {
    const initial = await bootstrap(new Request("http://orbit.local/api/v1/bootstrap"));
    expect(initial.status).toBe(200);
    const initialBody = await body<{ me: { id: string } }>(initial);
    expect(initialBody.me.id).toBe("dev-owner");

    const response = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-create-01",
        title: "HTTP経由のIssue",
      }),
    );
    expect(response.status).toBe(201);
    expect((await body<{ issue: { identifier: string } }>(response)).issue.identifier).toMatch(
      /^TASK-\d+$/,
    );
  });

  it("[契約] Issue version不一致は409 ErrorEnvelopeを返す", async () => {
    const created = await createIssue(
      mutation("http://orbit.local/api/v1/issues", "POST", {
        idempotencyKey: "http-create-02",
        title: "競合対象",
      }),
    );
    const issue = (await body<{ issue: { id: string } }>(created)).issue;
    const response = await updateIssue(
      mutation("http://orbit.local/api/v1/issues", "PATCH", {
        idempotencyKey: "http-update-01",
        version: 999,
        patch: { title: "古い更新" },
      }),
      issue.id,
    );
    expect(response.status).toBe(409);
    expect(
      (await body<{ error: { code: string; requestId: string } }>(response)).error,
    ).toMatchObject({ code: "ISSUE_VERSION_CONFLICT" });
  });

  it("[セキュリティ境界] Mutationは同一Originヘッダーなしで拒否する", async () => {
    const response = await createIssue(
      new Request("http://orbit.local/api/v1/issues", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "blocked-01", title: "拒否" }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("[状態遷移] Background RunをAPIで起動し、同じrunをchunk継続できる", async () => {
    const started = await startBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        kind: "maintenance",
        idempotencyKey: "http-run-001",
      }),
    );
    expect(started.status).toBe(202);
    const run = (
      await body<{ run: { run_id: string; progress: { cursor: string | null } } }>(started)
    ).run;
    const continued = await continueBackgroundRun(
      mutation("http://orbit.local/api/v1/background-runs", "POST", {
        idempotencyKey: "http-continue-01",
        expected_cursor: run.progress.cursor,
      }),
      run.run_id,
    );
    expect(continued.status).toBe(200);
    expect(
      (await body<{ run: { progress: { step_index: number } } }>(continued)).run.progress
        .step_index,
    ).toBe(1);
  });
});
