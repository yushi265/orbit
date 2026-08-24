import type { D1Database } from "@cloudflare/workers-types";

export interface StoreSnapshotRow {
  version: number;
  snapshot: unknown;
  updatedAt: number;
}

export class SnapshotVersionConflict extends Error {
  constructor() {
    super("D1 snapshot version conflict");
    this.name = "SnapshotVersionConflict";
  }
}

export async function readStoreSnapshot(
  database: D1Database,
  userId: string,
): Promise<StoreSnapshotRow | null> {
  const row = await database
    .prepare(
      "SELECT version, state_json AS stateJson, updated_at AS updatedAt FROM orbit_store_snapshots WHERE user_id = ? LIMIT 1",
    )
    .bind(userId)
    .first<{ version: number; stateJson: string; updatedAt: number }>();
  if (!row) return null;
  if (
    !Number.isInteger(row.version) ||
    row.version < 0 ||
    typeof row.stateJson !== "string" ||
    !Number.isInteger(row.updatedAt)
  ) {
    throw new Error("Invalid D1 snapshot row");
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.stateJson);
  } catch {
    throw new Error("Invalid D1 snapshot JSON");
  }
  return { version: row.version, snapshot, updatedAt: row.updatedAt };
}

export async function writeStoreSnapshot(
  database: D1Database,
  userId: string,
  expectedVersion: number,
  snapshot: unknown,
  updatedAt: number,
): Promise<number> {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
    throw new Error("Invalid D1 snapshot version");
  const nextVersion = expectedVersion + 1;
  const result = await database
    .prepare(
      `INSERT INTO orbit_store_snapshots (user_id, version, state_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         version = excluded.version,
         state_json = excluded.state_json,
         updated_at = excluded.updated_at
       WHERE orbit_store_snapshots.version = ?`,
    )
    .bind(userId, nextVersion, JSON.stringify(snapshot), updatedAt, expectedVersion)
    .run();
  if (Number(result.meta.changes) !== 1) throw new SnapshotVersionConflict();
  return nextVersion;
}
