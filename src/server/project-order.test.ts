import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it } from "vitest";
import { readStoreSnapshot, writeStoreSnapshot } from "../db/repositories/store-snapshot";
import { bootstrap, createProject, listProjects, reorderProject, updateProject } from "./api";
import type { Project } from "./model";
import { json, withOwner } from "./http";
import { OrbitStore, resetOrbitStores, type OrbitStoreSnapshot } from "./store";
import { decodeStoreSnapshot, encodeStoreSnapshot } from "./store-snapshot-compat";
import { openStoreSession } from "./store-session";
import { FakeD1 } from "./store-session.test-fixtures";

const OWNER = "order-owner";
const OTHER = "order-other";
const T0 = 1_800_000_000_000;

function clocked() {
  let now = T0;
  const store = new OrbitStore(() => now);
  store.ensureOwner(OWNER, "o@example.com");
  store.ensureOwner(OTHER, "x@example.com");
  return { store, tick: () => (now += 1000) };
}

function makeProjects(store: OrbitStore, tick: () => number, names = ["A", "B", "C", "D"]) {
  return names.map((name) => {
    tick();
    return store.createProject(OWNER, { idempotencyKey: `create-${name}`, name });
  });
}

function order(store: OrbitStore, userId = OWNER): string[] {
  return store.listProjects(userId).map((project) => project.name);
}

function positions(store: OrbitStore, userId = OWNER): number[] {
  return store.listProjects(userId).map((project) => project.position);
}

function counts(store: OrbitStore) {
  return {
    activities: store.activities.length,
    outbox: store.outbox.length,
    receipts: store.receipts.size,
  };
}

function snapshotWithoutPositions(snapshot: OrbitStoreSnapshot): unknown {
  const copy = structuredClone(snapshot) as unknown as { projects: Record<string, unknown>[] };
  for (const project of copy.projects) delete project.position;
  return copy;
}

function projectRecord(overrides: Partial<Project> & { id: string }): Project {
  return {
    userId: OWNER,
    name: overrides.id,
    statusId: "x",
    priority: "no_priority",
    color: "#000",
    icon: "◈",
    description: "",
    startAt: null,
    targetAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: T0,
    updatedAt: T0,
    position: 0,
    ...overrides,
  };
}

describe("Project position と一覧の順", () => {
  it("[代表値] listProjectsはposition昇順で返り、各Projectがpositionを持つ", () => {
    const { store, tick } = clocked();
    const [a, b, c] = makeProjects(store, tick, ["A", "B", "C"]);
    store.projects.get(a.id)!.position = 2;
    store.projects.get(b.id)!.position = 0;
    store.projects.get(c.id)!.position = 1;
    expect(order(store)).toEqual(["B", "C", "A"]);
    expect(positions(store)).toEqual([0, 1, 2]);
  });

  it("[境界値] 同値はcreatedAt昇順、それも同値ならid昇順", () => {
    const { store } = clocked();
    for (const [id, createdAt] of [
      ["p-c", T0 + 5],
      ["p-b", T0],
      ["p-a", T0],
    ] as const)
      store.projects.set(id, projectRecord({ id, createdAt, position: 3 }));
    expect(store.listProjects(OWNER).map((p) => p.id)).toEqual(["p-a", "p-b", "p-c"]);
  });

  it("[同値分割] 更新・アーカイブ・復元・表示設定の保存で順とpositionは変わらない", () => {
    const { store, tick } = clocked();
    const [a, b] = makeProjects(store, tick, ["A", "B", "C"]);
    tick();
    store.updateProject(OWNER, { id: b.id, idempotencyKey: "u1", patch: { name: "B2" } });
    tick();
    store.archiveProject(OWNER, a.id, "arch");
    tick();
    store.updateProject(OWNER, { id: a.id, idempotencyKey: "u2", patch: { description: "x" } });
    tick();
    store.updateProjectDisplayPreferences(OWNER, b.id, {
      idempotencyKey: "pref",
      displayPreferences: store.getProjectDisplayPreferences(OWNER, b.id).settings,
    });
    expect(order(store)).toEqual(["A", "B2", "C"]);
    expect(positions(store)).toEqual([0, 1, 2]);
  });
});

describe("createProject の position", () => {
  it("[境界値] 0件なら0、0,1,2があれば3", () => {
    const { store, tick } = clocked();
    const created = makeProjects(store, tick, ["A", "B", "C", "D"]);
    expect(created.map((p) => p.position)).toEqual([0, 1, 2, 3]);
  });

  it("[境界値] 削除済みの大きいpositionと他Ownerのpositionは影響しない", () => {
    const { store, tick } = clocked();
    makeProjects(store, tick, ["A", "B"]);
    store.projects.set("deleted", projectRecord({ id: "deleted", position: 5, deletedAt: T0 }));
    store.projects.set("other", projectRecord({ id: "other", userId: OTHER, position: 9 }));
    const created = store.createProject(OWNER, { idempotencyKey: "next", name: "N" });
    expect(created.position).toBe(2);
    const otherFirst = store.createProject(OTHER, { idempotencyKey: "o1", name: "O" });
    expect(otherFirst.position).toBe(10);
  });
});

describe("fromSnapshot の position 補完", () => {
  function snapshotOf(records: Project[]): OrbitStoreSnapshot {
    const { store } = clocked();
    const snapshot = store.toSnapshot();
    snapshot.projects = records;
    return snapshot;
  }
  const restored = (records: Project[], userId = OWNER) => {
    const store = OrbitStore.fromSnapshot(snapshotOf(records));
    return Object.fromEntries(
      [...store.projects.values()]
        .filter((p) => p.userId === userId)
        .map((p) => [p.id, p.position]),
    );
  };
  const without = (record: Project) => {
    const copy = { ...record } as Record<string, unknown>;
    delete copy.position;
    return copy as unknown as Project;
  };

  it("[デシジョンテーブル] 全件なしならcreatedAt昇順で0からの連番", () => {
    const records = [
      without(projectRecord({ id: "c", createdAt: T0 + 3 })),
      without(projectRecord({ id: "a", createdAt: T0 + 1 })),
      without(projectRecord({ id: "b", createdAt: T0 + 2 })),
    ];
    expect(restored(records)).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("[デシジョンテーブル] 一部だけなしなら、ありの最大+1からcreatedAt昇順", () => {
    const records = [
      projectRecord({ id: "has1", position: 4, createdAt: T0 + 9 }),
      projectRecord({ id: "has2", position: 1, createdAt: T0 + 9 }),
      without(projectRecord({ id: "n2", createdAt: T0 + 2 })),
      without(projectRecord({ id: "n1", createdAt: T0 + 1 })),
    ];
    expect(restored(records)).toEqual({ has1: 4, has2: 1, n1: 5, n2: 6 });
  });

  it("[デシジョンテーブル] 全件あればそのまま", () => {
    const records = [
      projectRecord({ id: "a", position: 7 }),
      projectRecord({ id: "b", position: 3 }),
    ];
    expect(restored(records)).toEqual({ a: 7, b: 3 });
  });

  it("[デシジョンテーブル] createdAtが同じならid昇順", () => {
    const records = [
      without(projectRecord({ id: "z" })),
      without(projectRecord({ id: "m" })),
      without(projectRecord({ id: "a" })),
    ];
    expect(restored(records)).toEqual({ a: 0, m: 1, z: 2 });
  });

  it("[デシジョンテーブル] Ownerごとに独立して補完する", () => {
    const records = [
      without(projectRecord({ id: "a1", userId: OWNER, createdAt: T0 + 1 })),
      without(projectRecord({ id: "a2", userId: OWNER, createdAt: T0 + 2 })),
      projectRecord({ id: "b1", userId: OTHER, position: 6 }),
      without(projectRecord({ id: "b2", userId: OTHER, createdAt: T0 + 1 })),
    ];
    expect(restored(records, OWNER)).toEqual({ a1: 0, a2: 1 });
    expect(restored(records, OTHER)).toEqual({ b1: 6, b2: 7 });
  });

  it.each([
    ["文字列", "3"],
    ["小数", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
  ])("[デシジョンテーブル] positionが%sの場合は「持たない」として補完する", (_name, value) => {
    const records = [
      projectRecord({ id: "ok", position: 2 }),
      { ...projectRecord({ id: "bad" }), position: value } as unknown as Project,
    ];
    expect(restored(records)).toEqual({ ok: 2, bad: 3 });
  });

  it("[デシジョンテーブル] 削除済みレコードも補完される", () => {
    const records = [
      without(projectRecord({ id: "live", createdAt: T0 })),
      without(projectRecord({ id: "gone", createdAt: T0 + 1, deletedAt: T0 + 5 })),
    ];
    expect(restored(records)).toEqual({ live: 0, gone: 1 });
  });

  it("[代表値] 補完は決定的で、入力を変更しない", () => {
    const { store, tick } = clocked();
    makeProjects(store, tick);
    const old = snapshotWithoutPositions(store.toSnapshot());
    const before = structuredClone(old);
    const first = OrbitStore.fromSnapshot(old).toSnapshot();
    const second = OrbitStore.fromSnapshot(old).toSnapshot();
    expect(second).toEqual(first);
    expect(old).toEqual(before);
    expect(first.projects.map((p) => p.position).sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("fromSnapshot の補完は projects の入力順に依存しない", () => {
  it("[代表値] 元の順・逆順・回転で与えても ID → position が同じ（複数Owner・createdAt同値を含む）", () => {
    const { store } = clocked();
    const snapshot = store.toSnapshot();
    const raw = (id: string, userId: string, createdAt: number, position?: number) => {
      const record: Record<string, unknown> = { ...projectRecord({ id, userId, createdAt }) };
      if (position === undefined) delete record.position;
      else record.position = position;
      return record;
    };
    const records = [
      raw("z", OWNER, T0),
      raw("a", OWNER, T0),
      raw("m", OWNER, T0 + 5),
      raw("k", OWNER, T0 + 9, 4),
      raw("y", OTHER, T0),
      raw("b", OTHER, T0),
      raw("q", OTHER, T0 - 1),
    ];
    const positionsFor = (projects: Record<string, unknown>[]) => {
      const restored = OrbitStore.fromSnapshot({ ...snapshot, projects });
      return Object.fromEntries([...restored.projects.values()].map((p) => [p.id, p.position]));
    };
    const expected = positionsFor(records);
    expect(expected).toEqual({ k: 4, a: 5, z: 6, m: 7, q: 0, b: 1, y: 2 });
    expect(positionsFor([...records].reverse())).toEqual(expected);
    for (let shift = 1; shift < records.length; shift += 1)
      expect(positionsFor([...records.slice(shift), ...records.slice(0, shift)])).toEqual(expected);
  });
});

describe("D1 Session と position", () => {
  async function seededOld() {
    const database = new FakeD1() as unknown as D1Database;
    const store = new OrbitStore();
    store.ensureOwner(OWNER, "o@example.com");
    store.ensureUpcomingCycles(OWNER);
    makeProjects(store, () => 0);
    const old = snapshotWithoutPositions(store.toSnapshot());
    await writeStoreSnapshot(database, OWNER, 0, old, T0);
    return { database, environment: { APP_ENV: "production", DB: database } };
  }

  it("[レイヤー内結合] 旧SnapshotはGET相当でversionが進まず、次のMutationで全Projectのpositionが保存される", async () => {
    const { database, environment } = await seededOld();
    const read = await openStoreSession(OWNER, "o@example.com", environment);
    expect(read.needsInitialPersist).toBe(false);
    await read.persist();
    expect((await readStoreSnapshot(database, OWNER))?.version).toBe(1);

    const write = await openStoreSession(OWNER, "o@example.com", environment);
    expect(positions(write.store)).toEqual([0, 1, 2, 3]);
    write.store.createProject(OWNER, { idempotencyKey: "extra", name: "E" });
    await write.persist();
    const saved = (await readStoreSnapshot(database, OWNER))!.snapshot as OrbitStoreSnapshot;
    expect(saved.projects.every((p) => Number.isInteger(p.position))).toBe(true);
    expect(saved.projects.map((p) => p.position).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("[レイヤー内結合] 旧SnapshotへのGET Handler（withOwner）は補完したpositionを返し、D1のversionも生Snapshotも変えない", async () => {
    const { database, environment } = await seededOld();
    const before = await readStoreSnapshot(database, OWNER);
    const response = await withOwner(
      new Request("https://orbit.example/api/v1/projects"),
      async ({ owner, requestId }) =>
        json({ items: owner.store.listProjects(owner.userId) }, 200, requestId),
      {
        resolveOwner: async () => ({
          userId: OWNER,
          email: "o@example.com",
          accessAuthenticated: true,
        }),
        openStoreSession: (userId, email) => openStoreSession(userId, email, environment),
      },
    );
    expect(response.status).toBe(200);
    const items = ((await response.json()) as { items: Project[] }).items;
    expect(items.map((p) => p.position)).toEqual([0, 1, 2, 3]);
    const after = await readStoreSnapshot(database, OWNER);
    expect(after?.version).toBe(before?.version);
    const raw = (after!.snapshot as { projects: Record<string, unknown>[] }).projects;
    expect(raw.length).toBe(4);
    expect(raw.every((p) => !("position" in p))).toBe(true);
  });

  it("[レイヤー内結合] D1で保存し別Sessionで読み直してもpositionが同じ", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const environment = { APP_ENV: "production", DB: database };
    const first = await openStoreSession(OWNER, "o@example.com", environment);
    const { tick } = clocked();
    makeProjects(first.store, tick);
    const [, b] = first.store.listProjects(OWNER);
    first.store.reorderProject(OWNER, {
      idempotencyKey: "mv",
      projectId: b.id,
      beforeProjectId: null,
    });
    await first.persist();
    const second = await openStoreSession(OWNER, "o@example.com", environment);
    expect(order(second.store)).toEqual(["A", "C", "D", "B"]);
    expect(positions(second.store)).toEqual([0, 1, 2, 3]);
  });

  it("[レイヤー内結合] encode/decode/fromSnapshotの往復でpositionが保たれる", () => {
    const { store, tick } = clocked();
    makeProjects(store, tick);
    store.projects.get(store.listProjects(OWNER)[0].id)!.position = 10;
    const expected = store.listProjects(OWNER).map((p) => [p.id, p.position]);
    const round = OrbitStore.fromSnapshot(
      decodeStoreSnapshot(encodeStoreSnapshot(store.toSnapshot())),
    );
    expect(round.listProjects(OWNER).map((p) => [p.id, p.position])).toEqual(expected);
  });

  it("[代表値] 旧版互換: encodeの出力は旧版が見る既存項目を保ち、positionは数値の追加属性", () => {
    const { store, tick } = clocked();
    makeProjects(store, tick, ["A"]);
    const encoded = encodeStoreSnapshot(store.toSnapshot()) as {
      projects: Record<string, unknown>[];
    };
    const record = encoded.projects[0];
    for (const key of [
      "id",
      "userId",
      "name",
      "statusId",
      "priority",
      "color",
      "icon",
      "description",
    ])
      expect(typeof record[key]).toBe("string");
    for (const key of ["createdAt", "updatedAt", "position"])
      expect(typeof record[key]).toBe("number");
  });
});

describe("reorderProject", () => {
  const input = (key: string, projectId: string, beforeProjectId: string | null) => ({
    idempotencyKey: key,
    projectId,
    beforeProjectId,
  });
  function setup() {
    const { store, tick } = clocked();
    const [a, b, c, d] = makeProjects(store, tick);
    tick();
    return { store, tick, a, b, c, d };
  }

  it.each([
    ["末尾を先頭へ", "d", "a", ["D", "A", "B", "C"]],
    ["先頭を末尾へ", "a", null, ["B", "C", "D", "A"]],
    ["途中を1つ上へ", "c", "b", ["A", "C", "B", "D"]],
    ["途中を1つ下へ", "b", "d", ["A", "C", "B", "D"]],
  ] as const)("[デシジョンテーブル] %s", (_name, target, before, expected) => {
    const s = setup();
    const ids = { a: s.a.id, b: s.b.id, c: s.c.id, d: s.d.id };
    const result = s.store.reorderProject(
      OWNER,
      input("mv", ids[target], before ? ids[before] : null),
    );
    expect(result.id).toBe(ids[target]);
    expect(order(s.store)).toEqual([...expected]);
    expect(positions(s.store)).toEqual([0, 1, 2, 3]);
  });

  it.each([
    ["既に直前（B before C）", "b", "c"],
    ["末尾を末尾へ", "d", null],
  ] as const)("[デシジョンテーブル] %sは不変でReceiptのみ記録", (_name, target, before) => {
    const s = setup();
    const ids = { a: s.a.id, b: s.b.id, c: s.c.id, d: s.d.id };
    const prev = counts(s.store);
    const result = s.store.reorderProject(
      OWNER,
      input("noop", ids[target], before ? ids[before] : null),
    );
    expect(result.id).toBe(ids[target]);
    expect(order(s.store)).toEqual(["A", "B", "C", "D"]);
    expect(positions(s.store)).toEqual([0, 1, 2, 3]);
    expect(counts(s.store)).toEqual({ ...prev, receipts: prev.receipts + 1 });
  });

  it("[代表値] アーカイブ済みを間に挟んでも移動でき、アーカイブ済み自体も対象・移動先になれる", () => {
    const s = setup();
    s.store.archiveProject(OWNER, s.b.id, "arch-b");
    s.store.reorderProject(OWNER, input("m1", s.d.id, s.c.id));
    expect(order(s.store)).toEqual(["A", "B", "D", "C"]);
    s.store.reorderProject(OWNER, input("m2", s.b.id, null));
    expect(order(s.store)).toEqual(["A", "D", "C", "B"]);
    s.store.reorderProject(OWNER, input("m3", s.a.id, s.b.id));
    expect(order(s.store)).toEqual(["D", "C", "A", "B"]);
    expect(positions(s.store)).toEqual([0, 1, 2, 3]);
  });

  it("[代表値] 変わる移動でActivity・Outbox・Receiptが1件ずつ、updatedAtは不変（4件がずれても）", () => {
    const s = setup();
    const updatedAts = s.store.listProjects(OWNER).map((p) => [p.id, p.updatedAt]);
    const prev = counts(s.store);
    s.store.reorderProject(OWNER, input("mv", s.d.id, s.a.id));
    expect(counts(s.store)).toEqual({
      activities: prev.activities + 1,
      outbox: prev.outbox + 1,
      receipts: prev.receipts + 1,
    });
    const activity = s.store.activities.at(-1)!;
    expect(activity).toMatchObject({
      entityType: "project",
      entityId: s.d.id,
      action: "reordered",
      before: { position: 3 },
      after: { position: 0 },
    });
    const outbox = s.store.outbox.at(-1)!;
    expect(outbox).toMatchObject({
      type: "project.reordered",
      dedupeKey: `project.reordered:${s.d.id}:mv`,
      payload: { projectId: s.d.id, position: 0 },
    });
    expect(
      s.store
        .listProjects(OWNER)
        .map((p) => [p.id, p.updatedAt])
        .sort(),
    ).toEqual([...updatedAts].sort());
  });

  it("[状態遷移] 同じキー・同じ内容の再送は初回応答で何も変えず、別内容は409", () => {
    const s = setup();
    const first = s.store.reorderProject(OWNER, input("mv", s.d.id, s.a.id));
    const prev = counts(s.store);
    const again = s.store.reorderProject(OWNER, input("mv", s.d.id, s.a.id));
    expect(again).toEqual(first);
    expect(order(s.store)).toEqual(["D", "A", "B", "C"]);
    expect(counts(s.store)).toEqual(prev);
    expect(() => s.store.reorderProject(OWNER, input("mv", s.d.id, s.b.id))).toThrowError(
      expect.objectContaining({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" }),
    );
  });

  describe("失敗は404/400/423で一切変更しない", () => {
    function assertUnchanged(
      s: ReturnType<typeof setup>,
      run: () => void,
      status: number,
      code: string,
    ) {
      const before = {
        projects: structuredClone(s.store.listProjects(OWNER)),
        counts: counts(s.store),
      };
      expect(run).toThrowError(expect.objectContaining({ status, code }));
      expect(s.store.listProjects(OWNER)).toEqual(before.projects);
      expect(counts(s.store)).toEqual(before.counts);
    }

    function withForeign(s: ReturnType<typeof setup>) {
      s.store.projects.set("foreign", projectRecord({ id: "foreign", userId: OTHER }));
      s.store.projects.set(
        "trashed",
        projectRecord({ id: "trashed", position: 9, deletedAt: T0 + 1 }),
      );
    }

    it.each(["missing", "foreign", "trashed"])("[同値分割] 対象が%sなら404", (id) => {
      const s = setup();
      withForeign(s);
      assertUnchanged(
        s,
        () => s.store.reorderProject(OWNER, input("f", id, s.a.id)),
        404,
        "RESOURCE_NOT_FOUND",
      );
    });

    it.each(["missing", "foreign", "trashed"])("[同値分割] 移動先が%sなら404", (id) => {
      const s = setup();
      withForeign(s);
      assertUnchanged(
        s,
        () => s.store.reorderProject(OWNER, input("f", s.a.id, id)),
        404,
        "RESOURCE_NOT_FOUND",
      );
    });

    it("[同値分割] 移動先が対象自身なら400 VALIDATION_ERROR（fieldErrors.beforeProjectId）", () => {
      const s = setup();
      assertUnchanged(
        s,
        () => s.store.reorderProject(OWNER, input("f", s.a.id, s.a.id)),
        400,
        "VALIDATION_ERROR",
      );
      try {
        s.store.reorderProject(OWNER, input("f", s.a.id, s.a.id));
      } catch (error) {
        expect(JSON.stringify(error)).toContain("beforeProjectId");
      }
    });

    it("[同値分割] Runのロック中は423 OPERATION_IN_PROGRESS", () => {
      const s = setup();
      s.store.startRun(OWNER, { kind: "maintenance", idempotencyKey: "lock" });
      const prevCounts = counts(s.store);
      const projects = structuredClone(s.store.listProjects(OWNER));
      expect(() => s.store.reorderProject(OWNER, input("f", s.d.id, s.a.id))).toThrowError(
        expect.objectContaining({ status: 423, code: "OPERATION_IN_PROGRESS" }),
      );
      expect(s.store.listProjects(OWNER)).toEqual(projects);
      expect(counts(s.store)).toEqual(prevCounts);
    });
  });
});

describe("Project 並べ替え HTTP", () => {
  beforeEach(() => resetOrbitStores());

  const post = (url: string, body: unknown) =>
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify(body),
    });
  const get = (url: string) => new Request(url);

  it("[レイヤー内結合] POSTが200で{project}を返し、GET一覧とBootstrapが新しい順を返す", async () => {
    for (const name of ["P1", "P2"]) {
      const response = await createProject(
        post("http://orbit.local/api/v1/projects", { idempotencyKey: `c-${name}`, name }),
      );
      expect(response.status).toBe(201);
    }
    const initial = (await (
      await listProjects(get("http://orbit.local/api/v1/projects"))
    ).json()) as { items: Project[] };
    expect(initial.items.map((p) => p.position)).toEqual([0, 1, 2]);
    const lastId = initial.items.at(-1)!.id;
    const firstId = initial.items[0].id;

    const response = await reorderProject(
      post("http://orbit.local/api/v1/projects/reorder", {
        idempotencyKey: "http-mv",
        projectId: lastId,
        beforeProjectId: firstId,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: Project };
    expect(body.project.id).toBe(lastId);
    expect(body.project.position).toBe(0);

    const list = (await (await listProjects(get("http://orbit.local/api/v1/projects"))).json()) as {
      items: Project[];
    };
    expect(list.items[0].id).toBe(lastId);
    const boot = (await (await bootstrap(get("http://orbit.local/api/v1/bootstrap"))).json()) as {
      projects: Project[];
    };
    expect(boot.projects.map((p) => p.id)).toEqual(list.items.map((p) => p.id));
    expect(boot.projects.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("[レイヤー内結合] 未知の項目を含む入力は400、更新(PATCH)では順が変わらない", async () => {
    const list = (await (await listProjects(get("http://orbit.local/api/v1/projects"))).json()) as {
      items: Project[];
    };
    const response = await reorderProject(
      post("http://orbit.local/api/v1/projects/reorder", {
        idempotencyKey: "http-bad",
        projectId: list.items[0].id,
        beforeProjectId: null,
        position: 3,
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR",
    );
    const patched = await updateProject(
      new Request(`http://orbit.local/api/v1/projects/${list.items[0].id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ idempotencyKey: "http-patch", name: "Renamed" }),
      }),
      list.items[0].id,
    );
    expect(patched.status).toBe(200);
    const after = (await (
      await listProjects(get("http://orbit.local/api/v1/projects"))
    ).json()) as {
      items: Project[];
    };
    expect(after.items.map((p) => [p.id, p.position])).toEqual(
      list.items.map((p) => [p.id, p.position]),
    );
    expect(after.items[0].name).toBe("Renamed");
  });
});
