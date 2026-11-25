import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap, listProjects, postProjectAction } from "./api";
import type { Project } from "./model";
import { getOrbitStore, OrbitStore, resetOrbitStores } from "./store";

const OWNER = "archive-owner";
const OTHER = "archive-other";
const T0 = 1_800_000_000_000;

function setup() {
  let now = T0;
  const store = new OrbitStore(() => now);
  store.ensureOwner(OWNER, "o@example.com");
  store.ensureOwner(OTHER, "x@example.com");
  const tick = () => (now += 1000);
  const a = store.createProject(OWNER, { idempotencyKey: "create-a", name: "A" });
  tick();
  const b = store.createProject(OWNER, { idempotencyKey: "create-b", name: "B" });
  tick();
  return { store, tick, a, b, now: () => now };
}

function counts(store: OrbitStore) {
  return {
    activities: store.activities.length,
    outbox: store.outbox.length,
    receipts: store.receipts.size,
  };
}

describe("Projectの復元（restore）", () => {
  it("[状態遷移] アーカイブ済み → restore: archivedAtがnullに戻り、positionは変わらない", () => {
    const { store, tick, a } = setup();
    store.archiveProject(OWNER, a.id, "arch-a");
    tick();
    const position = store.projects.get(a.id)!.position;
    const before = counts(store);
    const restored = store.restoreProject(OWNER, a.id, "restore-a");
    expect(restored.archivedAt).toBeNull();
    expect(restored.position).toBe(position);
    expect(restored.updatedAt).toBe(T0 + 3000);
    const activities = store.activities.slice(before.activities);
    expect(activities.map((item) => [item.entityId, item.action])).toEqual([[a.id, "restored"]]);
    expect(store.outbox.slice(before.outbox).map((item) => item.type)).toEqual([
      "project.restored",
    ]);
  });

  it("[状態遷移] 未アーカイブ → restore: 何も変えずに成功し、Activity・Outboxを記録しない", () => {
    const { store, a } = setup();
    const snapshot = structuredClone(store.projects.get(a.id));
    const before = counts(store);
    const restored = store.restoreProject(OWNER, a.id, "restore-noop");
    expect(restored).toEqual(snapshot);
    expect(store.activities.length).toBe(before.activities);
    expect(store.outbox.length).toBe(before.outbox);
  });

  it("[代表値] 同じキーの再送は初回の応答を返し、何も変えない", () => {
    const { store, tick, a } = setup();
    store.archiveProject(OWNER, a.id, "arch-a");
    const first = structuredClone(store.restoreProject(OWNER, a.id, "restore-a"));
    tick();
    store.archiveProject(OWNER, a.id, "arch-a2");
    const before = counts(store);
    expect(store.restoreProject(OWNER, a.id, "restore-a")).toEqual(first);
    expect(store.projects.get(a.id)!.archivedAt).not.toBeNull();
    expect(counts(store)).toEqual(before);
  });
});

describe("Projectの削除（delete）", () => {
  function withIssues() {
    const s = setup();
    const { store, a, b } = s;
    const inA = store.createIssue(OWNER, { idempotencyKey: "i1", title: "A1", projectId: a.id });
    const archivedInA = store.createIssue(OWNER, {
      idempotencyKey: "i2",
      title: "A2",
      projectId: a.id,
    });
    store.archiveIssue(OWNER, archivedInA.id, "i2-arch");
    const trashedInA = store.createIssue(OWNER, {
      idempotencyKey: "i3",
      title: "A3",
      projectId: a.id,
    });
    store.trashIssue(OWNER, trashedInA.id, "i3-trash");
    const inB = store.createIssue(OWNER, { idempotencyKey: "i4", title: "B1", projectId: b.id });
    const none = store.createIssue(OWNER, { idempotencyKey: "i5", title: "none" });
    s.tick();
    return { ...s, inA, archivedInA, trashedInA, inB, none };
  }

  it("[状態遷移] 未アーカイブ・アーカイブ済みのどちらも削除でき、一覧とBootstrapから消える", () => {
    const { store, a, b } = setup();
    store.archiveProject(OWNER, b.id, "arch-b");
    const deletedA = store.deleteProject(OWNER, a.id, "del-a");
    const deletedB = store.deleteProject(OWNER, b.id, "del-b");
    expect(deletedA.deletedAt).not.toBeNull();
    expect(deletedB.deletedAt).not.toBeNull();
    const ids = store.listProjects(OWNER).map((project) => project.id);
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(store.bootstrap(OWNER).projects.map((project) => project.id)).toEqual(ids);
  });

  it("[デシジョンテーブル] 削除したProjectのIssue（通常・アーカイブ・ゴミ箱）は外れ、他は不変", () => {
    const s = withIssues();
    const { store, a } = s;
    const before = new Map([...store.issues].map(([id, issue]) => [id, structuredClone(issue)]));
    store.deleteProject(OWNER, a.id, "del-a");
    for (const target of [s.inA, s.archivedInA, s.trashedInA]) {
      const issue = store.issues.get(target.id)!;
      const prev = before.get(target.id)!;
      expect(issue.projectId).toBeNull();
      expect(issue.version).toBe(prev.version + 1);
      expect(issue.updatedAt).toBe(s.now());
      expect(issue.archivedAt).toBe(prev.archivedAt);
      expect(issue.deletedAt).toBe(prev.deletedAt);
    }
    for (const untouched of [s.inB, s.none]) {
      expect(store.issues.get(untouched.id)).toEqual(before.get(untouched.id));
    }
  });

  it("[代表値] ActivityとOutboxはProjectに1件ずつ、外したIssueの件数を持つ", () => {
    const s = withIssues();
    const { store, a } = s;
    const before = counts(store);
    store.deleteProject(OWNER, a.id, "del-a");
    const activities = store.activities.slice(before.activities);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      entityType: "project",
      entityId: a.id,
      action: "deleted",
      after: { deletedAt: s.now(), detachedIssueCount: 3 },
    });
    const outbox = store.outbox.slice(before.outbox);
    expect(outbox.map((item) => item.type)).toEqual(["project.deleted"]);
    expect(outbox[0].payload).toEqual({ projectId: a.id, detachedIssueCount: 3 });
  });

  it("[代表値] 同じキーの再送は初回の応答を返し、何も変えない", () => {
    const { store, a } = setup();
    const first = structuredClone(store.deleteProject(OWNER, a.id, "del-a"));
    const before = counts(store);
    expect(store.deleteProject(OWNER, a.id, "del-a")).toEqual(first);
    expect(counts(store)).toEqual(before);
  });

  it("[状態遷移（禁止遷移）] 削除済みへの各操作とIssueへのProject指定は404", () => {
    const { store, a, b } = setup();
    store.deleteProject(OWNER, a.id, "del-a");
    const notFound = expect.objectContaining({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect(() =>
      store.updateProject(OWNER, { id: a.id, idempotencyKey: "u", patch: { name: "x" } }),
    ).toThrowError(notFound);
    expect(() => store.archiveProject(OWNER, a.id, "x1")).toThrowError(notFound);
    expect(() => store.restoreProject(OWNER, a.id, "x2")).toThrowError(notFound);
    expect(() => store.deleteProject(OWNER, a.id, "x3")).toThrowError(notFound);
    expect(() =>
      store.reorderProject(OWNER, { idempotencyKey: "x4", projectId: a.id, beforeProjectId: b.id }),
    ).toThrowError(notFound);
    expect(() =>
      store.createIssue(OWNER, { idempotencyKey: "x5", title: "t", projectId: a.id }),
    ).toThrowError(notFound);
  });

  it("[同値分割] 他Owner・存在しないProjectは404、ロック中は423で何も変えない", () => {
    const { store, a } = setup();
    const before = counts(store);
    const projects = structuredClone(store.listProjects(OWNER));
    for (const action of ["restoreProject", "deleteProject"] as const) {
      expect(() => store[action](OTHER, a.id, `${action}-other`)).toThrowError(
        expect.objectContaining({ status: 404 }),
      );
      expect(() => store[action](OWNER, "missing", `${action}-missing`)).toThrowError(
        expect.objectContaining({ status: 404 }),
      );
    }
    expect(counts(store)).toEqual(before);
    store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "lock" });
    const locked = counts(store);
    for (const action of ["restoreProject", "deleteProject"] as const) {
      expect(() => store[action](OWNER, a.id, `${action}-locked`)).toThrowError(
        expect.objectContaining({ status: 423, code: "OPERATION_IN_PROGRESS" }),
      );
    }
    expect(store.listProjects(OWNER)).toEqual(projects);
    expect(counts(store)).toEqual(locked);
  });
});

describe("Project action HTTP", () => {
  beforeEach(() => resetOrbitStores());

  const post = (url: string, key?: string) =>
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(key ? { idempotencyKey: key } : {}),
    });
  const get = (url: string) => new Request(url);

  async function firstProject(): Promise<Project> {
    const body = (await (await listProjects(get("http://orbit.local/api/v1/projects"))).json()) as {
      items: Project[];
    };
    return body.items[0];
  }

  it("[代表値] actionなし・archiveはアーカイブ、restoreで戻る", async () => {
    const project = await firstProject();
    const base = `http://orbit.local/api/v1/projects/${project.id}`;
    const noop = await postProjectAction(post(`${base}?action=restore`, "h-noop"), project.id);
    expect(noop.status).toBe(200);
    expect(((await noop.json()) as { project: Project }).project.archivedAt).toBeNull();
    const archived = await postProjectAction(post(base, "h-arch"), project.id);
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as { project: Project }).project.archivedAt).not.toBeNull();
    const restored = await postProjectAction(
      post(`${base}?action=restore`, "h-restore"),
      project.id,
    );
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { project: Project }).project.archivedAt).toBeNull();
    const archivedAgain = await postProjectAction(
      post(`${base}?action=archive`, "h-arch2"),
      project.id,
    );
    expect(
      ((await archivedAgain.json()) as { project: Project }).project.archivedAt,
    ).not.toBeNull();
  });

  it("[代表値] action=deleteで一覧とBootstrapから消える", async () => {
    const project = await firstProject();
    const response = await postProjectAction(
      post(`http://orbit.local/api/v1/projects/${project.id}?action=delete`, "h-del"),
      project.id,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { project: Project }).project.deletedAt).not.toBeNull();
    const boot = (await (await bootstrap(get("http://orbit.local/api/v1/bootstrap"))).json()) as {
      projects: Project[];
    };
    expect(boot.projects.map((item) => item.id)).not.toContain(project.id);
  });

  it("[デシジョンテーブル] 不明action・キーなしは400、存在しないは404、ロック中は423で不変", async () => {
    const project = await firstProject();
    const base = `http://orbit.local/api/v1/projects/${project.id}`;
    const store = getOrbitStore("dev-owner");
    const before = {
      ...counts(store),
      project: structuredClone(store.projects.get(project.id)),
    };
    const snapshot = () => ({
      ...counts(store),
      project: structuredClone(store.projects.get(project.id)),
    });

    const unknown = await postProjectAction(post(`${base}?action=trash`, "h-unknown"), project.id);
    expect(unknown.status).toBe(400);
    const unknownBody = (await unknown.json()) as {
      error: { code: string; fieldErrors: Record<string, string[]> };
    };
    expect(unknownBody.error.code).toBe("VALIDATION_ERROR");
    expect(unknownBody.error.fieldErrors.action).toBeDefined();

    const noKey = await postProjectAction(post(`${base}?action=delete`), project.id);
    expect(noKey.status).toBe(400);

    const missing = await postProjectAction(
      post("http://orbit.local/api/v1/projects/missing?action=delete", "h-missing"),
      "missing",
    );
    expect(missing.status).toBe(404);
    expect(snapshot()).toEqual(before);

    const otherOwner = getOrbitStore("other-owner");
    otherOwner.ensureOwner("other-owner", "other@example.com");
    const foreign = otherOwner.createProject("other-owner", {
      idempotencyKey: "h-foreign",
      name: "Foreign",
    });
    const foreignResponse = await postProjectAction(
      post(`http://orbit.local/api/v1/projects/${foreign.id}?action=delete`, "h-foreign-del"),
      foreign.id,
    );
    expect(foreignResponse.status).toBe(404);
    expect(otherOwner.projects.get(foreign.id)!.deletedAt).toBeNull();
    expect(snapshot()).toEqual(before);

    store.startRun("dev-owner", { kind: "maintenance", idempotencyKey: "h-lock" });
    const locked = snapshot();
    for (const action of ["delete", "restore"]) {
      const lockedResponse = await postProjectAction(
        post(`${base}?action=${action}`, `h-locked-${action}`),
        project.id,
      );
      expect(lockedResponse.status).toBe(423);
    }
    expect(snapshot()).toEqual(locked);
  });
});
