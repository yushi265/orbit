import type { D1Database } from "@cloudflare/workers-types";
import {
  readStoreSnapshot,
  SnapshotVersionConflict,
  writeStoreSnapshot,
} from "../db/repositories/store-snapshot";
import { conflict } from "./errors";
import { runtimeEnv } from "./auth";
import { getOrbitStore, OrbitStore } from "./store";

export interface StoreSession {
  store: OrbitStore;
  persist: () => Promise<void>;
  needsInitialPersist: boolean;
}

export type StoreSessionEnvironment = {
  APP_ENV?: string;
  DB?: D1Database;
};

export async function openStoreSession(
  userId: string,
  email: string,
  suppliedEnvironment?: StoreSessionEnvironment,
): Promise<StoreSession> {
  const env = suppliedEnvironment ?? ((await runtimeEnv()) as StoreSessionEnvironment);
  if ((env.APP_ENV ?? "development") !== "production") {
    const store = getOrbitStore(userId);
    store.ensureOwner(userId, email, userId === "dev-owner");
    return { store, persist: async () => {}, needsInitialPersist: false };
  }

  const database = env.DB;
  if (!database) throw new Error("Production D1 binding is missing");
  const row = await readStoreSnapshot(database, userId);
  const store = row ? OrbitStore.fromSnapshot(row.snapshot, undefined, userId) : new OrbitStore();
  const initialSnapshotJson = row ? JSON.stringify(store.toSnapshot()) : null;
  store.ensureOwner(userId, email);
  store.ensureUpcomingCycles(userId);
  const expectedVersion = row?.version ?? 0;
  let persisted = false;
  let needsInitialPersist =
    row === null ||
    (initialSnapshotJson !== null && JSON.stringify(store.toSnapshot()) !== initialSnapshotJson);

  return {
    store,
    get needsInitialPersist() {
      return needsInitialPersist;
    },
    persist: async () => {
      if (persisted) return;
      const snapshot = store.toSnapshot();
      if (initialSnapshotJson !== null && JSON.stringify(snapshot) === initialSnapshotJson) {
        persisted = true;
        return;
      }
      try {
        await writeStoreSnapshot(database, userId, expectedVersion, snapshot, Date.now());
        persisted = true;
        needsInitialPersist = false;
      } catch (error) {
        if (error instanceof SnapshotVersionConflict)
          throw conflict("D1_WRITE_CONFLICT", "別の操作が先に保存されました。再試行してください。");
        throw error;
      }
    },
  };
}
