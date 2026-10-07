import { resolveOwner, runtimeEnv, OwnerContext, type RuntimeEnvironment } from "./auth";
import { resolveLocalOrigins, resolveRuntimeConfig } from "./runtime-config";
import { ServiceError, validationError } from "./errors";
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

const MAX_BODY_BYTES = 1_000_000;

function bodyTooLarge(): ServiceError {
  return new ServiceError(400, "VALIDATION_ERROR", "リクエストが大きすぎます。");
}

// content-length は自己申告なので早期拒否にだけ使い、上限は実際に読んだバイト数で判定する。
async function readBodyText(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw bodyTooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw bodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const text = await readBodyText(request);
  try {
    const body: unknown = JSON.parse(text);
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
    let response: Response;
    try {
      response = await handler({ owner, requestId: id });
    } catch (error) {
      if (
        request.method === "POST" &&
        new URL(request.url).pathname === "/api/v1/background-runs" &&
        error instanceof ServiceError &&
        error.status === 423 &&
        error.code === "OPERATION_IN_PROGRESS" &&
        session.store.hasRejectedRunStateChanges()
      )
        await session.persist();
      throw error;
    }
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

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key");
  if (!key) throw validationError({ idempotencyKey: ["Idempotency-Keyを指定してください。"] });
  return key;
}
