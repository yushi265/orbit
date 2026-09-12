import { resolveOwner, runtimeEnv, OwnerContext, type RuntimeEnvironment } from "./auth";
import { resolveLocalOrigins, resolveRuntimeConfig } from "./runtime-config";
import { ServiceError } from "./errors";
import { openStoreSession } from "./store-session";
import type { OrbitStore } from "./store";

export interface HandlerContext {
  owner: OwnerContext & { store: OrbitStore };
  requestId: string;
}

export interface HandlerDependencies {
  runtimeEnv?: () => Promise<RuntimeEnvironment>;
  resolveOwner?: typeof resolveOwner;
  openStoreSession?: typeof openStoreSession;
}

export function requestId(): string {
  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `req_${value}`;
}

export function json(data: unknown, status = 200, id = requestId()): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": id,
    },
  });
}

export function errorResponse(error: ServiceError, id: string): Response {
  return json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        requestId: id,
      },
    },
    error.status,
    id,
  );
}

export async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000)
    throw new ServiceError(400, "VALIDATION_ERROR", "リクエストが大きすぎます。");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not-object");
    return body as Record<string, unknown>;
  } catch {
    throw new ServiceError(400, "VALIDATION_ERROR", "JSON形式のリクエストを指定してください。");
  }
}

export async function withOwner(
  request: Request,
  handler: (context: HandlerContext) => Promise<Response>,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const id = requestId();
  try {
    const environment = (await (dependencies.runtimeEnv ?? runtimeEnv)()) as RuntimeEnvironment;
    const config = resolveRuntimeConfig(environment);
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (config.mode === "local") {
      const origins = resolveLocalOrigins(environment);
      const url = new URL(request.url);
      if (
        !origins.includes(url.origin) ||
        request.headers.get("Host") !== url.host ||
        (isMutation && request.headers.get("Origin") !== url.origin)
      )
        throw new ServiceError(400, "VALIDATION_ERROR", "ローカル接続元を確認してください。");
    }
    if (isMutation && request.headers.get("X-Requested-With") !== "XMLHttpRequest") {
      throw new ServiceError(400, "VALIDATION_ERROR", "同一OriginのMutationだけを受け付けます。");
    }
    const resolvedOwner = await (dependencies.resolveOwner ?? resolveOwner)(request, environment);
    const session = await (dependencies.openStoreSession ?? openStoreSession)(
      resolvedOwner.userId,
      resolvedOwner.email,
      environment,
    );
    const owner = { ...resolvedOwner, store: session.store };
    const response = await handler({ owner, requestId: id });
    if (response.ok && (isMutation || session.needsInitialPersist)) await session.persist();
    return response;
  } catch (error) {
    if (error instanceof ServiceError) return errorResponse(error, id);
    console.error(JSON.stringify({ requestId: id, error: "internal_error" }));
    return errorResponse(
      new ServiceError(500, "INTERNAL_ERROR", "予期しないエラーが発生しました。"),
      id,
    );
  }
}

export function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function keyFromRequest(request: Request): string {
  return (
    request.headers.get("Idempotency-Key") ??
    `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
