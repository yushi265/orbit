import { issueFilterSchema, normalizeIssueFilter, type IssueFilter } from "./contracts/issues";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

const sortableArrayKeys = new Set([
  "statusIds",
  "priorities",
  "labelIds",
  "projectIds",
  "cycleIds",
]);

function normalizeValue(
  value: unknown,
  key?: string,
  requestMode = false,
): CanonicalJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON は有限数だけを扱えます。");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Canonical JSON は JSON 値だけを扱えます。");
  }

  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeValue(item, undefined, requestMode) ?? null);
    if (requestMode && key !== undefined && sortableArrayKeys.has(key)) {
      return [...new Set(normalized.map((item) => JSON.stringify(item)))]
        .map((item) => JSON.parse(item))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ) as CanonicalJsonValue[];
    }
    return normalized;
  }

  const normalizedObject: Record<string, CanonicalJsonValue> = {};
  for (const objectKey of Object.keys(value).sort()) {
    if (requestMode && objectKey === "idempotencyKey") {
      continue;
    }

    const normalized = normalizeValue(
      (value as Record<string, unknown>)[objectKey],
      objectKey,
      requestMode,
    );
    if (normalized === undefined) {
      continue;
    }
    if (
      requestMode &&
      ((sortableArrayKeys.has(objectKey) && Array.isArray(normalized) && normalized.length === 0) ||
        (objectKey === "created" &&
          normalized !== null &&
          typeof normalized === "object" &&
          !Array.isArray(normalized) &&
          Object.keys(normalized).length === 0))
    ) {
      continue;
    }
    normalizedObject[objectKey] = normalized;
  }
  return normalizedObject;
}

export function canonicalize(value: unknown): CanonicalJsonValue | undefined {
  return normalizeValue(value);
}

export function canonicalJson(value: unknown): string {
  const normalized = canonicalize(value);
  return JSON.stringify(normalized === undefined ? null : normalized);
}

export function canonicalRequestPayload(value: unknown): CanonicalJsonValue | undefined {
  return normalizeValue(value, undefined, true);
}

export async function hashCanonicalRequest(operation: string, payload: unknown): Promise<string> {
  if (operation.length === 0) {
    throw new TypeError("operation は空にできません。");
  }

  const input = `${operation}\n${canonicalJson(canonicalRequestPayload(payload))}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalMutationJson(operation: string, payload: unknown): string {
  if (operation.length === 0) throw new TypeError("operation は空にできません。");
  return `${operation}\n${canonicalJson(canonicalRequestPayload(payload))}`;
}

export const hashRequest = hashCanonicalRequest;
export const canonicalizeRequest = canonicalRequestPayload;

export function canonicalizeIssueFilter(filter: IssueFilter): IssueFilter {
  return normalizeIssueFilter(issueFilterSchema.parse(filter));
}
