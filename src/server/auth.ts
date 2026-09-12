import { createRemoteJWKSet, jwtVerify } from "jose";
import { LOCAL_OWNER, resolveRuntimeConfig } from "./runtime-config";
import { ServiceError } from "./errors";
import { createDb } from "../db/client";
import { findOwnedUser } from "../db/repositories/owner";
import type { D1Database } from "@cloudflare/workers-types";

type RuntimeEnv = Record<string, string | undefined> & {
  APP_ENV?: string;
  ORBIT_STORAGE?: string;
  ORBIT_LOCAL_ORIGINS?: string;
};
export type RuntimeEnvironment = RuntimeEnv & { DB?: D1Database };

export async function runtimeEnv(): Promise<RuntimeEnv> {
  const processEnv = (globalThis as { process?: { env?: RuntimeEnv } }).process?.env;
  try {
    const worker = await import("cloudflare:workers");
    return processEnv
      ? { ...processEnv, ...(worker.env as RuntimeEnv) }
      : { ...(worker.env as RuntimeEnv) };
  } catch {
    return processEnv ?? {};
  }
}

export interface OwnerContext {
  userId: string;
  email: string;
  accessAuthenticated: boolean;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function resolveOwner(
  request: Request,
  suppliedEnvironment?: RuntimeEnvironment,
): Promise<OwnerContext> {
  const env = suppliedEnvironment ?? ((await runtimeEnv()) as RuntimeEnvironment);
  const { mode: appEnv } = resolveRuntimeConfig(env);
  if (appEnv === "local") {
    if (!env.DB) throw new ServiceError(500, "INTERNAL_ERROR", "ローカルDBを確認できません。");
    let owner;
    try {
      owner = await findOwnedUser(createDb({ DB: env.DB }), LOCAL_OWNER.userId, LOCAL_OWNER.email);
    } catch {
      throw new ServiceError(500, "INTERNAL_ERROR", "ローカルDBを確認できません。");
    }
    if (!owner)
      throw new ServiceError(500, "INTERNAL_ERROR", "ローカルOwnerを初期化してください。");
    return { ...LOCAL_OWNER, accessAuthenticated: false };
  }
  const devOwner = env.DEV_OWNER_USER_ID ?? "dev-owner";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (appEnv !== "production" && !token) {
    return { userId: devOwner, email: "you@orbit.local", accessAuthenticated: false };
  }
  if (!token) throw new ServiceError(401, "AUTH_REQUIRED", "認証が必要です。");
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  const userId = env.OWNER_USER_ID;
  const ownerEmail = env.OWNER_EMAIL;
  if (!teamDomain || !audience || !userId || !ownerEmail)
    throw new ServiceError(401, "AUTH_REQUIRED", "認証設定が未完了です。");
  const database = env.DB;
  if (!database) throw new ServiceError(500, "INTERNAL_ERROR", "認証基盤を確認できません。");
  const issuer = `https://${teamDomain}.cloudflareaccess.com`;
  let payload;
  try {
    let jwks = jwksCache.get(issuer);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      jwksCache.set(issuer, jwks);
    }
    ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(401, "AUTH_REQUIRED", "認証情報を確認できません。");
  }
  const email = typeof payload.email === "string" ? payload.email : "";
  if (email.toLowerCase() !== ownerEmail.toLowerCase())
    throw new ServiceError(401, "AUTH_REQUIRED", "認証情報を確認できません。");
  let owner;
  try {
    owner = await findOwnedUser(createDb({ DB: database }), userId, email);
  } catch {
    throw new ServiceError(500, "INTERNAL_ERROR", "認証基盤を確認できません。");
  }
  if (!owner) throw new ServiceError(401, "AUTH_REQUIRED", "所有者を確認できません。");
  return { userId, email, accessAuthenticated: true };
}
