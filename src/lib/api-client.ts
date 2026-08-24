export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function requestKey(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ui-${uuid}`;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> } }
    | T
    | null;
  if (response.status === 401 && typeof window !== "undefined") {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/cdn-cgi/access/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
    throw new ApiError(
      response.status,
      error?.code ?? "NETWORK_ERROR",
      error?.message ?? "通信に失敗しました。",
      error?.fieldErrors,
    );
  }
  return payload as T;
}

export function idempotencyKey(): string {
  return requestKey();
}
export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  const headers = new Headers();
  if (
    body &&
    typeof body === "object" &&
    "idempotencyKey" in body &&
    typeof body.idempotencyKey === "string"
  ) {
    headers.set("Idempotency-Key", body.idempotencyKey);
  }
  return apiRequest<T>(path, { method: "POST", headers, body: JSON.stringify(body) });
}
export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}
export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, {
    method: "DELETE",
    headers: { "Idempotency-Key": idempotencyKey() },
  });
}
