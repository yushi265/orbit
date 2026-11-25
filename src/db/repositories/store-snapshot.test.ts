import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { OrbitStore } from "../../server/store";
import { readStoreSnapshot, SnapshotVersionConflict, writeStoreSnapshot } from "./store-snapshot";

type Row = { userId: string; version: number; stateJson: string; updatedAt: number };

class FakeD1 {
  readonly rows = new Map<string, Row>();

  prepare(query: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues;
        return statement;
      },
      first: async <T>() => {
        const row = this.rows.get(String(values[0]));
        if (!row) return null as T | null;
        return {
          version: row.version,
          stateJson: row.stateJson,
          updatedAt: row.updatedAt,
        } as T;
      },
      run: async () => {
        const [userId, version, stateJson, updatedAt, expectedVersion] = values as [
          string,
          number,
          string,
          number,
          number,
        ];
        const current = this.rows.get(userId);
        if (query.startsWith("SELECT")) return { meta: { changes: 0 } };
        if (current && current.version !== expectedVersion) return { meta: { changes: 0 } };
        this.rows.set(userId, { userId, version, stateJson, updatedAt });
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

describe("store snapshot repository", () => {
  it("persists and reloads a snapshot with a monotonic version", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const snapshot = new OrbitStore(() => 1_700_000_000_000).toSnapshot();

    expect(await readStoreSnapshot(database, "owner-a")).toBeNull();
    expect(await writeStoreSnapshot(database, "owner-a", 0, snapshot, 1_700_000_000_000)).toBe(1);

    const row = await readStoreSnapshot(database, "owner-a");
    expect(row?.version).toBe(1);
    expect(row?.snapshot).toEqual(snapshot);
    expect(await writeStoreSnapshot(database, "owner-a", 1, snapshot, 1_700_000_000_001)).toBe(2);
    expect(await writeStoreSnapshot(database, "owner-b", 0, snapshot, 1_700_000_000_002)).toBe(1);
    expect((await readStoreSnapshot(database, "owner-a"))?.version).toBe(2);
    expect((await readStoreSnapshot(database, "owner-b"))?.version).toBe(1);
  });

  it("rejects a stale writer without overwriting the newer row", async () => {
    const database = new FakeD1() as unknown as D1Database;
    const snapshot = new OrbitStore().toSnapshot();
    await writeStoreSnapshot(database, "owner-a", 0, snapshot, 1);

    await expect(writeStoreSnapshot(database, "owner-a", 0, snapshot, 2)).rejects.toBeInstanceOf(
      SnapshotVersionConflict,
    );
    expect((await readStoreSnapshot(database, "owner-a"))?.updatedAt).toBe(1);
    expect(await readStoreSnapshot(database, "owner-b")).toBeNull();
  });

  it("rejects malformed JSON from D1", async () => {
    const database = new FakeD1();
    database.rows.set("owner-a", {
      userId: "owner-a",
      version: 1,
      stateJson: "{invalid",
      updatedAt: 1,
    });

    await expect(readStoreSnapshot(database as unknown as D1Database, "owner-a")).rejects.toThrow(
      "Invalid D1 snapshot JSON",
    );
  });

  it("rejects invalid versions and non-JSON state", async () => {
    const database = new FakeD1();
    database.rows.set("owner-a", {
      userId: "owner-a",
      version: -1,
      stateJson: "{}",
      updatedAt: 1,
    });
    await expect(readStoreSnapshot(database as unknown as D1Database, "owner-a")).rejects.toThrow(
      "Invalid D1 snapshot row",
    );

    await expect(
      writeStoreSnapshot(database as unknown as D1Database, "owner-a", -1, {}, 1),
    ).rejects.toThrow("Invalid D1 snapshot version");

    const snapshotWithBigInt = { value: BigInt(1) } as never;
    await expect(
      writeStoreSnapshot(database as unknown as D1Database, "owner-a", 0, snapshotWithBigInt, 1),
    ).rejects.toThrow();
  });
});
