import { describe, expect, it } from "vitest";
import {
  defaultProjectIssueDisplaySettings,
  type ProjectIssueDisplayOrder,
} from "../shared/contracts/project-display";
import { OrbitStore, type OrbitStoreSnapshot } from "./store";
import { decodeStoreSnapshot, encodeStoreSnapshot } from "./store-snapshot-compat";

const OWNER = "compat-owner";
const NOW = 1_800_000_000_000;
const viewQuery = {
  mode: "list" as const,
  filter: { due: "next7" as const },
  showEmptyGroups: false,
  order: "updated" as const,
  layout: { priority: true },
  limit: 100,
};
function fixture() {
  const store = new OrbitStore(() => NOW);
  store.ensureOwner(OWNER, "compat@example.com");
  const project = store.createProject(OWNER, { idempotencyKey: "project", name: "Compatibility" });
  return { store, project };
}

describe("D1 Snapshot rollback compatibility", () => {
  it("[同値分割] new reverse sort is persisted as a legacy value and restored without changing input", () => {
    const { store, project } = fixture();
    store.updateProjectDisplayPreferences(OWNER, project.id, {
      idempotencyKey: "settings",
      displayPreferences: { ...defaultProjectIssueDisplaySettings(), order: "updated_asc" },
    });
    const snapshot = store.toSnapshot();
    const before = structuredClone(snapshot);
    const persisted = encodeStoreSnapshot(snapshot) as OrbitStoreSnapshot;
    expect(persisted.projectDisplayPreferences[0].settings.order).toBe("updated_desc");
    expect(decodeStoreSnapshot(persisted)).toEqual(snapshot);
    expect(snapshot).toEqual(before);
  });
});

it.each([
  ["updated_asc", "updated_desc"],
  ["created_asc", "created_desc"],
  ["title_desc", "title_asc"],
  ["status_desc", "status_asc"],
  ["priority_asc", "priority_desc"],
  ["due_desc", "due_asc"],
] as const)("[同値分割] project %s projects to %s", (order: ProjectIssueDisplayOrder, legacy) => {
  const { store, project } = fixture();
  store.updateProjectDisplayPreferences(OWNER, project.id, {
    idempotencyKey: "sort",
    displayPreferences: { ...defaultProjectIssueDisplaySettings(), order, dueFilter: "next7" },
  });
  const saved = encodeStoreSnapshot(store.toSnapshot()) as OrbitStoreSnapshot;
  expect(saved.projectDisplayPreferences[0].settings).toMatchObject({
    order: legacy,
    dueFilter: "upcoming",
  });
  expect(decodeStoreSnapshot(saved)).toEqual(store.toSnapshot());
});
it("[同値分割] next7 search and saved view project only due and restore original query", () => {
  const { store } = fixture();
  store.recordRecentSearch(OWNER, { text: "fixture", filter: { due: "next7" } }, "search");
  store.createView(OWNER, { idempotencyKey: "view", name: "Seven days", query: viewQuery });
  const original = store.toSnapshot();
  const saved = encodeStoreSnapshot(original) as OrbitStoreSnapshot;
  expect(saved.recentSearches[0].query.filter.due).toBe("upcoming");
  expect(saved.views[0].query).toEqual({ ...viewQuery, filter: { due: "upcoming" } });
  const before = structuredClone(saved);
  expect(decodeStoreSnapshot(saved)).toEqual(original);
  expect(saved).toEqual(before);
});

const META = "__orbitRollback";
type RawRecord = Record<string, unknown>;
function raw(value: object): RawRecord {
  return value as unknown as RawRecord;
}
function newProjectSnapshot() {
  const { store, project } = fixture();
  store.updateProjectDisplayPreferences(OWNER, project.id, {
    idempotencyKey: "advanced",
    displayPreferences: {
      ...defaultProjectIssueDisplaySettings(),
      order: "title_desc",
      dueFilter: "next7",
    },
  });
  return store.toSnapshot();
}
it.each([
  { changed: false, receipt: "none", restored: true },
  { changed: true, receipt: "none", restored: false },
  { changed: false, receipt: "same", restored: false },
  { changed: true, receipt: "same", restored: false },
  { changed: false, receipt: "owner", restored: true },
  { changed: false, receipt: "record", restored: true },
  { changed: false, receipt: "operation", restored: true },
  { changed: false, receipt: "purge", restored: true },
])(
  "[デシジョンテーブル] legacy anchor=$changed receipt=$receipt restore=$restored",
  ({ changed, receipt, restored }) => {
    const saved = encodeStoreSnapshot(newProjectSnapshot()) as OrbitStoreSnapshot;
    if (changed) saved.projectDisplayPreferences[0].settings.filterText = "Legacy change";
    if (receipt === "purge") saved.receipts = [];
    else if (receipt !== "none") {
      const additional = structuredClone(
        saved.receipts.find((item) => item.operation === "project.displayPreferences.update")!,
      );
      additional.idempotencyKey = "legacy-save";
      delete raw(additional)[META];
      if (receipt === "owner") additional.userId = "other-owner";
      if (receipt === "record") {
        additional.response = { ...raw(additional.response as object), id: "other-preference" };
        additional.requestHash = 'project.displayPreferences.update\n{"projectId":"other-project"}';
      }
      if (receipt === "operation") additional.operation = "project.update";
      saved.receipts.push(additional);
    }
    const decoded = decodeStoreSnapshot(saved) as OrbitStoreSnapshot;
    expect(decoded.projectDisplayPreferences[0].settings.order).toBe(
      restored ? "title_desc" : "title_asc",
    );
    expect(decoded.projectDisplayPreferences[0].settings.filterText).toBe(
      changed ? "Legacy change" : "",
    );
    expect(raw(decoded.projectDisplayPreferences[0])).not.toHaveProperty(META);
  },
);

it.each([
  "version",
  "kind",
  "owner",
  "recordId",
  "value",
  "anchor",
  "anchorOwner",
  "receiptKeys",
  "null",
  "topLevel",
])(
  "[同値分割] invalid metadata %s fails closed with a fixed error and leaves input intact",
  (fault) => {
    const saved = encodeStoreSnapshot(newProjectSnapshot()) as OrbitStoreSnapshot;
    const item = raw(saved.projectDisplayPreferences[0]);
    const meta = raw(item[META] as object);
    if (fault === "version") meta.version = 2;
    if (fault === "kind") meta.kind = "views";
    if (fault === "owner") meta.userId = "other-owner";
    if (fault === "recordId") meta.recordId = "other-record";
    if (fault === "value") meta.value = { order: "secret-invalid" };
    if (fault === "anchor")
      raw(raw(meta.anchor as object).settings as object).order = "created_desc";
    if (fault === "anchorOwner") raw(meta.anchor as object).userId = "other-owner";
    if (fault === "receiptKeys") meta.receiptKeys = [42];
    if (fault === "null") item[META] = null;
    if (fault === "topLevel") raw(saved)[META] = meta;
    const before = structuredClone(saved);
    expect(() => decodeStoreSnapshot(saved)).toThrow(
      new Error("Invalid OrbitStore rollback metadata"),
    );
    expect(saved).toEqual(before);
  },
);

it("[状態遷移] persisted receipt responses stay legacy-readable and new retries restore even after records are deleted", () => {
  const { store, project } = fixture();
  store.updateProjectDisplayPreferences(OWNER, project.id, {
    idempotencyKey: "project-save",
    displayPreferences: { ...defaultProjectIssueDisplaySettings(), order: "due_desc" },
  });
  store.recordRecentSearch(OWNER, { text: "fixture", filter: { due: "next7" } }, "search-save");
  const view = store.createView(OWNER, {
    idempotencyKey: "view-save",
    name: "View",
    query: viewQuery,
  });
  store.updateView(OWNER, view.id, {
    idempotencyKey: "view-update",
    query: { ...viewQuery, mode: "board" },
  });
  const original = store.toSnapshot();
  const saved = encodeStoreSnapshot(original) as OrbitStoreSnapshot;
  for (const receipt of saved.receipts.filter((item) => item.operation !== "project.create")) {
    const source = original.receipts.find(
      (item) => item.idempotencyKey === receipt.idempotencyKey,
    )!;
    expect(raw(receipt)).toHaveProperty(META);
    expect(receipt.requestHash).toBe(source.requestHash);
    expect(receipt.createdAt).toBe(source.createdAt);
    expect(receipt.expiresAt).toBe(source.expiresAt);
    const response = raw(receipt.response as object);
    if (receipt.operation === "project.displayPreferences.update")
      expect(raw(response.settings as object).order).toBe("due_asc");
    else expect(raw(raw(response.query as object).filter as object).due).toBe("upcoming");
  }
  saved.projectDisplayPreferences = [];
  saved.recentSearches = [];
  saved.views = [];
  const decoded = decodeStoreSnapshot(saved) as OrbitStoreSnapshot;
  expect(decoded.receipts).toEqual(original.receipts);
});
it("[状態遷移] an old-created Receipt containing cloned inner metadata returns legacy response without metadata", () => {
  const saved = encodeStoreSnapshot(newProjectSnapshot()) as OrbitStoreSnapshot;
  const old = structuredClone(
    saved.receipts.find((item) => item.operation === "project.displayPreferences.update")!,
  );
  old.idempotencyKey = "legacy-retry";
  delete raw(old)[META];
  old.response = structuredClone(saved.projectDisplayPreferences[0]);
  saved.receipts.push(old);
  const decoded = decodeStoreSnapshot(saved) as OrbitStoreSnapshot;
  const response = raw(
    decoded.receipts.find((item) => item.idempotencyKey === "legacy-retry")!.response as object,
  );
  expect(response).not.toHaveProperty(META);
  expect(raw(response.settings as object).order).toBe("title_asc");
});

it.each(["rename", "layout", "querySame", "queryChanged"])(
  "[状態遷移/境界値] old Saved View %s preserves new query unless query is explicitly saved",
  (change) => {
    const { store } = fixture();
    const view = store.createView(OWNER, {
      idempotencyKey: "new-view",
      name: "Original",
      query: viewQuery,
    });
    const saved = encodeStoreSnapshot(store.toSnapshot());
    const legacy = OrbitStore.fromSnapshot(saved, () => NOW);
    if (change === "rename")
      legacy.updateView(OWNER, view.id, { idempotencyKey: "legacy-update", name: "Renamed" });
    if (change === "layout")
      legacy.updateView(OWNER, view.id, {
        idempotencyKey: "legacy-update",
        layout: { priority: false, due: true },
      });
    if (change === "querySame")
      legacy.updateView(OWNER, view.id, {
        idempotencyKey: "legacy-update",
        query: { ...viewQuery, filter: { due: "upcoming" } },
      });
    if (change === "queryChanged")
      legacy.updateView(OWNER, view.id, {
        idempotencyKey: "legacy-update",
        query: { ...viewQuery, filter: { due: "today" } },
      });
    const decoded = decodeStoreSnapshot(legacy.toSnapshot()) as OrbitStoreSnapshot;
    expect(decoded.views[0].query.filter.due).toBe(
      change === "querySame" ? "upcoming" : change === "queryChanged" ? "today" : "next7",
    );
    expect(decoded.views[0].name).toBe(change === "rename" ? "Renamed" : "Original");
    if (change === "layout") {
      expect(decoded.views[0].query.layout).toEqual({ priority: false, due: true });
      expect(decoded.views[0].layout).toEqual({ priority: false, due: true });
    }
    const retry = decoded.receipts.find((item) => item.idempotencyKey === "legacy-update")!;
    expect(raw(retry.response as object)).not.toHaveProperty(META);
  },
);
it.each(["newKey", "time", "unrelated"])(
  "[状態遷移/境界値] old Recent Search %s honors explicit same-value resave",
  (change) => {
    const { store } = fixture();
    store.recordRecentSearch(OWNER, { text: "fixture", filter: { due: "next7" } }, "new-search");
    const legacy = OrbitStore.fromSnapshot(encodeStoreSnapshot(store.toSnapshot()), () =>
      change === "time" ? NOW + 1 : NOW,
    );
    legacy.recordRecentSearch(
      OWNER,
      { text: change === "unrelated" ? "different" : "fixture", filter: { due: "upcoming" } },
      "old-search",
    );
    const decoded = decodeStoreSnapshot(legacy.toSnapshot()) as OrbitStoreSnapshot;
    const original = decoded.recentSearches.find((item) => item.query.text === "fixture")!;
    expect(original.query.filter.due).toBe(change === "unrelated" ? "next7" : "upcoming");
    expect(raw(original)).not.toHaveProperty(META);
  },
);

it("[同値分割] metadata-free legacy snapshot retains ordinary business edits and date carriers", () => {
  const { store, project } = fixture();
  const issue = store.createIssue(OWNER, {
    idempotencyKey: "ordinary",
    title: "Before",
    dueAt: 1_800_007_200_000,
    projectId: project.id,
  });
  const original = store.toSnapshot();
  expect(encodeStoreSnapshot(original)).toEqual(original);
  expect(decodeStoreSnapshot(original)).toEqual(original);
  store.updateIssue(OWNER, {
    id: issue.id,
    version: issue.version,
    idempotencyKey: "ordinary-edit",
    patch: { title: "After" },
  });
  store.createIssueNote(OWNER, issue.id, { idempotencyKey: "ordinary-note", body: "Preserved" });
  const saved = encodeStoreSnapshot(store.toSnapshot());
  expect(decodeStoreSnapshot(saved)).toEqual(store.toSnapshot());
  const reloaded = OrbitStore.fromSnapshot(decodeStoreSnapshot(saved), () => NOW);
  expect(reloaded.getIssueDetail(OWNER, issue.id)).toMatchObject({
    issue: { title: "After", dueAt: 1_800_007_200_000 },
    notes: [{ body: "Preserved" }],
  });
});
it.each(["recentSearches", "views", "receipts"] as const)(
  "[同値分割] %s metadata validates identity, original value, anchor, keys and version",
  (kind) => {
    const { store } = fixture();
    store.recordRecentSearch(OWNER, { text: "fixture", filter: { due: "next7" } }, "check-search");
    store.createView(OWNER, { idempotencyKey: "check-view", name: "Check", query: viewQuery });
    const saved = encodeStoreSnapshot(store.toSnapshot()) as OrbitStoreSnapshot;
    const index =
      kind === "receipts"
        ? saved.receipts.findIndex((item) => item.operation === "recent.search")
        : 0;
    for (const fault of [
      "version",
      "kind",
      "userId",
      "recordId",
      "value",
      "anchor",
      "receiptKeys",
      "unknownField",
    ]) {
      const corrupted = structuredClone(saved);
      const meta = raw(raw(corrupted[kind][index])[META] as object);
      if (fault === "version") meta.version = 0;
      if (fault === "kind") meta.kind = "futureCollection";
      if (fault === "userId" || fault === "recordId") meta[fault] = "different";
      if (fault === "value") meta.value = {};
      if (fault === "anchor") raw(meta.anchor as object).userId = "different";
      if (fault === "receiptKeys") meta.receiptKeys = [42];
      if (fault === "unknownField") meta.future = true;
      expect(() => decodeStoreSnapshot(corrupted), fault).toThrow(
        new Error("Invalid OrbitStore rollback metadata"),
      );
    }
  },
);
it("[同値分割] invalid non-JSON metadata anchor is rejected with the fixed error", () => {
  const saved = encodeStoreSnapshot(newProjectSnapshot()) as OrbitStoreSnapshot;
  raw(raw(raw(saved.projectDisplayPreferences[0])[META] as object).anchor as object).future =
    Number.POSITIVE_INFINITY;
  expect(() => decodeStoreSnapshot(saved)).toThrow(
    new Error("Invalid OrbitStore rollback metadata"),
  );
});

it.each(["version", "owner", "operation"])(
  "[同値分割] old Receipt inner metadata %s is validated before stripping",
  (fault) => {
    const saved = encodeStoreSnapshot(newProjectSnapshot()) as OrbitStoreSnapshot;
    const old = structuredClone(
      saved.receipts.find((item) => item.operation === "project.displayPreferences.update")!,
    );
    old.idempotencyKey = "old-inner-invalid";
    delete raw(old)[META];
    old.response = structuredClone(saved.projectDisplayPreferences[0]);
    const inner = raw(raw(old.response as object)[META] as object);
    if (fault === "version") inner.version = 2;
    if (fault === "owner") inner.userId = "different-owner";
    if (fault === "operation") old.operation = "issue.update";
    saved.receipts.push(old);
    expect(() => decodeStoreSnapshot(saved)).toThrow(
      new Error("Invalid OrbitStore rollback metadata"),
    );
  },
);

function boundarySnapshot() {
  const { store, project } = fixture();
  store.updateProjectDisplayPreferences(OWNER, project.id, {
    idempotencyKey: "boundary-settings",
    displayPreferences: { ...defaultProjectIssueDisplaySettings(), order: "updated_asc" },
  });
  store.recordRecentSearch(
    OWNER,
    { text: "boundary", filter: { due: "next7" } },
    "boundary-search",
  );
  store.createView(OWNER, { idempotencyKey: "boundary-view", name: "Boundary", query: viewQuery });
  return encodeStoreSnapshot(store.toSnapshot()) as OrbitStoreSnapshot;
}
it.each(["userId", "recordId", "projectId", "viewName", "requestHash", "receiptKey"])(
  "[境界値] empty %s remains invalid when record and metadata identities agree",
  (field) => {
    const saved = boundarySnapshot();
    const item = raw(
      field === "viewName"
        ? saved.views[0]
        : field === "requestHash" || field === "receiptKey"
          ? saved.receipts.find(
              (receipt) => receipt.operation === "project.displayPreferences.update",
            )!
          : saved.projectDisplayPreferences[0],
    );
    const meta = raw(item[META] as object);
    const anchor = raw(meta.anchor as object);
    if (field === "userId") item.userId = meta.userId = anchor.userId = "";
    if (field === "recordId") item.id = meta.recordId = anchor.id = "";
    if (field === "projectId") item.projectId = anchor.projectId = "";
    if (field === "viewName") item.name = anchor.name = "";
    if (field === "requestHash") item.requestHash = anchor.requestHash = "";
    if (field === "receiptKey") item.idempotencyKey = meta.recordId = anchor.idempotencyKey = "";
    if (field !== "requestHash" && field !== "receiptKey") saved.receipts = [];
    const before = structuredClone(saved);
    expect(() => decodeStoreSnapshot(saved)).toThrow(
      new Error("Invalid OrbitStore rollback metadata"),
    );
    expect(saved).toEqual(before);
  },
);
it.each([
  { keys: [], accepted: true },
  { keys: ["retained-receipt"], accepted: true },
  { keys: [""], accepted: false },
  { keys: ["retained-receipt", "retained-receipt"], accepted: false },
])("[境界値] receipt keys $keys accepted=$accepted", ({ keys, accepted }) => {
  const saved = boundarySnapshot();
  saved.receipts = [];
  raw(raw(saved.projectDisplayPreferences[0])[META] as object).receiptKeys = keys;
  const before = structuredClone(saved);
  if (accepted) {
    const decoded = decodeStoreSnapshot(saved) as OrbitStoreSnapshot;
    expect(decoded.projectDisplayPreferences[0].settings.order).toBe("updated_asc");
    expect(raw(decoded.projectDisplayPreferences[0])).not.toHaveProperty(META);
  } else {
    expect(() => decodeStoreSnapshot(saved)).toThrow(
      new Error("Invalid OrbitStore rollback metadata"),
    );
  }
  expect(saved).toEqual(before);
});
const timestampFields = [
  ["projectDisplayPreferences", "updatedAt"],
  ["recentSearches", "searchedAt"],
  ["views", "createdAt"],
  ["views", "updatedAt"],
  ["receipts", "createdAt"],
  ["receipts", "expiresAt"],
] as const;
const timestampBoundaries = [
  { value: Number.MIN_SAFE_INTEGER - 1, accepted: false },
  { value: Number.MIN_SAFE_INTEGER, accepted: true },
  { value: Number.MIN_SAFE_INTEGER + 1, accepted: true },
  { value: Number.MAX_SAFE_INTEGER - 1, accepted: true },
  { value: Number.MAX_SAFE_INTEGER, accepted: true },
  { value: Number.MAX_SAFE_INTEGER + 1, accepted: false },
  { value: 0.5, accepted: false },
];
it.each(
  timestampFields.flatMap(([kind, field]) =>
    timestampBoundaries.map((boundary) => ({ kind, field, ...boundary })),
  ),
)("[境界値] $kind.$field=$value accepted=$accepted", ({ kind, field, value, accepted }) => {
  const saved = boundarySnapshot();
  const item = raw(
    kind === "receipts"
      ? saved.receipts.find((receipt) => receipt.operation === "project.displayPreferences.update")!
      : saved[kind][0],
  );
  const meta = raw(item[META] as object);
  item[field] = raw(meta.anchor as object)[field] = value;
  const before = structuredClone(saved);
  if (accepted) {
    const decoded = decodeStoreSnapshot(saved) as OrbitStoreSnapshot;
    const restored =
      kind === "receipts"
        ? decoded.receipts.find(
            (receipt) => receipt.operation === "project.displayPreferences.update",
          )!
        : decoded[kind][0];
    expect(raw(restored)[field]).toBe(value);
    expect(raw(restored)).not.toHaveProperty(META);
  } else {
    expect(() => decodeStoreSnapshot(saved)).toThrow(
      new Error("Invalid OrbitStore rollback metadata"),
    );
  }
  expect(saved).toEqual(before);
});
