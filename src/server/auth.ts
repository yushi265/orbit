import { createRemoteJWKSet, jwtVerify } from "jose";
import { ServiceError } from "./errors";
import { getOrbitStore } from "./store";
import { createDb } from "../db/client";
import { findOwnedUser } from "../db/repositories/owner";
import type { D1Database } from "@cloudflare/workers-types";

type RuntimeEnv = Record<string, string | undefined>;

async function runtimeEnv(): Promise<RuntimeEnv> {
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

export async function resolveOwner(request: Request): Promise<OwnerContext> {
  const env = await runtimeEnv();
  const appEnv = env.APP_ENV ?? "development";
  const devOwner = env.DEV_OWNER_USER_ID ?? "dev-owner";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (appEnv !== "production" && !token) {
    getOrbitStore(devOwner).ensureOwner(devOwner, "you@orbit.local", devOwner === "dev-owner");
    return { userId: devOwner, email: "you@orbit.local", accessAuthenticated: false };
  }
  if (!token) throw new ServiceError(401, "AUTH_REQUIRED", "認証が必要です。");
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  const userId = env.OWNER_USER_ID;
  const ownerEmail = env.OWNER_EMAIL;
  if (!teamDomain || !audience || !userId || !ownerEmail)
    throw new ServiceError(401, "AUTH_REQUIRED", "認証設定が未完了です。");
  try {
    const issuer = `https://${teamDomain}.cloudflareaccess.com`;
    let jwks = jwksCache.get(issuer);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      jwksCache.set(issuer, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    const email = typeof payload.email === "string" ? payload.email : "";
    if (email.toLowerCase() !== ownerEmail.toLowerCase())
      throw new ServiceError(401, "AUTH_REQUIRED", "認証情報を確認できません。");
    const database = (env as RuntimeEnv & { DB?: D1Database }).DB;
    if (!database)
      throw new ServiceError(401, "AUTH_REQUIRED", "所有者データベースを確認できません。");
    const owner = await findOwnedUser(createDb({ DB: database }), userId, email);
    if (!owner) throw new ServiceError(401, "AUTH_REQUIRED", "所有者を確認できません。");
    getOrbitStore(userId).ensureOwner(userId, owner.email);
    return { userId, email, accessAuthenticated: true };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(401, "AUTH_REQUIRED", "認証情報を確認できません。");
  }
}
