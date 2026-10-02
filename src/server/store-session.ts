import type { D1Database } from "@cloudflare/workers-types";
import {
  readStoreSnapshot,
  SnapshotVersionConflict,
  writeStoreSnapshot,
} from "../db/repositories/store-snapshot";
import { resolveRuntimeConfig } from "./runtime-config";
import { conflict } from "./errors";
import { runtimeEnv } from "./auth";
import { decodeStoreSnapshot, encodeStoreSnapshot } from "./store-snapshot-compat";
import { getOrbitStore, OrbitStore } from "./store";

export interface StoreSession {
  store: OrbitStore;
  persist: () => Promise<void>;
  needsInitialPersist: boolean;
}

export type StoreSessionEnvironment = {
  APP_ENV?: string;
  ORBIT_STORAGE?: string;
  DB?: D1Database;
};

export async function openStoreSession(
  userId: string,
  email: string,
  suppliedEnvironment?: StoreSessionEnvironment,
): Promise<StoreSession> {
  const env = suppliedEnvironment ?? ((await runtimeEnv()) as StoreSessionEnvironment);
  const config = resolveRuntimeConfig(env);
  if (config.storage === "memory") {
    const store = getOrbitStore(userId);
    store.ensureOwner(userId, email, userId === "dev-owner");
    store.clearRejectedRunStateChanges();
    return {
      store,
      persist: async () => store.clearRejectedRunStateChanges(),
      needsInitialPersist: false,
    };
  }

  const database = env.DB;
  if (!database)
    throw new Error(
      `${config.mode === "production" ? "Production" : "Local"} D1 binding is missing`,
    );
  const row = await readStoreSnapshot(database, userId);
  const store = row
    ? OrbitStore.fromSnapshot(decodeStoreSnapshot(row.snapshot), undefined, userId)
    : new OrbitStore();
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
      return !persisted && (needsInitialPersist || store.hasBackgroundStateChanges());
    },
    persist: async () => {
      if (persisted) return;
      const snapshot = store.toSnapshot();
      if (initialSnapshotJson !== null && JSON.stringify(snapshot) === initialSnapshotJson) {
        persisted = true;
        store.clearRejectedRunStateChanges();
        return;
      }
      try {
        await writeStoreSnapshot(
          database,
          userId,
          expectedVersion,
          encodeStoreSnapshot(snapshot),
          Date.now(),
        );
        persisted = true;
        needsInitialPersist = false;
        store.clearBackgroundStateChanges();
        store.clearRejectedRunStateChanges();
      } catch (error) {
        if (error instanceof SnapshotVersionConflict)
          throw conflict("D1_WRITE_CONFLICT", "別の操作が先に保存されました。再試行してください。");
        throw error;
      }
    },
  };
}
