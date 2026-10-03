import { projectIssueDisplaySettingsSchema } from "../shared/contracts/project-display";
import { issueSearchQuerySchema } from "../shared/contracts/issue-core";
import { issueQuerySchema } from "../shared/contracts/issues";
import { canonicalJson } from "../shared/canonical-json";
import type { OrbitStoreSnapshot } from "./store";

const META = "__orbitRollback";
type RecordValue = Record<string, unknown>;
const legacyOrder: Record<string, string> = {
  updated_asc: "updated_desc",
  created_asc: "created_desc",
  title_desc: "title_asc",
  status_desc: "status_asc",
  priority_asc: "priority_desc",
  due_desc: "due_asc",
};
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function projectSettings(value: unknown): unknown {
  if (!record(value)) return value;
  return {
    ...value,
    order:
      typeof value.order === "string" ? (legacyOrder[value.order] ?? value.order) : value.order,
    dueFilter: value.dueFilter === "next7" ? "upcoming" : value.dueFilter,
  };
}
type RecordKind = "projectDisplayPreferences" | "recentSearches" | "views";
type Kind = RecordKind | "receipts";
function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
function withoutMeta(item: RecordValue): RecordValue {
  const result = { ...item };
  delete result[META];
  return result;
}
function payload(receipt: RecordValue): RecordValue | null {
  if (typeof receipt.requestHash !== "string") return null;
  const newline = receipt.requestHash.indexOf("\n");
  if (receipt.requestHash.slice(0, newline) !== receipt.operation) return null;
  try {
    const value: unknown = JSON.parse(receipt.requestHash.slice(newline + 1));
    return record(value) ? value : null;
  } catch {
    return null;
  }
}
function receiptKeys(kind: RecordKind, item: RecordValue, receipts: unknown[]): string[] {
  return receipts
    .filter((receipt): receipt is RecordValue => {
      if (
        !record(receipt) ||
        receipt.userId !== item.userId ||
        typeof receipt.idempotencyKey !== "string"
      )
        return false;
      const response = record(receipt.response) ? receipt.response : null;
      const request = payload(receipt);
      if (kind === "projectDisplayPreferences")
        return (
          receipt.operation === "project.displayPreferences.update" &&
          (request?.projectId === item.projectId || response?.id === item.id)
        );
      if (kind === "recentSearches")
        return receipt.operation === "recent.search" && response?.id === item.id;
      return (
        response?.id === item.id &&
        (receipt.operation === "view.create" ||
          (receipt.operation === "view.update" &&
            request !== null &&
            Object.hasOwn(request, "query")))
      );
    })
    .map((receipt) => receipt.idempotencyKey as string)
    .sort();
}
type Metadata = {
  version: 1;
  kind: Kind;
  userId: string;
  recordId: string;
  value: unknown;
  anchor: RecordValue;
  receiptKeys: string[];
};
function invalid(): never {
  throw new Error("Invalid OrbitStore rollback metadata");
}
function string(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function timestamp(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function validValue(kind: RecordKind, value: unknown): boolean {
  if (kind === "projectDisplayPreferences")
    return projectIssueDisplaySettingsSchema.safeParse(value).success;
  if (kind === "recentSearches") return issueSearchQuerySchema.safeParse(value).success;
  return issueQuerySchema.safeParse(value).success;
}
function validAnchor(kind: RecordKind, anchor: RecordValue): boolean {
  if (!string(anchor.id) || !string(anchor.userId) || Object.hasOwn(anchor, META)) return false;
  if (kind === "projectDisplayPreferences")
    return (
      string(anchor.projectId) && timestamp(anchor.updatedAt) && validValue(kind, anchor.settings)
    );
  if (kind === "recentSearches")
    return timestamp(anchor.searchedAt) && validValue(kind, anchor.query);
  return (
    string(anchor.name) &&
    timestamp(anchor.createdAt) &&
    timestamp(anchor.updatedAt) &&
    record(anchor.layout) &&
    Object.values(anchor.layout).every((value) => typeof value === "boolean") &&
    validValue(kind, anchor.query)
  );
}
function receiptKind(operation: unknown): RecordKind | null {
  if (operation === "project.displayPreferences.update") return "projectDisplayPreferences";
  if (operation === "recent.search") return "recentSearches";
  if (operation === "view.create" || operation === "view.update") return "views";
  return null;
}
function stripResponseMeta(receipt: RecordValue): unknown {
  const value = receipt.response;
  if (!record(value) || !Object.hasOwn(value, META)) return value;
  const kind = receiptKind(receipt.operation);
  if (kind === null || value.userId !== receipt.userId) invalid();
  // Old Store writes can clone a record's sidecar into the response. Validate it,
  // but only a Receipt's own sidecar may restore an original retry response.
  metadata(kind, value);
  return withoutMeta(value);
}
function receiptResponse(value: unknown, operation: unknown): unknown {
  const kind = receiptKind(operation);
  if (!kind || !record(value)) return value;
  const response = withoutMeta(value);
  const field = kind === "projectDisplayPreferences" ? "settings" : "query";
  return {
    ...response,
    [field]:
      kind === "projectDisplayPreferences"
        ? projectSettings(response[field])
        : query(response[field]),
  };
}
function validReceiptAnchor(anchor: RecordValue): boolean {
  const kind = receiptKind(anchor.operation);
  return (
    kind !== null &&
    string(anchor.userId) &&
    string(anchor.idempotencyKey) &&
    string(anchor.requestHash) &&
    timestamp(anchor.createdAt) &&
    timestamp(anchor.expiresAt) &&
    !Object.hasOwn(anchor, META) &&
    record(anchor.response) &&
    anchor.response.userId === anchor.userId &&
    validAnchor(kind, anchor.response)
  );
}
function metadata(kind: Kind, item: RecordValue): Metadata {
  const value = item[META];
  try {
    canonicalJson(value);
  } catch {
    invalid();
  }
  const idField = kind === "receipts" ? "idempotencyKey" : "id";
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !==
      "anchor,kind,receiptKeys,recordId,userId,value,version" ||
    value.version !== 1 ||
    value.kind !== kind ||
    !string(value.userId) ||
    value.userId !== item.userId ||
    !string(value.recordId) ||
    value.recordId !== item[idField] ||
    !record(value.anchor) ||
    value.anchor.userId !== value.userId ||
    value.anchor[idField] !== value.recordId ||
    !Array.isArray(value.receiptKeys) ||
    !value.receiptKeys.every(string) ||
    new Set(value.receiptKeys).size !== value.receiptKeys.length
  )
    invalid();
  if (kind === "receipts") {
    const responseKind = receiptKind(value.anchor.operation);
    if (
      !validReceiptAnchor(value.anchor) ||
      responseKind === null ||
      value.receiptKeys.length !== 0 ||
      !record(value.value) ||
      value.value.userId !== value.userId ||
      !validAnchor(responseKind, value.value) ||
      value.value.id !== (value.anchor.response as RecordValue).id
    )
      invalid();
    const projected = receiptResponse(value.value, value.anchor.operation);
    if (equal(value.value, projected) || !equal(projected, value.anchor.response)) invalid();
  } else {
    if (!validAnchor(kind, value.anchor) || !validValue(kind, value.value)) invalid();
    const field = kind === "projectDisplayPreferences" ? "settings" : "query";
    const projected =
      kind === "projectDisplayPreferences" ? projectSettings(value.value) : query(value.value);
    if (equal(value.value, projected) || !equal(projected, value.anchor[field])) invalid();
  }
  return value as Metadata;
}
function query(value: unknown): unknown {
  if (!record(value) || !record(value.filter) || value.filter.due !== "next7") return value;
  return { ...value, filter: { ...value.filter, due: "upcoming" } };
}
export function encodeStoreSnapshot(snapshot: OrbitStoreSnapshot): unknown {
  const result = structuredClone(snapshot);
  for (const kind of ["projectDisplayPreferences", "recentSearches", "views"] as const) {
    for (const entry of result[kind]) {
      const item = entry as unknown as RecordValue;
      const field = kind === "projectDisplayPreferences" ? "settings" : "query";
      const value = item[field];
      const projected =
        kind === "projectDisplayPreferences" ? projectSettings(value) : query(value);
      if (JSON.stringify(value) === JSON.stringify(projected)) continue;
      item[field] = projected;
      item[META] = {
        version: 1,
        kind,
        userId: item.userId,
        recordId: item.id,
        value,
        anchor: structuredClone(item),
        receiptKeys: receiptKeys(kind, item, result.receipts),
      };
    }
  }
  for (const receipt of result.receipts) {
    const item = receipt as unknown as RecordValue;
    const value = item.response;
    const projected = receiptResponse(value, item.operation);
    if (equal(value, projected)) continue;
    item.response = projected;
    item[META] = {
      version: 1,
      kind: "receipts",
      userId: item.userId,
      recordId: item.idempotencyKey,
      value,
      anchor: structuredClone(item),
      receiptKeys: [],
    };
  }
  return result;
}
function queryWithoutLayout(value: unknown): unknown {
  if (!record(value)) return value;
  const result = { ...value };
  delete result.layout;
  return result;
}
function anchorMatches(kind: RecordKind, item: RecordValue, anchor: RecordValue): boolean {
  if (kind === "views")
    return equal(queryWithoutLayout(item.query), queryWithoutLayout(anchor.query));
  return equal(withoutMeta(item), anchor);
}
export function decodeStoreSnapshot(snapshot: unknown): unknown {
  const result = structuredClone(snapshot);
  if (!record(result)) return result;
  if (Object.hasOwn(result, META)) invalid();
  for (const kind of ["projectDisplayPreferences", "recentSearches", "views"] as const) {
    if (!Array.isArray(result[kind])) continue;
    for (const item of result[kind]) {
      if (!record(item) || !Object.hasOwn(item, META)) continue;
      const meta = metadata(kind, item);
      const keys = receiptKeys(kind, item, Array.isArray(result.receipts) ? result.receipts : []);
      if (
        anchorMatches(kind, item, meta.anchor) &&
        keys.every((key) => meta.receiptKeys.includes(key))
      ) {
        item[kind === "projectDisplayPreferences" ? "settings" : "query"] =
          kind === "views" && record(item.query)
            ? { ...(meta.value as RecordValue), layout: item.query.layout }
            : meta.value;
      }
      delete item[META];
    }
  }
  if (Array.isArray(result.receipts)) {
    for (const item of result.receipts) {
      if (!record(item)) continue;
      if (Object.hasOwn(item, META)) {
        const meta = metadata("receipts", item);
        if (equal(withoutMeta(item), meta.anchor)) item.response = meta.value;
        delete item[META];
      }
      item.response = stripResponseMeta(item);
    }
  }
  return result;
}
