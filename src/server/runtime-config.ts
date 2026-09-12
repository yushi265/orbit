import { ServiceError } from "./errors";

export const LOCAL_OWNER = { userId: "local-owner", email: "local-owner@orbit.local" } as const;
export const LOCAL_ORIGIN = "http://127.0.0.1:3000";

export function resolveLocalOrigins(env: { ORBIT_LOCAL_ORIGINS?: string }): string[] {
  if (env.ORBIT_LOCAL_ORIGINS === undefined) return [LOCAL_ORIGIN];
  try {
    if (typeof env.ORBIT_LOCAL_ORIGINS !== "string") throw new Error("invalid-origins");
    const origins: unknown = JSON.parse(env.ORBIT_LOCAL_ORIGINS);
    if (!Array.isArray(origins) || origins.length === 0) throw new Error("invalid-origins");
    for (const origin of origins) {
      if (typeof origin !== "string") throw new Error("invalid-origin");
      const url = new URL(origin);
      const [first, second] = url.hostname.split(".").map(Number);
      const isPrivate =
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
        (first === 10 ||
          (first === 172 && second >= 16 && second <= 31) ||
          (first === 192 && second === 168));
      if (
        url.origin !== origin ||
        url.protocol !== "http:" ||
        url.port !== "3000" ||
        (origin !== LOCAL_ORIGIN && !isPrivate)
      )
        throw new Error("invalid-origin");
    }
    return origins;
  } catch {
    throw new ServiceError(500, "INTERNAL_ERROR", "ローカル接続設定を確認してください。");
  }
}

export function resolveRuntimeConfig(env: { APP_ENV?: string; ORBIT_STORAGE?: string }): {
  mode: "development" | "local" | "production";
  storage: "memory" | "d1";
} {
  const mode = env.APP_ENV ?? "development";
  const storage = env.ORBIT_STORAGE;
  if (mode === "development" && (storage === undefined || storage === "memory"))
    return { mode, storage: "memory" };
  if (
    (mode === "local" && storage === "d1") ||
    (mode === "production" && (storage === undefined || storage === "d1"))
  )
    return { mode, storage: "d1" };
  throw new ServiceError(500, "INTERNAL_ERROR", "実行設定を確認してください。");
}
