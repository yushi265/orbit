import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  closeCycle,
  createIssue,
  createProject,
  getIssue,
  listIssues,
  postIssueAction,
  searchIssues,
  archiveProject,
} from "./api";
import { parseBody } from "./http";
import { resetOrbitStores } from "./store";

type ErrorBody = {
  error: { code: string; message: string; fieldErrors?: Record<string, string[]> };
};
type IssueBody = {
  issue: { id: string; version: number; archivedAt: number | null; deletedAt: number | null };
};

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

function post(url: string, key?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(key === undefined ? {} : { "Idempotency-Key": key }),
    },
  });
}

async function newIssue(key: string): Promise<IssueBody["issue"]> {
  const response = await createIssue(
    mutation("http://orbit.local/api/v1/issues", "POST", { idempotencyKey: key, title: key }),
  );
  return (await body<IssueBody>(response)).issue;
}

async function readIssue(id: string): Promise<IssueBody["issue"]> {
  return (
    await body<IssueBody>(await getIssue(new Request(`http://orbit.local/api/v1/issues/${id}`), id))
  ).issue;
}

async function expectValidationError(response: Response, field: string): Promise<void> {
  expect(response.status).toBe(400);
  const error = (await body<ErrorBody>(response)).error;
  expect(error.code).toBe("VALIDATION_ERROR");
  expect(error.fieldErrors?.[field]?.length).toBeGreaterThan(0);
}

// ストリームとして送り、content-length ヘッダーを付けない（chunked 相当）。
function streamedJson(bytes: number, contentLength?: number): Request {
  const prefix = '{"title":"';
  const suffix = '"}';
  const text = `${prefix}${"a".repeat(bytes - prefix.length - suffix.length)}${suffix}`;
  const encoded = new TextEncoder().encode(text);
  expect(encoded.byteLength).toBe(bytes);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.byteLength; offset += 64 * 1024)
        controller.enqueue(encoded.slice(offset, offset + 64 * 1024));
      controller.close();
    },
  });
  return new Request("http://orbit.local/api/v1/issues", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
    },
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("API境界の入力検証", () => {
  beforeEach(() => resetOrbitStores());

  describe("AC-1 Issue action", () => {
    it.each([
      ["archive", (issue: IssueBody["issue"]) => expect(issue.archivedAt).not.toBeNull()],
      ["trash", (issue: IssueBody["issue"]) => expect(issue.deletedAt).not.toBeNull()],
    ] as const)("[同値分割] action=%s は対応する処理を行う", async (action, assert) => {
      const issue = await newIssue(`ac1-${action}`);
      const response = await postIssueAction(
        post(`http://orbit.local/api/v1/issues/${issue.id}?action=${action}`, `ac1-${action}-key`),
        issue.id,
      );
      expect(response.status).toBe(200);
      assert((await body<IssueBody>(response)).issue);
    });

    it("[同値分割] action=restore はアーカイブを戻す", async () => {
      const issue = await newIssue("ac1-restore");
      await postIssueAction(
        post(`http://orbit.local/api/v1/issues/${issue.id}?action=archive`, "ac1-restore-a"),
        issue.id,
      );
      const response = await postIssueAction(
        post(`http://orbit.local/api/v1/issues/${issue.id}?action=restore`, "ac1-restore-r"),
        issue.id,
      );
      expect(response.status).toBe(200);
      expect((await body<IssueBody>(response)).issue.archivedAt).toBeNull();
    });

    it.each([
      ["未知の値", "?action=delete"],
      ["大文字", "?action=ARCHIVE"],
      ["空文字", "?action="],
      ["未指定", ""],
    ])("[境界値] action が%sなら400でIssueを変更しない", async (_label, query) => {
      const issue = await newIssue(`ac1-bad-${query}`);
      const response = await postIssueAction(
        post(`http://orbit.local/api/v1/issues/${issue.id}${query}`, `ac1-bad-key-${query}`),
        issue.id,
      );
      await expectValidationError(response, "action");
      expect(await readIssue(issue.id)).toMatchObject({
        version: issue.version,
        archivedAt: null,
        deletedAt: null,
      });
    });
  });

  describe("AC-2 Idempotency-Key 必須", () => {
    // state() は対象の観測可能な状態。キー無しの 400 では呼び出し前後で変わらないことを確かめる。
    type Target = {
      name: string;
      call: (key?: string) => Promise<Response>;
      state: () => Promise<unknown>;
    };
    async function targets(): Promise<Target[]> {
      const issue = await newIssue("ac2-issue");
      const projectResponse = await createProject(
        mutation("http://orbit.local/api/v1/projects", "POST", {
          idempotencyKey: "ac2-project",
          name: "AC2 project",
        }),
      );
      const project = (await body<{ project: { id: string } }>(projectResponse)).project;
      const readBootstrap = async () =>
        body<{
          cycles: Array<{ id: string; status: string; version: number }>;
          projects: Array<{ id: string; archivedAt: number | null; version: number }>;
        }>(await bootstrap(new Request("http://orbit.local/api/v1/bootstrap")));
      const active = (await readBootstrap()).cycles.find((cycle) => cycle.status === "active")!;
      const issueUrl = (action: string) =>
        `http://orbit.local/api/v1/issues/${issue.id}?action=${action}`;
      const issueState = () => readIssue(issue.id);
      return [
        {
          name: "archive",
          call: (key) => postIssueAction(post(issueUrl("archive"), key), issue.id),
          state: issueState,
        },
        {
          name: "restore",
          call: (key) => postIssueAction(post(issueUrl("restore"), key), issue.id),
          state: issueState,
        },
        {
          name: "trash",
          call: (key) => postIssueAction(post(issueUrl("trash"), key), issue.id),
          state: issueState,
        },
        {
          name: "project archive",
          call: (key) =>
            archiveProject(
              post(`http://orbit.local/api/v1/projects/${project.id}`, key),
              project.id,
            ),
          state: async () =>
            (await readBootstrap()).projects.find((item) => item.id === project.id),
        },
        {
          name: "cycle close",
          call: (key) =>
            closeCycle(post(`http://orbit.local/api/v1/cycles/${active.id}`, key), active.id),
          state: async () => (await readBootstrap()).cycles.find((item) => item.id === active.id),
        },
      ];
    }

    it.each(["archive", "restore", "trash", "project archive", "cycle close"])(
      "[デシジョンテーブル] %s はキー無しなら400で対象を変更しない",
      async (name) => {
        const target = (await targets()).find((item) => item.name === name)!;
        const before = await target.state();
        await expectValidationError(await target.call(undefined), "idempotencyKey");
        expect(await target.state()).toEqual(before);
      },
    );

    it.each(["project archive", "cycle close"])(
      "[状態遷移] %s はキーありで処理され、同じキーの再送は同じ結果に収束する",
      async (name) => {
        const target = (await targets()).find((item) => item.name === name)!;
        const before = await target.state();
        const first = await target.call(`ac2-${name}-key`);
        expect(first.status).toBe(200);
        const after = await target.state();
        expect(after).not.toEqual(before);
        const replay = await target.call(`ac2-${name}-key`);
        expect(replay.status).toBe(200);
        expect(await replay.json()).toEqual(await first.json());
        expect(await target.state()).toEqual(after);
      },
    );

    it("[境界値] キーが空文字なら400で対象を変更しない", async () => {
      const issue = await newIssue("ac2-empty");
      const response = await postIssueAction(
        post(`http://orbit.local/api/v1/issues/${issue.id}?action=archive`, ""),
        issue.id,
      );
      await expectValidationError(response, "idempotencyKey");
      expect((await readIssue(issue.id)).archivedAt).toBeNull();
    });

    it("[状態遷移] キーありは処理され、同じキーの再送は同じ結果に収束する", async () => {
      const issue = await newIssue("ac2-replay");
      const send = () =>
        postIssueAction(
          post(`http://orbit.local/api/v1/issues/${issue.id}?action=archive`, "ac2-replay-key"),
          issue.id,
        );
      const first = await send();
      const replay = await send();
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      const firstIssue = (await body<IssueBody>(first)).issue;
      expect((await body<IssueBody>(replay)).issue).toMatchObject({
        version: firstIssue.version,
        archivedAt: firstIssue.archivedAt,
      });
    });
  });

  describe("AC-3 Issue一覧クエリ", () => {
    const list = (query: string) =>
      listIssues(new Request(`http://orbit.local/api/v1/issues?${query}`));

    it.each(["none", "overdue", "today", "upcoming", "next7"])(
      "[同値分割] due=%s は受け付ける",
      async (due) => {
        expect((await list(`due=${due}`)).status).toBe(200);
      },
    );

    it.each(["manual", "priority", "updated", "created", "due_at", "estimate"])(
      "[同値分割] order=%s は受け付ける",
      async (order) => {
        expect((await list(`order=${order}`)).status).toBe(200);
      },
    );

    it.each([
      ["due", "due=later"],
      ["order", "order=random"],
      ["limit", "limit=0"],
      ["limit", "limit=501"],
      ["limit", "limit=1.5"],
      ["limit", "limit=abc"],
    ])("[境界値] 不正な %s（%s）は400", async (field, query) => {
      await expectValidationError(await list(query), field);
    });

    it("[境界値] limit=1 / 500 と既定値（limit 100・manual）は件数と順序が期待どおり", async () => {
      for (let index = 0; index < 101; index += 1) await newIssue(`ac3-limit-${index}`);
      const ids = async (query: string) => {
        const response = await list(query);
        expect(response.status).toBe(200);
        return (await body<{ items: Array<{ id: string }> }>(response)).items.map(
          (item) => item.id,
        );
      };
      expect(await ids("limit=1")).toHaveLength(1);
      // seed の Issue を含めて 100 件を超える状態で、limit=500 は全件・既定は 100 件で切る。
      const all = await ids("limit=500");
      expect(all.length).toBeGreaterThan(100);
      const manual = await ids("order=manual&limit=100");
      expect(manual).toHaveLength(100);
      // 未指定・空文字は limit 100・order manual と同じ結果になる。
      expect(await ids("")).toEqual(manual);
      expect(await ids("due=&order=&limit=")).toEqual(manual);
    });

    it("[代表値] search も due の不正値を400にする", async () => {
      const response = await searchIssues(
        new Request("http://orbit.local/api/v1/search?q=a&due=later"),
      );
      await expectValidationError(response, "due");
    });
  });

  describe("AC-4 Body サイズ上限", () => {
    it("[境界値] ちょうど1,000,000バイトは受け付ける（content-lengthなし）", async () => {
      const parsed = await parseBody(streamedJson(1_000_000));
      expect(typeof parsed.title).toBe("string");
    });

    it("[境界値] 1,000,001バイトは400（content-lengthなし）", async () => {
      await expect(parseBody(streamedJson(1_000_001))).rejects.toMatchObject({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "リクエストが大きすぎます。",
      });
    });

    it("[境界値] content-lengthを小さく偽装しても実バイト数で400", async () => {
      await expect(parseBody(streamedJson(1_000_001, 10))).rejects.toMatchObject({
        message: "リクエストが大きすぎます。",
      });
    });

    it("[代表値] content-lengthが上限超過なら本文を読まずに400", async () => {
      const request = new Request("http://orbit.local/api/v1/issues", {
        method: "POST",
        headers: { "content-length": "1000001" },
        body: "{}",
      });
      await expect(parseBody(request)).rejects.toMatchObject({
        message: "リクエストが大きすぎます。",
      });
      expect(request.bodyUsed).toBe(false);
    });

    it("[代表値] Issue作成APIは超過Bodyを400にしIssueを増やさない", async () => {
      const before = (await body<{ items: unknown[] }>(await list())).items.length;
      const response = await createIssue(streamedJson(1_000_001));
      expect(response.status).toBe(400);
      expect((await body<ErrorBody>(response)).error.message).toBe("リクエストが大きすぎます。");
      expect((await body<{ items: unknown[] }>(await list())).items.length).toBe(before);

      function list() {
        return listIssues(new Request("http://orbit.local/api/v1/issues"));
      }
    });
  });
});
