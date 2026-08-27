import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { createDb } from "../client";
import { bootstrapOwner } from "./owner";

class BootstrapD1 {
  readonly users = new Map<string, Record<string, unknown>>();
  readonly preferences = new Map<string, Record<string, unknown>>();
  readonly locks = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    const normalizedQuery = query.toLowerCase();
    let values: unknown[] = [];
    const statement = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues;
        return statement;
      },
      run: async () => {
        if (normalizedQuery.includes('insert into "users"')) {
          const [id, name, email, avatarUrl, createdAt] = values;
          if (!this.users.has(String(id)))
            this.users.set(String(id), { id, name, email, avatarUrl, createdAt });
        } else if (normalizedQuery.includes('insert into "user_preferences"')) {
          const [
            userId,
            timezone,
            locale,
            theme,
            colorTheme,
            issueCounter,
            estimateEnabled,
            display,
          ] = values;
          if (!this.preferences.has(String(userId)))
            this.preferences.set(String(userId), {
              userId,
              timezone,
              locale,
              theme,
              colorTheme,
              issueCounter,
              estimateEnabled,
              display,
            });
        } else if (normalizedQuery.includes('insert into "user_runtime_locks"')) {
          const [userId, runId, lockToken, status, acquiredAt, heartbeatAt, leaseExpiresAt] =
            values;
          if (!this.locks.has(String(userId)))
            this.locks.set(String(userId), {
              userId,
              runId,
              lockToken,
              status,
              acquiredAt,
              heartbeatAt,
              leaseExpiresAt,
            });
        }
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

describe("Owner bootstrap repository", () => {
  it("[状態遷移] 初回bootstrapで3つのOwner行を作り、再実行で既存値を保持する", async () => {
    const database = new BootstrapD1();
    const db = createDb({ DB: database as unknown as D1Database });
    await bootstrapOwner(db, "owner-1", "Orbit User", "owner@example.com", 1_700_000_000_000);

    database.users.get("owner-1")!.name = "Custom Name";
    database.preferences.get("owner-1")!.timezone = "UTC";
    database.locks.get("owner-1")!.status = "running";
    await bootstrapOwner(db, "owner-1", "Overwritten", "other@example.com", 1);

    expect(database.users).toHaveLength(1);
    expect(database.preferences).toHaveLength(1);
    expect(database.locks).toHaveLength(1);
    expect(database.users.get("owner-1")?.name).toBe("Custom Name");
    expect(database.users.get("owner-1")?.email).toBe("owner@example.com");
    expect(database.preferences.get("owner-1")?.timezone).toBe("UTC");
    expect(database.locks.get("owner-1")?.status).toBe("running");
  });
});
