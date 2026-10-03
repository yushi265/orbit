import {
  BackgroundRun,
  BootstrapPayload,
  Cycle,
  CycleSettings,
  Issue,
  Label,
  IssueDetail,
  IssueNote,
  IssueRelation,
  IssueRelationType,
  IssueRelationView,
  IssueListScope,
  IssueSummary,
  IssueQuery,
  Notification,
  Preferences,
  Project,
  ProjectDisplayPreference,
  ProjectStatus,
  PublicRunSummary,
  SavedView,
  User,
  WorkflowState,
  ActivityEvent,
  MutationReceipt,
  OutboxEvent,
  RunStep,
  RunStatus,
  RecentIssueViewRecord,
  RecentSearchRecord,
  priorities,
  runSteps,
  workflowCategories,
} from "./model";
import { conflict, locked, notFound, validationError } from "./errors";
import { canonicalMutationJson } from "../shared/canonical-json";
import {
  colorThemeValues,
  labelColorSchema,
  labelNameSchema,
  type BulkIssueMutation,
  type CycleMetadataMutation,
  type CycleScheduleMutation,
  type CycleSettingsMutation,
  type LabelMutation,
  type LabelUpdate,
  type PreferencesMutation,
  type ProjectDisplayPreferencesMutation,
  type ReorderIssueInput,
  type SavedViewUpdate,
  type WorkflowStateCreateMutation,
  type WorkflowStateUpdateMutation,
  issueSearchQuerySchema,
  projectIssueDisplaySettingsSchema,
  defaultProjectIssueDisplaySettings,
  type IssueSearchQuery,
  isValidTimeZone,
  workflowStateColorSchema,
  workflowStateNameSchema,
} from "../shared/contracts";
import { calculateCycleMetrics, type CycleMetrics } from "../shared/cycle-workspace";
import { matchesIssueDueDate } from "../shared/issue-dates";
import type { CycleHistoryViewModel } from "../shared/view-models";
import { cycleEndAt, localDateAtMidnight, nextCycleStartAt } from "./cycle-schedule";

export type OrbitStoreLock = {
  userId: string;
  runId: string | null;
  token: string | null;
  status: "idle" | "running";
  leaseExpiresAt: number | null;
};

export interface OrbitStoreSnapshot {
  users: User[];
  preferences: Preferences[];
  workflowStates: WorkflowState[];
  projectStatuses: ProjectStatus[];
  projects: Project[];
  projectDisplayPreferences: ProjectDisplayPreference[];
  cycles: Cycle[];
  cycleSettings: CycleSettings[];
  issues: Issue[];
  labels: Label[];
  notes: IssueNote[];
  relations: IssueRelation[];
  recentIssueViews: RecentIssueViewRecord[];
  recentSearches: RecentSearchRecord[];
  views: SavedView[];
  notifications: Notification[];
  activities: ActivityEvent[];
  outbox: OutboxEvent[];
  receipts: MutationReceipt[];
  runs: BackgroundRun[];
  locks: OrbitStoreLock[];
  cycleHistory: Array<{
    id: string;
    userId: string;
    issueId: string;
    fromCycleId: string;
    toCycleId: string;
    movedAt: number;
  }>;
  seededUsers: string[];
}

type IssuePatch = Partial<
  Pick<
    Issue,
    | "title"
    | "description"
    | "statusId"
    | "priority"
    | "estimate"
    | "dueAt"
    | "projectId"
    | "cycleId"
    | "parentId"
    | "labelIds"
  >
>;

export interface CreateIssueInput {
  idempotencyKey: string;
  title: string;
  description?: string;
  statusId?: string;
  priority?: Issue["priority"];
  estimate?: Issue["estimate"];
  dueAt?: number | null;
  projectId?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  labelIds?: string[];
}

export interface UpdateIssueInput {
  id: string;
  idempotencyKey: string;
  version: number;
  patch: IssuePatch;
}

export type { ReorderIssueInput };

export interface NoteMutationInput {
  idempotencyKey: string;
  body: string;
}
export interface RelationMutationInput {
  idempotencyKey: string;
  targetIssueId: string;
  type: IssueRelationType;
}
export type UpdateCycleMetadataInput = CycleMetadataMutation;
export type UpdateCycleScheduleInput = CycleScheduleMutation;
export type UpdateCycleSettingsInput = CycleSettingsMutation;

export interface CreateProjectInput {
  idempotencyKey: string;
  name: string;
  description?: string;
  statusId?: string;
  priority?: Project["priority"];
  color?: string;
  icon?: string;
  startAt?: number | null;
  targetAt?: number | null;
}

export interface UpdateProjectInput {
  id: string;
  idempotencyKey: string;
  patch: Partial<Omit<CreateProjectInput, "idempotencyKey">>;
}

export interface CreateViewInput {
  idempotencyKey: string;
  name: string;
  query: IssueQuery;
  layout?: Record<string, boolean>;
}
export type UpdateViewInput = SavedViewUpdate;
export type CreateLabelInput = LabelMutation;
export type UpdateLabelInput = LabelUpdate;
export type BulkIssueInput = BulkIssueMutation;
export type PreferencesInput = PreferencesMutation;
export type WorkflowStateCreateInput = WorkflowStateCreateMutation;
export type WorkflowStateUpdateInput = WorkflowStateUpdateMutation;

export interface MaintenanceRunInput {
  kind: "maintenance";
  idempotencyKey: string;
}

export interface ContinueRunInput {
  idempotencyKey: string;
  expected_cursor: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * DAY;
const RECEIPT_TTL = DAY;
const RUN_LEASE_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const CHUNK_SIZE = 25;
export const backgroundRuntimeConfig = { CHUNK_SIZE, RUN_LEASE_MS, HEARTBEAT_INTERVAL_MS } as const;

export function nowMs(): number {
  return Date.now();
}

export function createId(prefix = "id"): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}-${Date.now()}`;
  return `${prefix}_${uuid}`;
}

export function requestHash(operation: string, input: unknown): string {
  return canonicalMutationJson(operation, input);
}

function validateKey(key: string): void {
  if (typeof key !== "string" || key.trim().length < 1 || key.length > 200) {
    throw validationError({ idempotencyKey: ["1〜200文字のキーを指定してください。"] });
  }
}

function validateTitle(title: string): void {
  const length = [...title].length;
  if (length < 1 || length > 255)
    throw validationError({ title: ["タイトルは1〜255文字で入力してください。"] });
}

function validateNoteBody(body: string): void {
  const length = [...body].length;
  if (length < 1 || length > 10_000)
    throw validationError({ body: ["メモは1〜10,000文字で入力してください。"] });
}

function relationTypeFromPerspective(
  type: IssueRelationType,
  isSource: boolean,
): IssueRelationType {
  if (isSource) return type;
  if (type === "blocking") return "blocked_by";
  if (type === "blocked_by") return "blocking";
  return type;
}

function defaultQuery(): IssueQuery {
  return {
    mode: "list",
    filter: {},
    showEmptyGroups: false,
    order: "manual",
    layout: {
      priority: true,
      status: true,
      project: true,
      cycle: true,
      estimate: true,
      dueAt: true,
    },
    limit: 100,
  };
}

export class OrbitStore {
  readonly users = new Map<string, User>();
  readonly preferences = new Map<string, Preferences>();
  readonly workflowStates = new Map<string, WorkflowState>();
  readonly projectStatuses = new Map<string, ProjectStatus>();
  readonly projects = new Map<string, Project>();
  readonly projectDisplayPreferences = new Map<string, ProjectDisplayPreference>();
  readonly cycles = new Map<string, Cycle>();
  readonly cycleSettings = new Map<string, CycleSettings>();
  readonly issues = new Map<string, Issue>();
  readonly labels = new Map<string, Label>();
  readonly notes = new Map<string, IssueNote>();
  readonly relations = new Map<string, IssueRelation>();
  readonly recentIssueViews = new Map<string, RecentIssueViewRecord>();
  readonly recentSearches = new Map<string, RecentSearchRecord>();
  readonly views = new Map<string, SavedView>();
  readonly notifications = new Map<string, Notification>();
  readonly activities: ActivityEvent[] = [];
  readonly outbox: OutboxEvent[] = [];
  readonly receipts = new Map<string, MutationReceipt>();
  readonly runs = new Map<string, BackgroundRun>();
  readonly locks = new Map<string, OrbitStoreLock>();
  readonly cycleHistory: Array<{
    id: string;
    userId: string;
    issueId: string;
    fromCycleId: string;
    toCycleId: string;
    movedAt: number;
  }> = [];
  private seededUsers = new Set<string>();
  private backgroundStateDirty = false;
  private rejectedRunStateDirty = false;

  constructor(private readonly clock: () => number = nowMs) {}

  toSnapshot(): OrbitStoreSnapshot {
    return structuredClone({
      users: [...this.users.values()],
      preferences: [...this.preferences.values()],
      workflowStates: [...this.workflowStates.values()],
      projectStatuses: [...this.projectStatuses.values()],
      projects: [...this.projects.values()],
      projectDisplayPreferences: [...this.projectDisplayPreferences.values()],
      cycles: [...this.cycles.values()],
      cycleSettings: [...this.cycleSettings.values()],
      issues: [...this.issues.values()],
      labels: [...this.labels.values()],
      notes: [...this.notes.values()],
      relations: [...this.relations.values()],
      recentIssueViews: [...this.recentIssueViews.values()],
      recentSearches: [...this.recentSearches.values()],
      views: [...this.views.values()],
      notifications: [...this.notifications.values()],
      activities: this.activities,
      outbox: this.outbox,
      receipts: [...this.receipts.values()],
      runs: [...this.runs.values()],
      locks: [...this.locks.values()],
      cycleHistory: this.cycleHistory,
      seededUsers: [...this.seededUsers],
    });
  }

  static fromSnapshot(
    snapshot: unknown,
    clock: () => number = nowMs,
    ownerUserId?: string,
  ): OrbitStore {
    const normalizedValue = structuredClone(snapshot);
    if (!normalizedValue || typeof normalizedValue !== "object" || Array.isArray(normalizedValue))
      throw new Error("Invalid OrbitStore snapshot");
    const normalized = normalizedValue as Record<string, unknown>;
    if (!Array.isArray(normalized.recentIssueViews)) normalized.recentIssueViews = [];
    if (!Array.isArray(normalized.recentSearches)) normalized.recentSearches = [];
    if (!Array.isArray(normalized.projectDisplayPreferences))
      normalized.projectDisplayPreferences = [];
    if (Array.isArray(normalized.preferences)) {
      normalized.preferences = normalized.preferences.map((preference) => {
        if (
          preference &&
          typeof preference === "object" &&
          !Array.isArray(preference) &&
          !("colorTheme" in preference)
        )
          return { ...preference, colorTheme: "coral" };
        return preference;
      });
    }
    if (Array.isArray(normalized.cycleSettings)) {
      normalized.cycleSettings = normalized.cycleSettings.map((setting) => {
        if (
          setting &&
          typeof setting === "object" &&
          !Array.isArray(setting) &&
          !("autoAddToCurrentCycle" in setting)
        )
          return { ...setting, autoAddToCurrentCycle: false };
        return setting;
      });
    }
    if (!OrbitStore.isSnapshot(normalized, ownerUserId))
      throw new Error("Invalid OrbitStore snapshot");
    const source = structuredClone(normalized);
    const store = new OrbitStore(clock);
    store.restoreSnapshot(source);
    return store;
  }

  private restoreSnapshot(source: OrbitStoreSnapshot): void {
    const setById = <T extends { id: string }>(target: Map<string, T>, values: T[]) => {
      target.clear();
      values.forEach((value) => target.set(value.id, value));
    };
    const setByUserId = <T extends { userId: string }>(target: Map<string, T>, values: T[]) => {
      target.clear();
      values.forEach((value) => target.set(value.userId, value));
    };

    setById(this.users, source.users);
    setByUserId(this.preferences, source.preferences);
    setById(this.workflowStates, source.workflowStates);
    setById(this.projectStatuses, source.projectStatuses);
    setById(this.projects, source.projects);
    setById(this.projectDisplayPreferences, source.projectDisplayPreferences);
    setById(this.cycles, source.cycles);
    setByUserId(this.cycleSettings, source.cycleSettings);
    setById(this.issues, source.issues);
    setById(this.labels, source.labels);
    setById(this.notes, source.notes);
    setById(this.relations, source.relations);
    setById(this.recentIssueViews, source.recentIssueViews);
    setById(this.recentSearches, source.recentSearches);
    setById(this.views, source.views);
    setById(this.notifications, source.notifications);
    this.runs.clear();
    source.runs.forEach((run) => this.runs.set(run.run_id, run));
    setByUserId(this.locks, source.locks);
    this.activities.splice(0, this.activities.length, ...source.activities);
    this.outbox.splice(0, this.outbox.length, ...source.outbox);
    this.receipts.clear();
    source.receipts.forEach((receipt) =>
      this.receipts.set(`${receipt.userId}:${receipt.idempotencyKey}`, receipt),
    );
    this.cycleHistory.splice(0, this.cycleHistory.length, ...source.cycleHistory);
    this.seededUsers = new Set(source.seededUsers);
  }

  private static isSnapshot(value: unknown, ownerUserId?: string): value is OrbitStoreSnapshot {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<OrbitStoreSnapshot>;
    const arrays = [
      "users",
      "preferences",
      "workflowStates",
      "projectStatuses",
      "projects",
      "projectDisplayPreferences",
      "cycles",
      "cycleSettings",
      "issues",
      "labels",
      "notes",
      "relations",
      "recentIssueViews",
      "recentSearches",
      "views",
      "notifications",
      "activities",
      "outbox",
      "receipts",
      "runs",
      "locks",
      "cycleHistory",
      "seededUsers",
    ];
    if (!arrays.every((key) => Array.isArray(candidate[key as keyof OrbitStoreSnapshot])))
      return false;

    const isRecord = (entry: unknown): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry);
    const items = (key: keyof OrbitStoreSnapshot): unknown[] => candidate[key] as unknown[];
    const hasFields = (key: keyof OrbitStoreSnapshot, fields: string[]) =>
      items(key).every(
        (entry) => isRecord(entry) && fields.every((field) => typeof entry[field] === "string"),
      );
    const hasTypes = (
      key: keyof OrbitStoreSnapshot,
      fields: { strings?: string[]; numbers?: string[]; booleans?: string[] },
    ) =>
      items(key).every((entry) => {
        if (!isRecord(entry)) return false;
        return (
          (fields.strings ?? []).every((field) => typeof entry[field] === "string") &&
          (fields.numbers ?? []).every((field) => typeof entry[field] === "number") &&
          (fields.booleans ?? []).every((field) => typeof entry[field] === "boolean")
        );
      });
    const hasObjects = (key: keyof OrbitStoreSnapshot, fields: string[]) =>
      items(key).every(
        (entry) =>
          isRecord(entry) &&
          fields.every(
            (field) =>
              typeof entry[field] === "object" &&
              entry[field] !== null &&
              !Array.isArray(entry[field]),
          ),
      );
    const uniqueProjectDisplayPreferences = (() => {
      const keys = new Set<string>();
      return items("projectDisplayPreferences").every((entry) => {
        if (!isRecord(entry)) return false;
        const key = `${entry.userId}:${entry.projectId}`;
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
    })();
    const hasIdOwner = [
      "workflowStates",
      "projectStatuses",
      "projects",
      "cycles",
      "issues",
      "labels",
      "notes",
      "relations",
      "recentIssueViews",
      "recentSearches",
      "views",
      "notifications",
      "activities",
      "outbox",
      "cycleHistory",
    ].every((key) => hasFields(key as keyof OrbitStoreSnapshot, ["id", "userId"]));
    const valid =
      hasTypes("users", { strings: ["id", "name", "email"], numbers: ["createdAt"] }) &&
      hasTypes("preferences", {
        strings: ["userId", "timezone", "locale", "theme", "colorTheme"],
        numbers: ["issueCounter"],
        booleans: ["estimateEnabled"],
      }) &&
      hasTypes("workflowStates", {
        strings: ["id", "userId", "name", "category", "color"],
        numbers: ["position"],
        booleans: ["isDefault"],
      }) &&
      hasTypes("projectStatuses", {
        strings: ["id", "userId", "name", "category", "color"],
        numbers: ["position"],
        booleans: ["isDefault"],
      }) &&
      hasTypes("projects", {
        strings: ["id", "userId", "name", "statusId", "priority", "color", "icon", "description"],
        numbers: ["createdAt", "updatedAt"],
      }) &&
      hasTypes("projectDisplayPreferences", {
        strings: ["id", "userId", "projectId"],
        numbers: ["updatedAt"],
      }) &&
      items("projectDisplayPreferences").every(
        (entry) =>
          isRecord(entry) &&
          isRecord(entry.settings) &&
          projectIssueDisplaySettingsSchema.safeParse(entry.settings).success,
      ) &&
      uniqueProjectDisplayPreferences &&
      hasTypes("cycles", {
        strings: ["id", "userId", "name", "description", "status"],
        numbers: ["number", "startsAt", "endsAt"],
        booleans: ["scheduleOverridden"],
      }) &&
      hasTypes("labels", { strings: ["id", "userId", "name", "color"] }) &&
      hasTypes("notes", {
        strings: ["id", "userId", "issueId", "body"],
        numbers: ["createdAt"],
      }) &&
      hasTypes("relations", {
        strings: ["id", "userId", "sourceIssueId", "targetIssueId", "type"],
        numbers: ["createdAt"],
      }) &&
      hasTypes("recentIssueViews", {
        strings: ["id", "userId", "issueId"],
        numbers: ["viewedAt"],
      }) &&
      hasTypes("recentSearches", {
        strings: ["id", "userId"],
        numbers: ["searchedAt"],
      }) &&
      hasObjects("recentSearches", ["query"]) &&
      items("recentSearches").every(
        (entry) => isRecord(entry) && issueSearchQuerySchema.safeParse(entry.query).success,
      ) &&
      hasTypes("views", {
        strings: ["id", "userId", "name"],
        numbers: ["createdAt", "updatedAt"],
      }) &&
      hasObjects("views", ["query", "layout"]) &&
      hasTypes("cycleSettings", {
        strings: ["userId"],
        numbers: ["durationWeeks", "cooldownWeeks", "startWeekday", "futureCount"],
        booleans: ["enabled", "autoAddToCurrentCycle"],
      }) &&
      hasTypes("issues", {
        strings: ["id", "userId", "title", "statusId", "priority"],
        numbers: ["number", "position", "version", "createdAt", "updatedAt"],
      }) &&
      hasTypes("notifications", {
        strings: ["id", "userId", "type", "title", "body", "entityType"],
      }) &&
      hasTypes("activities", {
        strings: ["id", "userId", "entityType", "entityId", "action", "actorType", "mutationKey"],
        numbers: ["createdAt"],
      }) &&
      items("activities").every(
        (entry) =>
          isRecord(entry) &&
          ["user", "system:manual-run", "system:automation"].includes(entry.actorType as string),
      ) &&
      hasTypes("outbox", {
        strings: ["id", "userId", "type", "dedupeKey", "status"],
        numbers: ["attemptCount", "createdAt"],
      }) &&
      hasTypes("receipts", {
        strings: ["userId", "idempotencyKey", "requestHash", "operation"],
        numbers: ["createdAt", "expiresAt"],
      }) &&
      hasTypes("runs", {
        strings: ["run_id", "user_id", "kind", "status", "idempotencyKey", "requestHash"],
        numbers: ["requested_at", "resume_count"],
      }) &&
      hasObjects("runs", ["progress", "stepStatuses", "stepCursors"]) &&
      hasTypes("cycleHistory", {
        strings: ["id", "userId", "issueId", "fromCycleId", "toCycleId"],
        numbers: ["movedAt"],
      }) &&
      hasTypes("locks", { strings: ["userId", "status"] }) &&
      hasIdOwner &&
      items("seededUsers").every((entry) => typeof entry === "string");
    if (!valid) return false;
    if (
      !items("preferences").every(
        (entry) =>
          isRecord(entry) &&
          colorThemeValues.includes(entry.colorTheme as (typeof colorThemeValues)[number]),
      )
    )
      return false;
    if (!ownerUserId) return true;

    const ownerScoped = [
      "preferences",
      "workflowStates",
      "projectStatuses",
      "projects",
      "projectDisplayPreferences",
      "cycles",
      "cycleSettings",
      "issues",
      "labels",
      "notes",
      "relations",
      "recentIssueViews",
      "recentSearches",
      "views",
      "notifications",
      "activities",
      "outbox",
      "receipts",
      "cycleHistory",
      "locks",
    ] as const;
    const scopedToOwner = ownerScoped.every((key) =>
      items(key).every((entry) => {
        if (!isRecord(entry)) return false;
        return entry.userId === ownerUserId;
      }),
    );
    return (
      scopedToOwner &&
      items("users").every((entry) => isRecord(entry) && entry.id === ownerUserId) &&
      items("runs").every((entry) => isRecord(entry) && entry.user_id === ownerUserId) &&
      items("seededUsers").every((entry) => entry === ownerUserId)
    );
  }

  ensureOwner(userId: string, email = "you@orbit.local", seedDemo = false): User {
    const existing = this.users.get(userId);
    if (existing) return existing;
    const now = this.clock();
    const user: User = { id: userId, name: "Orbit User", email, avatarUrl: null, createdAt: now };
    this.users.set(userId, user);
    this.preferences.set(userId, {
      userId,
      timezone: "Asia/Tokyo",
      locale: "ja",
      theme: "system",
      colorTheme: "coral",
      estimateEnabled: true,
      issueCounter: 0,
    });
    const workflowDefaults = [
      ["Backlog", "backlog", "#a0a6b0"],
      ["Todo", "unstarted", "#8b93a1"],
      ["In progress", "started", "#4f7cff"],
      ["Done", "completed", "#26a269"],
      ["Canceled", "canceled", "#d55e73"],
    ] as const;
    workflowDefaults.forEach(([name, category, color], position) => {
      const state: WorkflowState = {
        id: createId("status"),
        userId,
        name,
        category,
        color,
        position,
        isDefault: position === 1,
      };
      this.workflowStates.set(state.id, state);
    });
    const projectDefaults = [
      ["Backlog", "backlog", "#a0a6b0"],
      ["Planned", "planned", "#8b93a1"],
      ["In progress", "in_progress", "#4f7cff"],
      ["Completed", "completed", "#26a269"],
      ["Canceled", "canceled", "#d55e73"],
    ] as const;
    projectDefaults.forEach(([name, category, color], position) => {
      const status: ProjectStatus = {
        id: createId("project-status"),
        userId,
        name,
        category,
        color,
        position,
        isDefault: position === 1,
      };
      this.projectStatuses.set(status.id, status);
    });
    this.cycleSettings.set(userId, {
      userId,
      enabled: true,
      durationWeeks: 2,
      cooldownWeeks: 0,
      startWeekday: 1,
      futureCount: 3,
      autoAddToCurrentCycle: false,
    });
    this.locks.set(userId, {
      userId,
      runId: null,
      token: null,
      status: "idle",
      leaseExpiresAt: null,
    });
    if (seedDemo && !this.seededUsers.has(userId)) this.seedDemo(userId);
    this.seededUsers.add(userId);
    return user;
  }

  private seedDemo(userId: string): void {
    const now = this.clock();
    const statuses = this.ownedWorkflowStates(userId);
    const activeStatus = statuses.find((item) => item.category === "started") ?? statuses[0];
    const todoStatus = statuses.find((item) => item.category === "unstarted") ?? statuses[0];
    const doneStatus = statuses.find((item) => item.category === "completed") ?? statuses[0];
    const projectStatus =
      this.ownedProjectStatuses(userId).find((item) => item.category === "in_progress") ??
      this.ownedProjectStatuses(userId)[0];
    const project: Project = {
      id: createId("project"),
      userId,
      name: "Orbit MVP",
      statusId: projectStatus.id,
      priority: "high",
      color: "#ff6b57",
      icon: "◈",
      description: "毎日の作業を小さく進めるためのプロジェクト。",
      startAt: now - 14 * DAY,
      targetAt: now + 30 * DAY,
      archivedAt: null,
      deletedAt: null,
      createdAt: now - 14 * DAY,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    const cycle: Cycle = {
      id: createId("cycle"),
      userId,
      number: 1,
      name: "Cycle 1",
      nameOverride: null,
      description: "今週の集中テーマ",
      startsAt: now - 4 * DAY,
      endsAt: now + 10 * DAY,
      status: "active",
      completedAt: null,
      scheduleOverridden: false,
    };
    this.cycles.set(cycle.id, cycle);
    const titles = [
      ["データモデルを確認する", activeStatus.id, "high", 3],
      ["Mobileの一覧を磨く", todoStatus.id, "medium", 2],
      ["Background Runの復旧導線", todoStatus.id, "urgent", 5],
      ["READMEを更新する", doneStatus.id, "low", 1],
    ] as const;
    titles.forEach(([title, statusId, priority, estimate], index) => {
      this.createIssue(
        userId,
        {
          idempotencyKey: `seed-${index}-${userId}`,
          title,
          statusId,
          priority,
          estimate,
          projectId: project.id,
          cycleId: cycle.id,
        },
        true,
      );
    });
    const demoIssue = this.listIssues(userId)[0];
    if (demoIssue) {
      // Dev-only fixture so the local Inbox journey is observable; production notification generation stays out of scope.
      const notificationId = createId("notification");
      this.notifications.set(notificationId, {
        id: notificationId,
        userId,
        type: "due_soon",
        title: `${demoIssue.identifier}の期限が近づいています`,
        body: "Issueを確認して、次の一手を決めましょう。",
        entityType: "issue",
        entityId: demoIssue.id,
        readAt: null,
        deletedAt: null,
        createdAt: now,
      });
    }
  }

  ownedWorkflowStates(userId: string): WorkflowState[] {
    return [...this.workflowStates.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.position - b.position);
  }

  private validateWorkflowStateName(name: string): string {
    if (typeof name !== "string" || !workflowStateNameSchema.safeParse(name).success)
      throw validationError({ name: ["Workflow名はUnicode 1〜100文字で入力してください。"] });
    const normalized = name.trim();
    if (!normalized) throw validationError({ name: ["Workflow名は1文字以上で入力してください。"] });
    return normalized;
  }

  private validateWorkflowStateColor(color: string): string {
    if (typeof color !== "string" || !workflowStateColorSchema.safeParse(color).success)
      throw validationError({ color: ["色は#RRGGBB形式で指定してください。"] });
    return color.toUpperCase();
  }

  private normalizeWorkflowPositions(userId: string): void {
    this.ownedWorkflowStates(userId).forEach((state, index) => {
      state.position = index;
    });
  }

  createWorkflowState(userId: string, input: WorkflowStateCreateInput): WorkflowState {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<WorkflowState>(
      userId,
      "workflow.create",
      input.idempotencyKey,
      input,
    );
    if (existing) return existing;
    validateKey(input.idempotencyKey);
    if (!workflowCategories.includes(input.category))
      throw validationError({ category: ["Workflowカテゴリが不正です。"] });

    const name = this.validateWorkflowStateName(input.name);
    const color = this.validateWorkflowStateColor(input.color);
    this.normalizeWorkflowPositions(userId);
    const states = this.ownedWorkflowStates(userId);
    const beforeDefaults = new Map(states.map((state) => [state.id, state.isDefault]));
    const makeDefault = input.isDefault === true || !states.some((state) => state.isDefault);
    if (makeDefault) states.forEach((state) => (state.isDefault = false));
    const state: WorkflowState = {
      id: createId("status"),
      userId,
      name,
      category: input.category,
      color,
      position: states.length,
      isDefault: makeDefault,
    };
    this.workflowStates.set(state.id, state);
    for (const current of this.ownedWorkflowStates(userId)) {
      if (current.id === state.id) {
        this.recordActivity(
          userId,
          "workflow_state",
          current.id,
          "created",
          `${input.idempotencyKey}:${current.id}`,
          null,
          {
            name: current.name,
            category: current.category,
            color: current.color,
            position: current.position,
            isDefault: current.isDefault,
          },
        );
        this.recordOutbox(
          userId,
          "workflow_state.created",
          `workflow_state.created:${current.id}`,
          { workflowStateId: current.id },
        );
      } else if (beforeDefaults.get(current.id) !== current.isDefault) {
        this.recordActivity(
          userId,
          "workflow_state",
          current.id,
          "updated",
          `${input.idempotencyKey}:${current.id}`,
          { isDefault: beforeDefaults.get(current.id) },
          { isDefault: current.isDefault },
        );
        this.recordOutbox(
          userId,
          "workflow_state.updated",
          `workflow_state.updated:${current.id}:${input.idempotencyKey}`,
          { workflowStateId: current.id },
        );
      }
    }
    this.recordReceipt(userId, "workflow.create", input.idempotencyKey, input, state);
    return state;
  }

  updateWorkflowState(
    userId: string,
    stateId: string,
    input: WorkflowStateUpdateInput,
  ): WorkflowState {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const request = { stateId, ...input };
    const existing = this.checkReceipt<WorkflowState>(
      userId,
      "workflow.update",
      input.idempotencyKey,
      request,
    );
    if (existing) return existing;
    const state = this.workflowStates.get(stateId);
    if (!state || state.userId !== userId) throw notFound();
    if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0))
      throw validationError({ position: ["positionは0以上の整数で指定してください。"] });
    if (input.isDefault === false && state.isDefault)
      throw validationError({
        isDefault: ["既定Workflowは別の状態を既定にしてから変更してください。"],
      });

    const nextName =
      input.name === undefined ? state.name : this.validateWorkflowStateName(input.name);
    const nextColor =
      input.color === undefined ? state.color : this.validateWorkflowStateColor(input.color);
    const states = this.ownedWorkflowStates(userId);
    const beforeById = new Map(
      states.map((item) => [
        item.id,
        {
          name: item.name,
          category: item.category,
          color: item.color,
          position: item.position,
          isDefault: item.isDefault,
        },
      ]),
    );
    state.name = nextName;
    state.color = nextColor;
    if (input.isDefault === true) {
      states.forEach((item) => (item.isDefault = item.id === stateId));
    }
    if (input.position !== undefined) {
      const ordered = states.filter((item) => item.id !== stateId);
      ordered.splice(Math.min(input.position, ordered.length), 0, state);
      ordered.forEach((item, index) => (item.position = index));
    } else {
      this.normalizeWorkflowPositions(userId);
    }

    for (const current of this.ownedWorkflowStates(userId)) {
      const before = beforeById.get(current.id);
      const after = {
        name: current.name,
        category: current.category,
        color: current.color,
        position: current.position,
        isDefault: current.isDefault,
      };
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      this.recordActivity(
        userId,
        "workflow_state",
        current.id,
        "updated",
        `${input.idempotencyKey}:${current.id}`,
        before ?? null,
        after,
      );
      this.recordOutbox(
        userId,
        "workflow_state.updated",
        `workflow_state.updated:${current.id}:${input.idempotencyKey}`,
        { workflowStateId: current.id },
      );
    }
    this.recordReceipt(userId, "workflow.update", input.idempotencyKey, request, state);
    return state;
  }

  deleteWorkflowState(userId: string, stateId: string, idempotencyKey: string): void {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const request = { stateId };
    const existing = this.checkReceipt<boolean>(userId, "workflow.delete", idempotencyKey, request);
    if (existing !== null) return;
    const state = this.workflowStates.get(stateId);
    if (!state || state.userId !== userId) throw notFound();
    if (state.isDefault) throw validationError({ stateId: ["既定Workflowは削除できません。"] });
    if (
      [...this.issues.values()].some(
        (issue) => issue.userId === userId && issue.statusId === stateId,
      )
    )
      throw validationError({ stateId: ["Issueが参照中のWorkflowは削除できません。"] });

    const beforeById = new Map(
      this.ownedWorkflowStates(userId).map((item) => [item.id, { position: item.position }]),
    );
    this.workflowStates.delete(stateId);
    this.normalizeWorkflowPositions(userId);
    this.recordActivity(
      userId,
      "workflow_state",
      stateId,
      "deleted",
      `${idempotencyKey}:${stateId}`,
      { name: state.name, category: state.category, color: state.color, position: state.position },
      null,
    );
    this.recordOutbox(userId, "workflow_state.deleted", `workflow_state.deleted:${stateId}`, {
      workflowStateId: stateId,
    });
    for (const current of this.ownedWorkflowStates(userId)) {
      const before = beforeById.get(current.id);
      if (!before || before.position === current.position) continue;
      this.recordActivity(
        userId,
        "workflow_state",
        current.id,
        "reordered",
        `${idempotencyKey}:${current.id}`,
        before,
        { position: current.position },
      );
      this.recordOutbox(
        userId,
        "workflow_state.reordered",
        `workflow_state.reordered:${current.id}:${idempotencyKey}`,
        { workflowStateId: current.id, position: current.position },
      );
    }
    this.recordReceipt(userId, "workflow.delete", idempotencyKey, request, true);
  }

  ownedProjectStatuses(userId: string): ProjectStatus[] {
    return [...this.projectStatuses.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.position - b.position);
  }

  listLabels(userId: string): Label[] {
    return [...this.labels.values()]
      .filter((item) => item.userId === userId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private validateLabelName(name: string): string {
    const normalized = name.trim();
    if (!labelNameSchema.safeParse(normalized).success)
      throw validationError({ name: ["Label名は1〜50文字で入力してください。"] });
    return normalized;
  }

  private validateLabelColor(color: string): string {
    if (!labelColorSchema.safeParse(color).success)
      throw validationError({ color: ["色は#RRGGBB形式で指定してください。"] });
    return color.toUpperCase();
  }

  private ownedLabelIds(userId: string, labelIds: string[] | undefined): string[] {
    const normalized = [...new Set(labelIds ?? [])];
    for (const labelId of normalized) {
      const label = this.labels.get(labelId);
      if (!label || label.userId !== userId) throw notFound();
    }
    return normalized;
  }

  createLabel(userId: string, input: CreateLabelInput): Label {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Label>(userId, "label.create", input.idempotencyKey, input);
    if (existing) return existing;
    const name = this.validateLabelName(input.name);
    const color = this.validateLabelColor(input.color);
    if (this.listLabels(userId).some((item) => item.name === name))
      throw validationError({ name: ["同じ名前のLabelが既にあります。"] });
    const label: Label = { id: createId("label"), userId, name, color };
    this.labels.set(label.id, label);
    this.recordActivity(userId, "label", label.id, "created", input.idempotencyKey, null, {
      name: label.name,
      color: label.color,
    });
    this.recordOutbox(userId, "label.created", `label.created:${label.id}`, { labelId: label.id });
    this.recordReceipt(userId, "label.create", input.idempotencyKey, input, label);
    return label;
  }

  updateLabel(userId: string, labelId: string, input: UpdateLabelInput): Label {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Label>(userId, "label.update", input.idempotencyKey, {
      labelId,
      ...input,
    });
    if (existing) return existing;
    const label = this.labels.get(labelId);
    if (!label || label.userId !== userId) throw notFound();
    if (input.name === undefined && input.color === undefined)
      throw validationError({ name: ["nameまたはcolorを指定してください。"] });
    const name = input.name === undefined ? label.name : this.validateLabelName(input.name);
    const color = input.color === undefined ? label.color : this.validateLabelColor(input.color);
    if (
      name !== label.name &&
      this.listLabels(userId).some((item) => item.id !== labelId && item.name === name)
    )
      throw validationError({ name: ["同じ名前のLabelが既にあります。"] });
    const before = { ...label };
    label.name = name;
    label.color = color;
    this.recordActivity(userId, "label", label.id, "updated", input.idempotencyKey, before, {
      ...label,
    });
    this.recordOutbox(
      userId,
      "label.updated",
      `label.updated:${label.id}:${input.idempotencyKey}`,
      {
        labelId: label.id,
      },
    );
    this.recordReceipt(userId, "label.update", input.idempotencyKey, { labelId, ...input }, label);
    return label;
  }

  deleteLabel(userId: string, labelId: string, idempotencyKey: string): void {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<boolean>(userId, "label.delete", idempotencyKey, {
      labelId,
    });
    if (existing !== null) return;
    const label = this.labels.get(labelId);
    if (!label || label.userId !== userId) throw notFound();
    let detached = 0;
    for (const issue of this.issues.values()) {
      if (issue.userId !== userId || !issue.labelIds.includes(labelId)) continue;
      const before = { version: issue.version, labelIds: [...issue.labelIds] };
      issue.labelIds = issue.labelIds.filter((id) => id !== labelId);
      issue.version += 1;
      issue.updatedAt = this.clock();
      this.recordActivity(
        userId,
        "issue",
        issue.id,
        "updated",
        `${idempotencyKey}:${issue.id}`,
        before,
        { version: issue.version, labelIds: [...issue.labelIds] },
      );
      this.recordOutbox(
        userId,
        "issue.updated",
        `issue.updated:${issue.id}:label-delete:${idempotencyKey}`,
        { issueId: issue.id, version: issue.version },
      );
      detached += 1;
    }
    this.labels.delete(labelId);
    this.recordActivity(userId, "label", labelId, "deleted", idempotencyKey, { ...label }, null);
    this.recordOutbox(userId, "label.deleted", `label.deleted:${labelId}`, { labelId, detached });
    this.recordReceipt(userId, "label.delete", idempotencyKey, { labelId }, true);
  }

  private assertOwner(userId: string): void {
    if (!this.users.has(userId)) this.ensureOwner(userId);
  }

  private assertUnlocked(userId: string, runId?: string): void {
    this.expireRunIfNeeded(userId);
    const lock = this.locks.get(userId);
    if (lock?.status === "running" && lock.runId !== runId) throw locked();
    const pendingRun = [...this.runs.values()].find(
      (run) =>
        run.user_id === userId &&
        run.run_id !== runId &&
        (run.status === "pending" || run.status === "running"),
    );
    if (pendingRun) throw locked();
  }

  private recordActivity(
    userId: string,
    entityType: string,
    entityId: string,
    action: string,
    mutationKey: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    actorType: ActivityEvent["actorType"] = "user",
  ): void {
    if (this.activities.some((item) => item.userId === userId && item.mutationKey === mutationKey))
      return;
    this.activities.push({
      id: createId("activity"),
      userId,
      entityType,
      entityId,
      action,
      actorType,
      mutationKey,
      before,
      after,
      createdAt: this.clock(),
    });
  }

  private recordOutbox(
    userId: string,
    type: string,
    dedupeKey: string,
    payload: Record<string, unknown>,
  ): void {
    if (this.outbox.some((item) => item.userId === userId && item.dedupeKey === dedupeKey)) return;
    this.outbox.push({
      id: createId("outbox"),
      userId,
      type,
      dedupeKey,
      payload,
      status: "pending",
      attemptCount: 0,
      createdAt: this.clock(),
    });
  }

  private recordReceipt(
    userId: string,
    operation: string,
    idempotencyKey: string,
    input: unknown,
    response: unknown,
  ): void {
    this.receipts.set(`${userId}:${idempotencyKey}`, {
      userId,
      operation,
      idempotencyKey,
      requestHash: requestHash(operation, input),
      response: structuredClone(response),
      createdAt: this.clock(),
      expiresAt: this.clock() + RECEIPT_TTL,
    });
  }

  pruneExpiredReceipts(userId: string): number {
    const now = this.clock();
    let removed = 0;
    for (const [key, receipt] of this.receipts) {
      if (
        receipt.userId === userId &&
        Math.min(receipt.expiresAt, receipt.createdAt + RECEIPT_TTL) < now
      ) {
        this.receipts.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private checkReceipt<T>(
    userId: string,
    operation: string,
    idempotencyKey: string,
    input: unknown,
  ): T | null {
    validateKey(idempotencyKey);
    const existing = this.receipts.get(`${userId}:${idempotencyKey}`);
    if (!existing) return null;
    const hash = requestHash(operation, input);
    if (hash !== existing.requestHash)
      throw conflict("IDEMPOTENCY_KEY_REUSED", "同じキーで異なる内容は送信できません。");
    return structuredClone(existing.response) as T;
  }

  private validateParent(userId: string, issueId: string | null, parentId?: string | null): void {
    if (parentId === undefined || parentId === null) return;
    const parent = this.issues.get(parentId);
    if (
      !parent ||
      parent.userId !== userId ||
      parent.deletedAt !== null ||
      parent.archivedAt !== null
    )
      throw notFound();
    if (issueId !== null && parent.id === issueId)
      throw validationError({ parentId: ["Issue自身を親には指定できません。"] });

    const visited = new Set<string>();
    let current: Issue | undefined = parent;
    while (current?.parentId) {
      if (current.parentId === issueId)
        throw validationError({ parentId: ["Issueの子孫を親には指定できません。"] });
      if (visited.has(current.id))
        throw validationError({ parentId: ["親子関係が循環しています。"] });
      visited.add(current.id);
      const ancestor = this.issues.get(current.parentId);
      if (!ancestor || ancestor.userId !== userId || ancestor.deletedAt !== null) break;
      current = ancestor;
    }
  }

  private issueSummary(issue: Issue): IssueSummary {
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      statusId: issue.statusId,
    };
  }

  getIssueSummary(userId: string, issueId: string): IssueSummary {
    const issue = this.issues.get(issueId);
    if (!issue || issue.userId !== userId || issue.deletedAt !== null) throw notFound();
    return this.issueSummary(issue);
  }

  createIssue(userId: string, input: CreateIssueInput, bypassLock = false): Issue {
    this.assertOwner(userId);
    if (!bypassLock) this.assertUnlocked(userId);
    const existing = this.checkReceipt<Issue>(userId, "issue.create", input.idempotencyKey, input);
    if (existing) return existing;
    validateTitle(input.title);
    const preferences = this.preferences.get(userId)!;
    const status = input.statusId
      ? this.workflowStates.get(input.statusId)
      : this.ownedWorkflowStates(userId).find((item) => item.isDefault);
    if (!status || status.userId !== userId) throw notFound();
    const project = input.projectId ? this.projects.get(input.projectId) : null;
    if (input.projectId && (!project || project.userId !== userId || project.deletedAt))
      throw notFound();
    const cycle = input.cycleId ? this.cycles.get(input.cycleId) : null;
    if (input.cycleId && (!cycle || cycle.userId !== userId)) throw notFound();
    this.validateParent(userId, null, input.parentId);
    if (
      input.dueAt !== undefined &&
      input.dueAt !== null &&
      (!Number.isInteger(input.dueAt) || !Number.isFinite(input.dueAt))
    )
      throw validationError({ dueAt: ["Due dateは整数のtimestampまたはnullで指定してください。"] });
    if (input.priority && !priorities.includes(input.priority))
      throw validationError({ priority: ["優先度が不正です。"] });
    if (
      input.estimate !== undefined &&
      input.estimate !== null &&
      ![1, 2, 3, 5, 8].includes(input.estimate)
    )
      throw validationError({ estimate: ["見積は1 / 2 / 3 / 5 / 8から選択してください。"] });
    const labelIds = this.ownedLabelIds(userId, input.labelIds);
    const now = this.clock();
    const number = preferences.issueCounter + 1;
    const issue: Issue = {
      id: createId("issue"),
      userId,
      number,
      identifier: `TASK-${number}`,
      title: input.title,
      description: input.description ?? "",
      statusId: status.id,
      priority: input.priority ?? "no_priority",
      estimate: input.estimate ?? null,
      dueAt: input.dueAt ?? null,
      projectId: input.projectId ?? null,
      cycleId: input.cycleId ?? null,
      parentId: input.parentId ?? null,
      labelIds,
      position: [...this.issues.values()].filter((item) => item.userId === userId).length,
      version: 1,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const automaticCycle = this.cycleForAutomaticIssueAssignment(
      userId,
      status.id,
      null,
      input.cycleId ?? null,
      input.cycleId !== undefined,
    );
    if (automaticCycle) issue.cycleId = automaticCycle.id;
    preferences.issueCounter = number;
    this.issues.set(issue.id, issue);
    this.recordActivity(userId, "issue", issue.id, "created", input.idempotencyKey, null, {
      identifier: issue.identifier,
      title: issue.title,
    });
    this.recordOutbox(userId, "issue.created", `issue.created:${issue.id}`, { issueId: issue.id });
    if (automaticCycle)
      this.recordAutomaticCycleAssignment(
        userId,
        issue,
        status.id,
        automaticCycle,
        input.idempotencyKey,
      );
    this.recordReceipt(userId, "issue.create", input.idempotencyKey, input, issue);
    return issue;
  }

  getIssue(userId: string, issueId: string): Issue {
    const issue = this.issues.get(issueId);
    if (!issue || issue.userId !== userId || issue.deletedAt) throw notFound();
    return issue;
  }

  private cycleForAutomaticIssueAssignment(
    userId: string,
    statusId: string,
    previousStatusId: string | null,
    issueCycleId: string | null,
    cycleIdSpecified: boolean,
  ): Cycle | null {
    const settings = this.cycleSettings.get(userId);
    if (!settings?.autoAddToCurrentCycle || cycleIdSpecified || issueCycleId !== null) return null;
    if (previousStatusId !== null && previousStatusId === statusId) return null;
    const status = this.workflowStates.get(statusId);
    if (!status || (status.category !== "started" && status.category !== "completed")) return null;
    return this.listCycles(userId).find((cycle) => cycle.status === "active") ?? null;
  }

  private recordAutomaticCycleAssignment(
    userId: string,
    issue: Issue,
    beforeStatusId: string,
    cycle: Cycle,
    mutationKey: string,
  ): void {
    this.recordActivity(
      userId,
      "issue",
      issue.id,
      "cycle.auto_assigned",
      `${mutationKey}:cycle-auto-add`,
      { cycleId: null, statusId: beforeStatusId },
      { cycleId: cycle.id, statusId: issue.statusId },
      "system:automation",
    );
    this.recordOutbox(
      userId,
      "issue.cycle.auto_assigned",
      `issue.cycle.auto_assigned:${issue.id}:${issue.version}`,
      { issueId: issue.id, cycleId: cycle.id, version: issue.version },
    );
  }

  listCycleHistory(userId: string): CycleHistoryViewModel[] {
    return this.cycleHistory
      .filter((record) => record.userId === userId)
      .map((record) => {
        const issue = this.issues.get(record.issueId);
        const fromCycle = this.cycles.get(record.fromCycleId);
        const toCycle = this.cycles.get(record.toCycleId);
        if (
          !issue ||
          issue.userId !== userId ||
          !fromCycle ||
          fromCycle.userId !== userId ||
          !toCycle ||
          toCycle.userId !== userId
        )
          return null;
        return {
          id: record.id,
          issue: { id: issue.id, identifier: issue.identifier, title: issue.title },
          fromCycle: {
            id: fromCycle.id,
            number: fromCycle.number,
            name: fromCycle.nameOverride ?? fromCycle.name,
          },
          toCycle: {
            id: toCycle.id,
            number: toCycle.number,
            name: toCycle.nameOverride ?? toCycle.name,
          },
          movedAt: record.movedAt,
        } satisfies CycleHistoryViewModel;
      })
      .filter((entry): entry is CycleHistoryViewModel => entry !== null)
      .sort((left, right) => right.movedAt - left.movedAt || left.id.localeCompare(right.id));
  }

  getIssueDetail(userId: string, issueId: string): IssueDetail {
    const issue = this.getIssue(userId, issueId);
    const cycleHistory = this.listCycleHistory(userId).filter(
      (entry) => entry.issue.id === issueId,
    );
    const parentIssue = issue.parentId ? this.issues.get(issue.parentId) : undefined;
    const parent =
      parentIssue && parentIssue.userId === userId && parentIssue.deletedAt === null
        ? this.issueSummary(parentIssue)
        : null;
    const children = [...this.issues.values()]
      .filter(
        (candidate) =>
          candidate.userId === userId &&
          candidate.parentId === issueId &&
          candidate.deletedAt === null,
      )
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.createdAt - right.createdAt ||
          left.identifier.localeCompare(right.identifier, "ja"),
      );
    const childMetrics = calculateCycleMetrics(children, this.ownedWorkflowStates(userId));
    const notes = [...this.notes.values()]
      .filter(
        (note) => note.userId === userId && note.issueId === issueId && note.deletedAt === null,
      )
      .sort((left, right) => right.createdAt - left.createdAt);
    const relations = [...this.relations.values()]
      .filter(
        (relation) =>
          relation.userId === userId &&
          (relation.sourceIssueId === issueId || relation.targetIssueId === issueId),
      )
      .flatMap((relation) => {
        const targetId =
          relation.sourceIssueId === issueId ? relation.targetIssueId : relation.sourceIssueId;
        const target = this.issues.get(targetId);
        if (!target || target.userId !== userId || target.deletedAt !== null) return [];
        return {
          ...relation,
          type: relationTypeFromPerspective(relation.type, relation.sourceIssueId === issueId),
          target: {
            id: target.id,
            identifier: target.identifier,
            title: target.title,
            statusId: target.statusId,
          },
        } satisfies IssueRelationView;
      })
      .sort((left, right) => right.createdAt - left.createdAt);
    const activity = this.activities
      .filter((event) => event.userId === userId && event.entityId === issueId)
      .sort((left, right) => right.createdAt - left.createdAt);
    return {
      issue,
      parent,
      children: children.map((child) => this.issueSummary(child)),
      childProgress: {
        total: childMetrics.total,
        completed: childMetrics.completed,
        canceled: childMetrics.canceled,
        progressPercent: childMetrics.progressPercent,
      },
      notes,
      relations,
      activity: activity.map(({ mutationKey: _mutationKey, ...publicEvent }) => publicEvent),
      cycleHistory,
      carryoverCount: cycleHistory.length,
    };
  }

  createIssueNote(userId: string, issueId: string, input: NoteMutationInput): IssueNote {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<IssueNote>(
      userId,
      "issue.note.create",
      input.idempotencyKey,
      { issueId, body: input.body },
    );
    if (existing) return existing;
    const issue = this.getIssue(userId, issueId);
    validateNoteBody(input.body);
    const now = this.clock();
    const note: IssueNote = {
      id: createId("note"),
      userId,
      issueId: issue.id,
      body: input.body,
      createdAt: now,
      editedAt: null,
      deletedAt: null,
    };
    this.notes.set(note.id, note);
    this.recordActivity(userId, "issue", issueId, "note.created", input.idempotencyKey, null, {
      noteId: note.id,
      bodyLength: [...note.body].length,
    });
    this.recordOutbox(userId, "issue.note.created", `issue.note.created:${note.id}`, {
      issueId,
      noteId: note.id,
    });
    this.recordReceipt(
      userId,
      "issue.note.create",
      input.idempotencyKey,
      { issueId, body: input.body },
      note,
    );
    return note;
  }

  updateIssueNote(
    userId: string,
    issueId: string,
    noteId: string,
    input: NoteMutationInput,
  ): IssueNote {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<IssueNote>(
      userId,
      "issue.note.update",
      input.idempotencyKey,
      { issueId, noteId, body: input.body },
    );
    if (existing) return existing;
    this.getIssue(userId, issueId);
    const note = this.notes.get(noteId);
    if (!note || note.userId !== userId || note.issueId !== issueId || note.deletedAt !== null)
      throw notFound();
    validateNoteBody(input.body);
    const before = note.body;
    note.body = input.body;
    note.editedAt = this.clock();
    this.recordActivity(
      userId,
      "issue",
      issueId,
      "note.updated",
      input.idempotencyKey,
      { noteId, bodyLength: [...before].length },
      { noteId, bodyLength: [...note.body].length },
    );
    this.recordOutbox(
      userId,
      "issue.note.updated",
      `issue.note.updated:${note.id}:${input.idempotencyKey}`,
      { issueId, noteId },
    );
    this.recordReceipt(
      userId,
      "issue.note.update",
      input.idempotencyKey,
      { issueId, noteId, body: input.body },
      note,
    );
    return note;
  }

  deleteIssueNote(userId: string, issueId: string, noteId: string, idempotencyKey: string): void {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<boolean>(userId, "issue.note.delete", idempotencyKey, {
      issueId,
      noteId,
    });
    if (existing !== null) return;
    this.getIssue(userId, issueId);
    const note = this.notes.get(noteId);
    if (!note || note.userId !== userId || note.issueId !== issueId || note.deletedAt !== null)
      throw notFound();
    note.deletedAt = this.clock();
    this.recordActivity(
      userId,
      "issue",
      issueId,
      "note.deleted",
      idempotencyKey,
      { noteId },
      { noteId, deletedAt: note.deletedAt },
    );
    this.recordOutbox(userId, "issue.note.deleted", `issue.note.deleted:${note.id}`, {
      issueId,
      noteId,
    });
    this.recordReceipt(userId, "issue.note.delete", idempotencyKey, { issueId, noteId }, true);
  }

  createIssueRelation(
    userId: string,
    issueId: string,
    input: RelationMutationInput,
  ): IssueRelation {
    this.assertUnlocked(userId);
    const existingReceipt = this.checkReceipt<IssueRelation>(
      userId,
      "issue.relation.create",
      input.idempotencyKey,
      { issueId, ...input },
    );
    if (existingReceipt) return existingReceipt;
    const source = this.getIssue(userId, issueId);
    const target = this.getIssue(userId, input.targetIssueId);
    if (source.id === target.id)
      throw validationError({ targetIssueId: ["自分自身にはRelationを作成できません。"] });
    const [sourceIssueId, targetIssueId] =
      input.type === "related" ? [source.id, target.id].sort() : [source.id, target.id];
    const duplicate = [...this.relations.values()].find(
      (relation) =>
        relation.userId === userId &&
        relation.sourceIssueId === sourceIssueId &&
        relation.targetIssueId === targetIssueId &&
        relation.type === input.type,
    );
    if (duplicate) {
      this.recordReceipt(
        userId,
        "issue.relation.create",
        input.idempotencyKey,
        { issueId, ...input },
        duplicate,
      );
      return duplicate;
    }
    const relation: IssueRelation = {
      id: createId("relation"),
      userId,
      sourceIssueId,
      targetIssueId,
      type: input.type,
      createdAt: this.clock(),
    };
    this.relations.set(relation.id, relation);
    this.recordActivity(userId, "issue", issueId, "relation.created", input.idempotencyKey, null, {
      relationId: relation.id,
      targetIssueId,
      type: relation.type,
    });
    this.recordOutbox(userId, "issue.relation.created", `issue.relation.created:${relation.id}`, {
      issueId,
      relationId: relation.id,
    });
    this.recordReceipt(
      userId,
      "issue.relation.create",
      input.idempotencyKey,
      { issueId, ...input },
      relation,
    );
    return relation;
  }

  deleteIssueRelation(
    userId: string,
    issueId: string,
    relationId: string,
    idempotencyKey: string,
  ): void {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<boolean>(userId, "issue.relation.delete", idempotencyKey, {
      issueId,
      relationId,
    });
    if (existing !== null) return;
    this.getIssue(userId, issueId);
    const relation = this.relations.get(relationId);
    if (
      !relation ||
      relation.userId !== userId ||
      (relation.sourceIssueId !== issueId && relation.targetIssueId !== issueId)
    )
      throw notFound();
    this.relations.delete(relationId);
    this.recordActivity(
      userId,
      "issue",
      issueId,
      "relation.deleted",
      idempotencyKey,
      { relationId, type: relation.type },
      null,
    );
    this.recordOutbox(userId, "issue.relation.deleted", `issue.relation.deleted:${relation.id}`, {
      issueId,
      relationId,
    });
    this.recordReceipt(
      userId,
      "issue.relation.delete",
      idempotencyKey,
      { issueId, relationId },
      true,
    );
  }

  listIssues(
    userId: string,
    query: Partial<IssueQuery> = {},
    scope: IssueListScope = "active",
  ): Issue[] {
    const defaults = defaultQuery();
    const resolved: IssueQuery = {
      ...defaults,
      ...query,
      filter: { ...defaults.filter, ...query.filter },
      layout: { ...defaults.layout, ...query.layout },
    };
    return this.matchingIssues(userId, resolved, scope).slice(
      0,
      Math.min(Math.max(resolved.limit, 1), 500),
    );
  }

  private matchingIssues(
    userId: string,
    query: IssueQuery,
    scope: IssueListScope = "active",
  ): Issue[] {
    let items = [...this.issues.values()].filter((item) => {
      if (item.userId !== userId) return false;
      if (scope === "trash") return item.deletedAt !== null;
      if (scope === "archived") return item.deletedAt === null && item.archivedAt !== null;
      return item.deletedAt === null && item.archivedAt === null;
    });
    const filter = query.filter;
    if (filter.text?.trim()) {
      const needle = filter.text.trim().toLocaleLowerCase();
      items = items.filter((item) =>
        `${item.identifier} ${item.title} ${item.description}`.toLocaleLowerCase().includes(needle),
      );
    }
    if (filter.statusIds?.length)
      items = items.filter((item) => filter.statusIds!.includes(item.statusId));
    if (filter.priorities?.length)
      items = items.filter((item) => filter.priorities!.includes(item.priority));
    if (filter.projectIds?.length)
      items = items.filter((item) => item.projectId && filter.projectIds!.includes(item.projectId));
    if (filter.cycleIds?.length)
      items = items.filter((item) => item.cycleId && filter.cycleIds!.includes(item.cycleId));
    if (filter.labelIds?.length)
      items = items.filter((item) =>
        filter.labelIds!.every((labelId) => item.labelIds.includes(labelId)),
      );
    if (filter.created)
      items = items.filter(
        (item) =>
          (filter.created?.from === undefined || item.createdAt >= filter.created.from) &&
          (filter.created?.to === undefined || item.createdAt <= filter.created.to),
      );
    if (filter.due) {
      const now = this.clock();
      const timezone = this.preferences.get(userId)?.timezone ?? "UTC";
      const due = filter.due;
      items = items.filter((item) => matchesIssueDueDate(item.dueAt, due, now, timezone));
    }
    const priorityOrder = new Map(priorities.map((priority, index) => [priority, index]));
    items.sort((a, b) => {
      if (query.order === "priority")
        return (
          priorityOrder.get(a.priority)! - priorityOrder.get(b.priority)! ||
          b.updatedAt - a.updatedAt
        );
      if (query.order === "updated") return b.updatedAt - a.updatedAt;
      if (query.order === "created") return b.createdAt - a.createdAt;
      if (query.order === "due_at")
        return (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER);
      if (query.order === "estimate") return (b.estimate ?? 0) - (a.estimate ?? 0);
      return a.position - b.position;
    });
    return items;
  }

  updateIssue(userId: string, input: UpdateIssueInput, runId?: string): Issue {
    this.assertOwner(userId);
    this.assertUnlocked(userId, runId);
    const existing = this.checkReceipt<Issue>(userId, "issue.update", input.idempotencyKey, input);
    if (existing) return existing;
    const issue = this.getIssue(userId, input.id);
    if (issue.version !== input.version)
      throw conflict("ISSUE_VERSION_CONFLICT", "Issueが別の場所で更新されています。");
    const patch = input.patch;
    if (patch.title !== undefined) validateTitle(patch.title);
    if (patch.statusId) {
      const status = this.workflowStates.get(patch.statusId);
      if (!status || status.userId !== userId) throw notFound();
    }
    if (patch.projectId) {
      const project = this.projects.get(patch.projectId);
      if (!project || project.userId !== userId || project.deletedAt) throw notFound();
    }
    if (patch.cycleId) {
      const cycle = this.cycles.get(patch.cycleId);
      if (!cycle || cycle.userId !== userId) throw notFound();
    }
    if (patch.estimate !== undefined && ![null, 1, 2, 3, 5, 8].includes(patch.estimate as never))
      throw validationError({
        estimate: ["見積は未設定または1 / 2 / 3 / 5 / 8で指定してください。"],
      });
    if (
      patch.dueAt !== undefined &&
      patch.dueAt !== null &&
      (!Number.isInteger(patch.dueAt) || !Number.isFinite(patch.dueAt))
    )
      throw validationError({ dueAt: ["Due dateは整数のtimestampまたはnullで指定してください。"] });
    if (patch.parentId !== undefined) this.validateParent(userId, input.id, patch.parentId);
    const labelIds =
      patch.labelIds === undefined ? undefined : this.ownedLabelIds(userId, patch.labelIds);
    const before = { ...issue };
    const automaticCycle =
      patch.statusId === undefined
        ? null
        : this.cycleForAutomaticIssueAssignment(
            userId,
            patch.statusId,
            issue.statusId,
            issue.cycleId,
            "cycleId" in patch,
          );
    Object.assign(issue, {
      ...patch,
      ...(labelIds === undefined ? {} : { labelIds }),
      ...(automaticCycle ? { cycleId: automaticCycle.id } : {}),
    });
    issue.version += 1;
    issue.updatedAt = this.clock();
    this.recordActivity(
      userId,
      "issue",
      issue.id,
      "updated",
      input.idempotencyKey,
      { version: before.version, statusId: before.statusId, priority: before.priority },
      {
        version: issue.version,
        statusId: issue.statusId,
        priority: issue.priority,
        cycleId: issue.cycleId,
      },
    );
    this.recordOutbox(userId, "issue.updated", `issue.updated:${issue.id}:${issue.version}`, {
      issueId: issue.id,
      version: issue.version,
      cycleId: issue.cycleId,
    });
    if (automaticCycle)
      this.recordAutomaticCycleAssignment(
        userId,
        issue,
        before.statusId,
        automaticCycle,
        input.idempotencyKey,
      );
    this.recordReceipt(userId, "issue.update", input.idempotencyKey, input, issue);
    return issue;
  }

  reorderIssue(userId: string, input: ReorderIssueInput): Issue {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Issue>(userId, "issue.reorder", input.idempotencyKey, input);
    if (existing) return existing;

    const target = this.issues.get(input.issueId);
    if (
      !target ||
      target.userId !== userId ||
      target.deletedAt !== null ||
      target.archivedAt !== null
    )
      throw notFound();
    if (target.version !== input.version)
      throw conflict("ISSUE_VERSION_CONFLICT", "Issueが別の場所で更新されています。");
    if (input.beforeIssueId === target.id)
      throw validationError({ beforeIssueId: ["移動先には対象Issue自身を指定できません。"] });

    if (input.projectId !== undefined) {
      const project = this.projects.get(input.projectId);
      if (
        !project ||
        project.userId !== userId ||
        project.deletedAt ||
        target.projectId !== project.id
      )
        throw notFound();
    }

    const before = input.beforeIssueId ? this.issues.get(input.beforeIssueId) : null;
    if (
      input.beforeIssueId &&
      (!before ||
        before.userId !== userId ||
        before.deletedAt !== null ||
        before.archivedAt !== null)
    )
      throw notFound();
    if (input.projectId !== undefined && before && before.projectId !== input.projectId)
      throw notFound();

    if (input.statusId !== undefined && input.cycleId === undefined)
      throw validationError({ cycleId: ["statusIdを指定する場合はcycleIdが必要です。"] });

    const activeIssues = [...this.issues.values()]
      .filter(
        (issue) =>
          issue.userId === userId &&
          issue.deletedAt === null &&
          issue.archivedAt === null &&
          (input.projectId === undefined || issue.projectId === input.projectId),
      )
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.createdAt - right.createdAt ||
          left.identifier.localeCompare(right.identifier, "ja"),
      );
    if (input.cycleId !== undefined) {
      const cycle = this.cycles.get(input.cycleId);
      if (!cycle || cycle.userId !== userId || target.cycleId !== cycle.id) throw notFound();
      if (cycle.status === "completed")
        throw validationError({ cycleId: ["Completed Cycleは変更できません。"] });
      if (input.statusId !== undefined) {
        const status = this.workflowStates.get(input.statusId);
        if (!status || status.userId !== userId || target.statusId !== status.id) throw notFound();
      }
    }
    const scopeIssues =
      input.cycleId === undefined
        ? activeIssues
        : activeIssues.filter(
            (issue) =>
              issue.cycleId === input.cycleId &&
              (input.statusId === undefined || issue.statusId === input.statusId),
          );
    if (!scopeIssues.some((issue) => issue.id === target.id)) throw notFound();
    if (before && !scopeIssues.some((issue) => issue.id === before.id)) throw notFound();

    const remaining = scopeIssues.filter((issue) => issue.id !== target.id);
    const insertionIndex = input.beforeIssueId
      ? remaining.findIndex((issue) => issue.id === input.beforeIssueId)
      : remaining.length;
    if (insertionIndex < 0) throw notFound();
    remaining.splice(insertionIndex, 0, target);

    const assignments = remaining.map((issue, index) => ({
      issue,
      position: input.cycleId === undefined ? index : scopeIssues[index].position,
    }));
    const changed = assignments.filter(({ issue, position }) => issue.position !== position);
    if (changed.length === 0) {
      this.recordReceipt(userId, "issue.reorder", input.idempotencyKey, input, target);
      return target;
    }

    const now = this.clock();
    const targetBefore = { version: target.version, position: target.position };
    assignments.forEach(({ issue, position }) => {
      if (issue.position === position) return;
      issue.position = position;
      issue.version += 1;
      issue.updatedAt = now;
    });
    this.recordActivity(
      userId,
      "issue",
      target.id,
      "reordered",
      `${input.idempotencyKey}:${target.id}`,
      targetBefore,
      { version: target.version, position: target.position },
    );
    this.recordOutbox(userId, "issue.reordered", `issue.reordered:${target.id}:${target.version}`, {
      issueId: target.id,
      position: target.position,
      version: target.version,
    });
    this.recordReceipt(userId, "issue.reorder", input.idempotencyKey, input, target);
    return target;
  }

  bulkUpdateIssues(userId: string, input: BulkIssueInput): Issue[] {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Issue[]>(userId, "issue.bulk", input.idempotencyKey, input);
    if (existing) return existing;
    const issueIds = [...new Set(input.issueIds)];
    if (issueIds.length < 1 || issueIds.length > 100)
      throw validationError({ issueIds: ["対象Issueは1〜100件で指定してください。"] });
    const patchFields = Object.values(input.patch).filter((value) => value !== undefined);
    if (patchFields.length !== 1)
      throw validationError({ patch: ["一括更新は一度に1項目だけ指定してください。"] });
    if (input.patch.labelIds !== undefined && input.patch.labelIds.length > 1)
      throw validationError({ labelIds: ["一括適用できるLabelは1件までです。"] });
    const issues = issueIds.map((issueId) => {
      const issue = this.issues.get(issueId);
      if (!issue || issue.userId !== userId || issue.deletedAt) throw notFound();
      return issue;
    });
    const patch = input.patch;
    if (patch.statusId) {
      const status = this.workflowStates.get(patch.statusId);
      if (!status || status.userId !== userId) throw notFound();
    }
    if (patch.projectId) {
      const project = this.projects.get(patch.projectId);
      if (!project || project.userId !== userId || project.deletedAt) throw notFound();
    }
    if (patch.cycleId) {
      const cycle = this.cycles.get(patch.cycleId);
      if (!cycle || cycle.userId !== userId) throw notFound();
    }
    if (patch.priority && !priorities.includes(patch.priority))
      throw validationError({ priority: ["優先度が不正です。"] });
    const labelIds =
      patch.labelIds === undefined ? undefined : this.ownedLabelIds(userId, patch.labelIds);
    const issueSnapshots = structuredClone(issues);
    const activityLength = this.activities.length;
    const outboxLength = this.outbox.length;
    const receiptKey = `${userId}:${input.idempotencyKey}`;
    try {
      const updated = issues.map((issue) => {
        const before = {
          version: issue.version,
          statusId: issue.statusId,
          priority: issue.priority,
          cycleId: issue.cycleId,
          projectId: issue.projectId,
          labelIds: [...issue.labelIds],
        };
        const automaticCycle =
          patch.statusId === undefined
            ? null
            : this.cycleForAutomaticIssueAssignment(
                userId,
                patch.statusId,
                issue.statusId,
                issue.cycleId,
                "cycleId" in patch,
              );
        Object.assign(issue, {
          ...patch,
          ...(labelIds === undefined ? {} : { labelIds }),
          ...(automaticCycle ? { cycleId: automaticCycle.id } : {}),
          version: issue.version + 1,
          updatedAt: this.clock(),
        });
        this.recordActivity(
          userId,
          "issue",
          issue.id,
          "bulk_updated",
          `${input.idempotencyKey}:${issue.id}`,
          before,
          {
            version: issue.version,
            statusId: issue.statusId,
            priority: issue.priority,
            cycleId: issue.cycleId,
            projectId: issue.projectId,
            labelIds: [...issue.labelIds],
          },
        );
        this.recordOutbox(
          userId,
          "issue.bulk_updated",
          `issue.bulk_updated:${issue.id}:${input.idempotencyKey}`,
          { issueId: issue.id, version: issue.version },
        );
        if (automaticCycle)
          this.recordAutomaticCycleAssignment(
            userId,
            issue,
            before.statusId,
            automaticCycle,
            `${input.idempotencyKey}:${issue.id}`,
          );
        return issue;
      });
      this.recordReceipt(userId, "issue.bulk", input.idempotencyKey, input, updated);
      return updated;
    } catch (error) {
      issues.forEach((issue, index) => Object.assign(issue, issueSnapshots[index]));
      this.activities.splice(activityLength);
      this.outbox.splice(outboxLength);
      this.receipts.delete(receiptKey);
      throw error;
    }
  }

  archiveIssue(userId: string, issueId: string, idempotencyKey: string): Issue {
    this.assertUnlocked(userId);
    const existing = this.getIssue(userId, issueId);
    const receipt = this.checkReceipt<Issue>(userId, "issue.archive", idempotencyKey, { issueId });
    if (receipt) return receipt;
    existing.archivedAt = this.clock();
    existing.updatedAt = this.clock();
    existing.version += 1;
    this.recordActivity(userId, "issue", issueId, "archived", idempotencyKey, null, {
      archivedAt: existing.archivedAt,
    });
    this.recordReceipt(userId, "issue.archive", idempotencyKey, { issueId }, existing);
    return existing;
  }

  restoreIssue(userId: string, issueId: string, idempotencyKey: string): Issue {
    this.assertUnlocked(userId);
    const issue = this.issues.get(issueId);
    if (!issue || issue.userId !== userId) throw notFound();
    const receipt = this.checkReceipt<Issue>(userId, "issue.restore", idempotencyKey, { issueId });
    if (receipt) return receipt;
    issue.archivedAt = null;
    issue.deletedAt = null;
    issue.updatedAt = this.clock();
    issue.version += 1;
    this.recordActivity(userId, "issue", issueId, "restored", idempotencyKey, null, {
      archivedAt: null,
      deletedAt: null,
    });
    this.recordReceipt(userId, "issue.restore", idempotencyKey, { issueId }, issue);
    return issue;
  }

  trashIssue(userId: string, issueId: string, idempotencyKey: string): Issue {
    this.assertUnlocked(userId);
    const receipt = this.checkReceipt<Issue>(userId, "issue.trash", idempotencyKey, { issueId });
    if (receipt) return receipt;
    const issue = this.getIssue(userId, issueId);
    issue.deletedAt = this.clock();
    issue.updatedAt = this.clock();
    issue.version += 1;
    this.recordActivity(userId, "issue", issueId, "trashed", idempotencyKey, null, {
      deletedAt: issue.deletedAt,
    });
    this.recordReceipt(userId, "issue.trash", idempotencyKey, { issueId }, issue);
    return issue;
  }

  createProject(userId: string, input: CreateProjectInput): Project {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Project>(
      userId,
      "project.create",
      input.idempotencyKey,
      input,
    );
    if (existing) return existing;
    if (!input.name.trim() || [...input.name].length > 100)
      throw validationError({ name: ["プロジェクト名は1〜100文字で入力してください。"] });
    if (input.description !== undefined && [...input.description].length > 2_000)
      throw validationError({ description: ["説明は2,000文字以内で入力してください。"] });
    for (const field of ["startAt", "targetAt"] as const) {
      const value = input[field];
      if (
        value !== undefined &&
        value !== null &&
        (!Number.isInteger(value) || !Number.isFinite(value))
      )
        throw validationError({ [field]: ["日時は整数のtimestampまたはnullで指定してください。"] });
    }
    const status = input.statusId
      ? this.projectStatuses.get(input.statusId)
      : this.ownedProjectStatuses(userId).find((item) => item.isDefault);
    if (!status || status.userId !== userId) throw notFound();
    const now = this.clock();
    const project: Project = {
      id: createId("project"),
      userId,
      name: input.name.trim(),
      statusId: status.id,
      priority: input.priority ?? "no_priority",
      color: input.color ?? "#6c7a94",
      icon: input.icon ?? "◈",
      description: input.description ?? "",
      startAt: input.startAt ?? null,
      targetAt: input.targetAt ?? null,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    this.recordActivity(userId, "project", project.id, "created", input.idempotencyKey, null, {
      name: project.name,
    });
    this.recordOutbox(userId, "project.created", `project.created:${project.id}`, {
      projectId: project.id,
    });
    this.recordReceipt(userId, "project.create", input.idempotencyKey, input, project);
    return project;
  }

  listProjects(userId: string): Project[] {
    return [...this.projects.values()]
      .filter((item) => item.userId === userId && !item.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private findProjectDisplayPreference(
    userId: string,
    projectId: string,
  ): ProjectDisplayPreference | undefined {
    return [...this.projectDisplayPreferences.values()].find(
      (item) => item.userId === userId && item.projectId === projectId,
    );
  }

  getProjectDisplayPreferences(userId: string, projectId: string): ProjectDisplayPreference {
    this.assertOwner(userId);
    const project = this.projects.get(projectId);
    if (!project || project.userId !== userId || project.deletedAt) throw notFound();
    const existing = this.findProjectDisplayPreference(userId, projectId);
    return (
      structuredClone(existing) ?? {
        id: `project-display-default:${projectId}`,
        userId,
        projectId,
        settings: defaultProjectIssueDisplaySettings(),
        updatedAt: 0,
      }
    );
  }

  listProjectDisplayPreferences(userId: string): ProjectDisplayPreference[] {
    this.assertOwner(userId);
    return [...this.projectDisplayPreferences.values()]
      .filter((item) => {
        const project = this.projects.get(item.projectId);
        return item.userId === userId && project?.userId === userId && !project.deletedAt;
      })
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
      .map((item) => structuredClone(item));
  }

  updateProjectDisplayPreferences(
    userId: string,
    projectId: string,
    input: ProjectDisplayPreferencesMutation,
  ): ProjectDisplayPreference {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const request = { projectId, displayPreferences: input.displayPreferences };
    const existingReceipt = this.checkReceipt<ProjectDisplayPreference>(
      userId,
      "project.displayPreferences.update",
      input.idempotencyKey,
      request,
    );
    if (existingReceipt) return existingReceipt;
    const project = this.projects.get(projectId);
    if (!project || project.userId !== userId || project.deletedAt) throw notFound();
    const parsed = projectIssueDisplaySettingsSchema.safeParse(input.displayPreferences);
    if (!parsed.success)
      throw validationError({ displayPreferences: ["Projectの表示設定が不正です。"] });
    if (
      parsed.data.statusFilter !== "all" &&
      (!this.workflowStates.get(parsed.data.statusFilter) ||
        this.workflowStates.get(parsed.data.statusFilter)?.userId !== userId)
    )
      throw notFound();
    if (
      parsed.data.labelFilter !== "all" &&
      (!this.labels.get(parsed.data.labelFilter) ||
        this.labels.get(parsed.data.labelFilter)?.userId !== userId)
    )
      throw notFound();

    const now = this.clock();
    const existing = this.findProjectDisplayPreference(userId, projectId);
    const preference: ProjectDisplayPreference = existing ?? {
      id: createId("project-display"),
      userId,
      projectId,
      settings: defaultProjectIssueDisplaySettings(),
      updatedAt: now,
    };
    preference.settings = structuredClone(parsed.data);
    preference.updatedAt = now;
    this.projectDisplayPreferences.set(preference.id, preference);
    this.recordReceipt(
      userId,
      "project.displayPreferences.update",
      input.idempotencyKey,
      request,
      preference,
    );
    return structuredClone(preference);
  }

  getProjectMetrics(userId: string, projectId: string): CycleMetrics {
    const project = this.projects.get(projectId);
    if (!project || project.userId !== userId || project.deletedAt) throw notFound();
    const issues = [...this.issues.values()].filter(
      (issue) => issue.userId === userId && issue.projectId === project.id && !issue.deletedAt,
    );
    return calculateCycleMetrics(issues, this.ownedWorkflowStates(userId));
  }

  updateProject(userId: string, input: UpdateProjectInput): Project {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Project>(
      userId,
      "project.update",
      input.idempotencyKey,
      input,
    );
    if (existing) return existing;
    const project = this.projects.get(input.id);
    if (!project || project.userId !== userId || project.deletedAt) throw notFound();
    if (
      input.patch.name !== undefined &&
      (!input.patch.name.trim() || [...input.patch.name].length > 100)
    )
      throw validationError({ name: ["プロジェクト名は1〜100文字で入力してください。"] });
    if (input.patch.description !== undefined && [...input.patch.description].length > 2_000)
      throw validationError({ description: ["説明は2,000文字以内で入力してください。"] });
    for (const field of ["startAt", "targetAt"] as const) {
      const value = input.patch[field];
      if (
        value !== undefined &&
        value !== null &&
        (!Number.isInteger(value) || !Number.isFinite(value))
      )
        throw validationError({ [field]: ["日時は整数のtimestampまたはnullで指定してください。"] });
    }
    if (input.patch.statusId) {
      const status = this.projectStatuses.get(input.patch.statusId);
      if (!status || status.userId !== userId) throw notFound();
    }
    const before = { ...project };
    const safePatch = Object.fromEntries(
      Object.entries(input.patch).filter(([key]) =>
        [
          "name",
          "description",
          "statusId",
          "priority",
          "color",
          "icon",
          "startAt",
          "targetAt",
        ].includes(key),
      ),
    );
    Object.assign(project, safePatch, { updatedAt: this.clock() });
    this.recordActivity(
      userId,
      "project",
      project.id,
      "updated",
      input.idempotencyKey,
      { name: before.name },
      { name: project.name },
    );
    this.recordReceipt(userId, "project.update", input.idempotencyKey, input, project);
    return project;
  }

  archiveProject(userId: string, id: string, idempotencyKey: string): Project {
    this.assertUnlocked(userId);
    const project = this.projects.get(id);
    if (!project || project.userId !== userId || project.deletedAt) throw notFound();
    const existing = this.checkReceipt<Project>(userId, "project.archive", idempotencyKey, { id });
    if (existing) return existing;
    project.archivedAt = this.clock();
    project.updatedAt = this.clock();
    this.recordActivity(userId, "project", id, "archived", idempotencyKey, null, {
      archivedAt: project.archivedAt,
    });
    this.recordReceipt(userId, "project.archive", idempotencyKey, { id }, project);
    return project;
  }

  listCycles(userId: string): Cycle[] {
    return [...this.cycles.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.startsAt - b.startsAt);
  }

  ensureUpcomingCycles(userId: string): void {
    const settings = this.cycleSettings.get(userId);
    if (!settings || settings.futureCount <= 0) return;
    const ownedCycles = [...this.cycles.values()].filter((cycle) => cycle.userId === userId);
    if (ownedCycles.length === 0) {
      const startsAt = this.clock();
      const initial: Cycle = {
        id: createId("cycle"),
        userId,
        number: 1,
        name: "Cycle 1",
        nameOverride: null,
        description: "",
        startsAt,
        endsAt: startsAt + settings.durationWeeks * 7 * DAY,
        status: "active",
        completedAt: null,
        scheduleOverridden: false,
      };
      this.cycles.set(initial.id, initial);
      ownedCycles.push(initial);
    }
    const upcoming = ownedCycles
      .filter((cycle) => cycle.status === "upcoming")
      .sort((left, right) => left.number - right.number);
    if (upcoming.length >= settings.futureCount) return;
    let previous = ownedCycles
      .filter((cycle) => cycle.status === "active" || cycle.status === "upcoming")
      .sort((left, right) => left.number - right.number)
      .at(-1);
    previous ??= ownedCycles.sort((left, right) => left.number - right.number).at(-1);
    if (!previous) return;
    while (upcoming.length < settings.futureCount) {
      const next = this.createNextCycle(userId, previous);
      upcoming.push(next);
      previous = next;
    }
  }

  updateCycleSettings(userId: string, input: UpdateCycleSettingsInput): CycleSettings {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<CycleSettings>(
      userId,
      "cycle.settings.update",
      input.idempotencyKey,
      input,
    );
    if (existing) return existing;
    const settings = this.cycleSettings.get(userId);
    if (!settings) throw notFound();
    if (
      !Number.isInteger(input.durationWeeks) ||
      input.durationWeeks < 1 ||
      input.durationWeeks > 8
    )
      throw validationError({ durationWeeks: ["Cycle期間は1〜8週間で指定してください。"] });
    if (!Number.isInteger(input.startWeekday) || input.startWeekday < 0 || input.startWeekday > 6)
      throw validationError({ startWeekday: ["開始曜日は0〜6で指定してください。"] });
    const cooldownWeeks = input.cooldownWeeks ?? settings.cooldownWeeks;
    if (!Number.isInteger(cooldownWeeks) || cooldownWeeks < 0 || cooldownWeeks > 4)
      throw validationError({ cooldownWeeks: ["Cooldownは0〜4週間で指定してください。"] });
    const futureCount = input.futureCount ?? settings.futureCount;
    if (!Number.isInteger(futureCount) || futureCount < 1 || futureCount > 15)
      throw validationError({ futureCount: ["将来Cycle数は1〜15件で指定してください。"] });
    const autoAddToCurrentCycle =
      input.autoAddToCurrentCycle ?? settings.autoAddToCurrentCycle ?? false;
    const timezone = this.preferences.get(userId)?.timezone;
    if (!timezone || !isValidTimeZone(timezone))
      throw validationError({ timezone: ["IANA timezoneを指定してください。"] });

    const nextSettings: CycleSettings = {
      ...settings,
      durationWeeks: input.durationWeeks,
      startWeekday: input.startWeekday,
      cooldownWeeks,
      futureCount,
      autoAddToCurrentCycle,
    };
    const updates = this.upcomingScheduleUpdates(userId, nextSettings, timezone);
    const before = {
      durationWeeks: settings.durationWeeks,
      startWeekday: settings.startWeekday,
      cooldownWeeks: settings.cooldownWeeks,
      futureCount: settings.futureCount,
      autoAddToCurrentCycle: settings.autoAddToCurrentCycle,
    };
    settings.durationWeeks = input.durationWeeks;
    settings.startWeekday = input.startWeekday;
    settings.cooldownWeeks = cooldownWeeks;
    settings.futureCount = futureCount;
    settings.autoAddToCurrentCycle = autoAddToCurrentCycle;
    updates.forEach(({ cycle, startsAt, endsAt }) => {
      cycle.startsAt = startsAt;
      cycle.endsAt = endsAt;
    });
    const after = {
      durationWeeks: settings.durationWeeks,
      startWeekday: settings.startWeekday,
      cooldownWeeks: settings.cooldownWeeks,
      futureCount: settings.futureCount,
      autoAddToCurrentCycle: settings.autoAddToCurrentCycle,
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      this.recordActivity(
        userId,
        "cycle_settings",
        userId,
        "updated",
        input.idempotencyKey,
        before,
        after,
      );
      this.recordOutbox(
        userId,
        "cycle_settings.updated",
        `cycle_settings.updated:${userId}:${input.idempotencyKey}`,
        {
          durationWeeks: settings.durationWeeks,
          startWeekday: settings.startWeekday,
          cooldownWeeks: settings.cooldownWeeks,
          futureCount: settings.futureCount,
          autoAddToCurrentCycle: settings.autoAddToCurrentCycle,
        },
      );
    }
    this.recordReceipt(userId, "cycle.settings.update", input.idempotencyKey, input, settings);
    return settings;
  }

  private upcomingScheduleUpdates(
    userId: string,
    settings: CycleSettings,
    timezone: string,
  ): Array<{ cycle: Cycle; startsAt: number; endsAt: number }> {
    const cycles = this.listCycles(userId);
    const upcoming = cycles
      .filter((cycle) => cycle.status === "upcoming")
      .sort((left, right) => left.number - right.number);
    if (upcoming.length === 0) return [];
    const active = cycles.find((cycle) => cycle.status === "active");
    const previous =
      active ??
      cycles
        .filter((cycle) => cycle.number < upcoming[0].number)
        .sort((left, right) => left.number - right.number)
        .at(-1);
    let cursor = previous?.endsAt ?? upcoming[0].startsAt;
    const updates: Array<{ cycle: Cycle; startsAt: number; endsAt: number }> = [];
    for (const cycle of upcoming) {
      if (cycle.scheduleOverridden) {
        cursor = Math.max(cursor, cycle.endsAt);
        continue;
      }
      const startsAt = nextCycleStartAt(
        cursor,
        settings.startWeekday,
        timezone,
        settings.cooldownWeeks,
      );
      const endsAt = cycleEndAt(startsAt, settings.durationWeeks, timezone);
      updates.push({ cycle, startsAt, endsAt });
      cursor = endsAt;
    }
    return updates;
  }

  updateCycleSchedule(userId: string, cycleId: string, input: UpdateCycleScheduleInput): Cycle {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const request = { cycleId, ...input };
    const existing = this.checkReceipt<Cycle>(
      userId,
      "cycle.schedule.update",
      input.idempotencyKey,
      request,
    );
    if (existing) return existing;
    const cycle = this.cycles.get(cycleId);
    if (!cycle || cycle.userId !== userId) throw notFound();
    if (cycle.status !== "upcoming")
      throw validationError({ cycleId: ["日付を調整できるのはUpcoming Cycleだけです。"] });
    const timezone = this.preferences.get(userId)?.timezone;
    if (!timezone || !isValidTimeZone(timezone))
      throw validationError({ timezone: ["IANA timezoneを指定してください。"] });

    let startsAt: number;
    let endsAt: number;
    try {
      startsAt = localDateAtMidnight(input.startDate, timezone);
    } catch {
      throw validationError({ startDate: ["開始日は有効なYYYY-MM-DDで指定してください。"] });
    }
    try {
      endsAt = localDateAtMidnight(input.endDate, timezone);
    } catch {
      throw validationError({ endDate: ["終了日は有効なYYYY-MM-DDで指定してください。"] });
    }
    if (endsAt <= startsAt)
      throw validationError({ endDate: ["終了日は開始日より後にしてください。"] });

    const previousCycles = this.listCycles(userId).filter(
      (item) => item.id !== cycle.id && item.number < cycle.number,
    );
    if (previousCycles.some((item) => item.startsAt < endsAt && startsAt < item.endsAt))
      throw validationError({ startDate: ["他のCycleと期間が重複しています。"] });

    const settings = this.cycleSettings.get(userId);
    if (!settings) throw notFound();
    const following = this.listCycles(userId)
      .filter((item) => item.status === "upcoming" && item.number > cycle.number)
      .sort((left, right) => left.number - right.number);
    const updates: Array<{ cycle: Cycle; startsAt: number; endsAt: number }> = [];
    let cursor = endsAt;
    for (const future of following) {
      if (future.scheduleOverridden) {
        if (future.startsAt < cursor)
          throw validationError({ endDate: ["後続の個別調整済みCycleと期間が重複しています。"] });
        cursor = Math.max(cursor, future.endsAt);
        continue;
      }
      const nextStartsAt = nextCycleStartAt(
        cursor,
        settings.startWeekday,
        timezone,
        settings.cooldownWeeks,
      );
      const nextEndsAt = cycleEndAt(nextStartsAt, settings.durationWeeks, timezone);
      updates.push({ cycle: future, startsAt: nextStartsAt, endsAt: nextEndsAt });
      cursor = nextEndsAt;
    }

    const before = {
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      scheduleOverridden: cycle.scheduleOverridden,
    };
    cycle.startsAt = startsAt;
    cycle.endsAt = endsAt;
    cycle.scheduleOverridden = true;
    updates.forEach((update) => {
      update.cycle.startsAt = update.startsAt;
      update.cycle.endsAt = update.endsAt;
    });
    this.recordActivity(
      userId,
      "cycle",
      cycle.id,
      "schedule_updated",
      input.idempotencyKey,
      before,
      {
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
        scheduleOverridden: cycle.scheduleOverridden,
      },
    );
    this.recordOutbox(
      userId,
      "cycle.schedule.updated",
      `cycle.schedule.updated:${cycle.id}:${input.idempotencyKey}`,
      {
        cycleId: cycle.id,
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
        scheduleOverridden: cycle.scheduleOverridden,
      },
    );
    this.recordReceipt(userId, "cycle.schedule.update", input.idempotencyKey, request, cycle);
    return cycle;
  }

  updateCycleMetadata(userId: string, cycleId: string, input: UpdateCycleMetadataInput): Cycle {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Cycle>(
      userId,
      "cycle.metadata.update",
      input.idempotencyKey,
      { cycleId, ...input },
    );
    if (existing) return existing;
    const cycle = this.cycles.get(cycleId);
    if (!cycle || cycle.userId !== userId) throw notFound();
    if (
      input.nameOverride !== undefined &&
      input.nameOverride !== null &&
      ([...input.nameOverride].length < 1 || [...input.nameOverride].length > 100)
    )
      throw validationError({ nameOverride: ["Cycle名は1〜100文字で入力してください。"] });
    if (input.description !== undefined && [...input.description].length > 2_000)
      throw validationError({ description: ["説明は2,000文字以内で入力してください。"] });
    if (input.nameOverride !== undefined) cycle.nameOverride = input.nameOverride;
    if (input.description !== undefined) cycle.description = input.description;
    this.recordActivity(userId, "cycle", cycle.id, "updated", input.idempotencyKey, null, {
      nameOverride: cycle.nameOverride,
      descriptionLength: [...cycle.description].length,
    });
    this.recordOutbox(
      userId,
      "cycle.updated",
      `cycle.updated:${cycle.id}:${input.idempotencyKey}`,
      { cycleId: cycle.id },
    );
    this.recordReceipt(
      userId,
      "cycle.metadata.update",
      input.idempotencyKey,
      { cycleId, ...input },
      cycle,
    );
    return cycle;
  }

  getCycleMetrics(userId: string, cycleId: string): CycleMetrics {
    const cycle = this.cycles.get(cycleId);
    if (!cycle || cycle.userId !== userId) throw notFound();
    const issues = [...this.issues.values()].filter(
      (issue) => issue.userId === userId && issue.cycleId === cycle.id && !issue.deletedAt,
    );
    return calculateCycleMetrics(issues, this.ownedWorkflowStates(userId));
  }

  closeCycle(userId: string, cycleId: string, idempotencyKey: string, runId?: string): Cycle {
    this.assertUnlocked(userId, runId);
    validateKey(idempotencyKey);
    const request = { cycleId, runId: runId ?? null };
    const existing = this.checkReceipt<Cycle>(userId, "cycle.close", idempotencyKey, request);
    if (existing) return existing;
    const cycle = this.cycles.get(cycleId);
    if (!cycle || cycle.userId !== userId) throw notFound();
    if (cycle.status === "completed") {
      this.recordReceipt(userId, "cycle.close", idempotencyKey, request, cycle);
      return cycle;
    }
    const next =
      this.listCycles(userId).find((item) => item.number === cycle.number + 1) ??
      this.createNextCycle(userId, cycle);
    cycle.status = "completed";
    cycle.completedAt = this.clock();
    const moveable = this.matchingIssues(userId, {
      ...defaultQuery(),
      filter: { cycleIds: [cycle.id] },
    }).filter((issue) => {
      const state = this.workflowStates.get(issue.statusId);
      return state?.category === "unstarted" || state?.category === "started";
    });
    for (const issue of moveable) {
      issue.cycleId = next.id;
      issue.updatedAt = this.clock();
      issue.version += 1;
      if (
        !this.cycleHistory.some(
          (item) =>
            item.issueId === issue.id &&
            item.fromCycleId === cycle.id &&
            item.toCycleId === next.id,
        )
      ) {
        this.cycleHistory.push({
          id: createId("history"),
          userId,
          issueId: issue.id,
          fromCycleId: cycle.id,
          toCycleId: next.id,
          movedAt: this.clock(),
        });
      }
    }
    this.recordOutbox(userId, "cycle.completed", `cycle.completed:${cycle.id}`, {
      cycleId: cycle.id,
      moved: moveable.length,
    });
    this.recordReceipt(userId, "cycle.close", idempotencyKey, request, cycle);
    return cycle;
  }

  startCycle(userId: string, cycleId: string, idempotencyKey: string): Cycle {
    this.assertUnlocked(userId);
    validateKey(idempotencyKey);
    const request = { cycleId };
    const existing = this.checkReceipt<Cycle>(userId, "cycle.start", idempotencyKey, request);
    if (existing) return existing;
    const target = this.cycles.get(cycleId);
    if (!target || target.userId !== userId) throw notFound();
    if (target.status !== "upcoming")
      throw validationError({ cycleId: ["開始できるのはUpcoming Cycleだけです。"] });
    const active = this.listCycles(userId).find((cycle) => cycle.status === "active");
    if (active && target.number !== active.number + 1)
      throw validationError({ cycleId: ["現在Cycleの次Cycleだけ開始できます。"] });
    const now = this.clock();
    const settings = this.cycleSettings.get(userId)!;
    const duration = settings.durationWeeks * 7 * DAY;
    const nextStartsAt = now;
    const nextEndsAt = now + duration;
    const timezone = this.preferences.get(userId)?.timezone ?? "UTC";
    const futureUpdates: Array<{ cycle: Cycle; startsAt: number; endsAt: number }> = [];
    let cursor = nextEndsAt;
    for (const future of this.listCycles(userId)
      .filter((cycle) => cycle.number > target.number && cycle.status === "upcoming")
      .sort((left, right) => left.number - right.number)) {
      if (future.scheduleOverridden) {
        if (future.startsAt < cursor)
          throw validationError({
            cycleId: ["個別調整済みCycleの日付が重複するため開始できません。"],
          });
        cursor = future.endsAt;
        continue;
      }
      const startsAt = nextCycleStartAt(
        cursor,
        settings.startWeekday,
        timezone,
        settings.cooldownWeeks,
      );
      const endsAt = cycleEndAt(startsAt, settings.durationWeeks, timezone);
      futureUpdates.push({ cycle: future, startsAt, endsAt });
      cursor = endsAt;
    }
    if (active) this.closeCycle(userId, active.id, createId("cycle-start-close"));

    target.status = "active";
    target.startsAt = nextStartsAt;
    target.endsAt = nextEndsAt;
    target.completedAt = null;
    for (const update of futureUpdates) {
      update.cycle.startsAt = update.startsAt;
      update.cycle.endsAt = update.endsAt;
    }
    this.recordActivity(userId, "cycle", target.id, "started", idempotencyKey, null, {
      startsAt: target.startsAt,
      endsAt: target.endsAt,
    });
    this.recordOutbox(userId, "cycle.started", `cycle.started:${target.id}`, {
      cycleId: target.id,
    });
    this.recordReceipt(userId, "cycle.start", idempotencyKey, request, target);
    return target;
  }

  private createNextCycle(userId: string, previous: Cycle): Cycle {
    const settings = this.cycleSettings.get(userId)!;
    const timezone = this.preferences.get(userId)?.timezone ?? "UTC";
    const id = createId("cycle");
    const startsAt = nextCycleStartAt(
      previous.endsAt,
      settings.startWeekday,
      timezone,
      settings.cooldownWeeks,
    );
    const cycle: Cycle = {
      id,
      userId,
      number: previous.number + 1,
      name: `Cycle ${previous.number + 1}`,
      nameOverride: null,
      description: "",
      startsAt,
      endsAt: cycleEndAt(startsAt, settings.durationWeeks, timezone),
      status: "upcoming",
      completedAt: null,
      scheduleOverridden: false,
    };
    this.cycles.set(id, cycle);
    return cycle;
  }

  createView(userId: string, input: CreateViewInput): SavedView {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<SavedView>(
      userId,
      "view.create",
      input.idempotencyKey,
      input,
    );
    if (existing) return existing;
    if (!input.name.trim() || [...input.name].length > 80)
      throw validationError({ name: ["View名は1〜80文字で入力してください。"] });
    const now = this.clock();
    const layout = input.layout ?? input.query.layout;
    const view: SavedView = {
      id: createId("view"),
      userId,
      name: input.name.trim(),
      query: { ...input.query, layout },
      layout,
      createdAt: now,
      updatedAt: now,
    };
    this.views.set(view.id, view);
    this.recordReceipt(userId, "view.create", input.idempotencyKey, input, view);
    return view;
  }

  listViews(userId: string): SavedView[] {
    return [...this.views.values()]
      .filter((item) => item.userId === userId)
      .map((item) => {
        const layout = item.layout ?? item.query.layout;
        if (layout !== undefined) {
          item.layout = layout;
          item.query = { ...item.query, layout };
        }
        return item;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  updateView(userId: string, viewId: string, input: UpdateViewInput): SavedView {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<SavedView>(userId, "view.update", input.idempotencyKey, {
      viewId,
      ...input,
    });
    if (existing) return existing;
    const view = this.views.get(viewId);
    if (!view || view.userId !== userId) throw notFound();
    if (input.name !== undefined && (!input.name.trim() || [...input.name].length > 80))
      throw validationError({ name: ["View名は1〜80文字で入力してください。"] });
    if (input.name !== undefined) view.name = input.name.trim();
    if (input.query !== undefined) view.query = input.query;
    const layout = input.layout ?? input.query?.layout;
    if (layout !== undefined) {
      view.layout = layout;
      view.query = { ...view.query, layout };
    }
    view.updatedAt = this.clock();
    this.recordReceipt(userId, "view.update", input.idempotencyKey, { viewId, ...input }, view);
    return view;
  }

  deleteView(userId: string, id: string, idempotencyKey: string): void {
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<boolean>(userId, "view.delete", idempotencyKey, { id });
    if (existing !== null) return;
    const view = this.views.get(id);
    if (!view || view.userId !== userId) throw notFound();
    this.views.delete(id);
    this.recordReceipt(userId, "view.delete", idempotencyKey, { id }, true);
  }

  listNotifications(userId: string): Notification[] {
    return [...this.notifications.values()]
      .filter((item) => item.userId === userId && !item.deletedAt)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  markNotification(
    userId: string,
    id: string,
    read: boolean,
    idempotencyKey: string,
  ): Notification {
    this.assertUnlocked(userId);
    const notification = this.notifications.get(id);
    if (!notification || notification.userId !== userId || notification.deletedAt) throw notFound();
    const existing = this.checkReceipt<Notification>(userId, "notification.read", idempotencyKey, {
      id,
      read,
    });
    if (existing) return existing;
    notification.readAt = read ? this.clock() : null;
    this.recordReceipt(userId, "notification.read", idempotencyKey, { id, read }, notification);
    return notification;
  }

  recordRecentIssueView(
    userId: string,
    issueId: string,
    idempotencyKey: string,
  ): RecentIssueViewRecord {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const request = { issueId };
    const existing = this.checkReceipt<RecentIssueViewRecord>(
      userId,
      "recent.issueView",
      idempotencyKey,
      request,
    );
    if (existing) return existing;
    const issue = this.getIssue(userId, issueId);
    const current = [...this.recentIssueViews.values()].find(
      (item) => item.userId === userId && item.issueId === issue.id,
    );
    const record: RecentIssueViewRecord = current ?? {
      id: createId("recent-issue"),
      userId,
      issueId: issue.id,
      viewedAt: this.clock(),
    };
    record.viewedAt = this.clock();
    this.recentIssueViews.set(record.id, record);
    this.trimRecentIssueViews(userId);
    this.recordReceipt(userId, "recent.issueView", idempotencyKey, request, record);
    return structuredClone(record);
  }

  recordRecentSearch(
    userId: string,
    query: IssueSearchQuery,
    idempotencyKey: string,
  ): RecentSearchRecord {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const parsed = issueSearchQuerySchema.safeParse(query);
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const normalized = parsed.data;
    const request = { query: normalized };
    const existing = this.checkReceipt<RecentSearchRecord>(
      userId,
      "recent.search",
      idempotencyKey,
      request,
    );
    if (existing) return existing;
    const queryKey = canonicalMutationJson("recent.search.query", normalized);
    const current = [...this.recentSearches.values()].find(
      (item) =>
        item.userId === userId &&
        canonicalMutationJson("recent.search.query", item.query) === queryKey,
    );
    const record: RecentSearchRecord = current ?? {
      id: createId("recent-search"),
      userId,
      query: normalized,
      searchedAt: this.clock(),
    };
    record.query = normalized;
    record.searchedAt = this.clock();
    this.recentSearches.set(record.id, record);
    this.trimRecentSearches(userId);
    this.recordReceipt(userId, "recent.search", idempotencyKey, request, record);
    return structuredClone(record);
  }

  private trimRecentIssueViews(userId: string): void {
    const records = [...this.recentIssueViews.values()]
      .filter((item) => item.userId === userId)
      .sort((left, right) => right.viewedAt - left.viewedAt || right.id.localeCompare(left.id));
    records.slice(20).forEach((item) => this.recentIssueViews.delete(item.id));
  }

  private trimRecentSearches(userId: string): void {
    const records = [...this.recentSearches.values()]
      .filter((item) => item.userId === userId)
      .sort((left, right) => right.searchedAt - left.searchedAt || right.id.localeCompare(left.id));
    records.slice(20).forEach((item) => this.recentSearches.delete(item.id));
  }

  listRecent(userId: string): {
    issueViews: RecentIssueViewRecord[];
    searches: RecentSearchRecord[];
  } {
    this.assertOwner(userId);
    const issueViews = [...this.recentIssueViews.values()]
      .filter((item) => {
        const issue = this.issues.get(item.issueId);
        return item.userId === userId && issue?.userId === userId && issue.deletedAt === null;
      })
      .sort((left, right) => right.viewedAt - left.viewedAt || right.id.localeCompare(left.id))
      .slice(0, 20);
    const searches = [...this.recentSearches.values()]
      .filter((item) => item.userId === userId)
      .sort((left, right) => right.searchedAt - left.searchedAt || right.id.localeCompare(left.id))
      .slice(0, 20);
    return { issueViews: structuredClone(issueViews), searches: structuredClone(searches) };
  }

  search(userId: string, text: string, query: Partial<IssueQuery> = {}): Issue[] {
    return this.listIssues(userId, { ...query, filter: { ...query.filter, text } }, "active");
  }

  bootstrap(userId: string): BootstrapPayload {
    this.assertOwner(userId);
    this.ensureUpcomingCycles(userId);
    const active = this.currentRun(userId);
    const lastRun = [...this.runs.values()]
      .reverse()
      .filter((run) => run.user_id === userId)
      .sort((left, right) => right.requested_at - left.requested_at)[0];
    return {
      me: this.users.get(userId)!,
      preferences: this.preferences.get(userId)!,
      cycleSettings: this.cycleSettings.get(userId)!,
      workflowStates: this.ownedWorkflowStates(userId),
      projectStatuses: this.ownedProjectStatuses(userId),
      issues: this.matchingIssues(userId, defaultQuery()),
      labels: this.listLabels(userId),
      projects: this.listProjects(userId),
      cycles: this.listCycles(userId),
      cycleHistory: this.listCycleHistory(userId),
      views: this.listViews(userId),
      projectDisplayPreferences: this.listProjectDisplayPreferences(userId),
      notifications: this.listNotifications(userId),
      background: {
        run: active ? this.publicRun(active) : null,
        lastRun: lastRun ? this.publicRun(lastRun) : null,
      },
    };
  }

  updatePreferences(
    userId: string,
    patch: Partial<
      Pick<Preferences, "timezone" | "locale" | "theme" | "colorTheme" | "estimateEnabled">
    >,
    idempotencyKey: string,
  ): Preferences {
    this.assertOwner(userId);
    this.assertUnlocked(userId);
    const existing = this.checkReceipt<Preferences>(
      userId,
      "preferences.update",
      idempotencyKey,
      patch,
    );
    if (existing) return existing;
    const preferences = this.preferences.get(userId);
    if (!preferences) throw notFound();
    if (
      patch.timezone !== undefined &&
      (typeof patch.timezone !== "string" || !isValidTimeZone(patch.timezone))
    )
      throw validationError({ timezone: ["IANA timezoneを指定してください。"] });
    if (patch.locale !== undefined && !["ja", "en"].includes(patch.locale))
      throw validationError({ locale: ["ja / en から選択してください。"] });
    if (patch.theme !== undefined && !["light", "dark", "system"].includes(patch.theme))
      throw validationError({ theme: ["light / dark / systemから選択してください。"] });
    if (
      patch.colorTheme !== undefined &&
      !colorThemeValues.includes(patch.colorTheme as (typeof colorThemeValues)[number])
    )
      throw validationError({
        colorTheme: ["coral / ocean / violet / forest / amberから選択してください。"],
      });
    const safePatch = Object.fromEntries(
      Object.entries(patch).filter(([key]) =>
        ["timezone", "locale", "theme", "colorTheme", "estimateEnabled"].includes(key),
      ),
    );
    if (patch.estimateEnabled !== undefined && typeof patch.estimateEnabled !== "boolean")
      throw validationError({ estimateEnabled: ["estimateEnabledはbooleanで指定してください。"] });
    Object.assign(preferences, safePatch);
    this.recordReceipt(userId, "preferences.update", idempotencyKey, patch, preferences);
    return preferences;
  }

  currentRun(userId: string): BackgroundRun | null {
    this.expireRunIfNeeded(userId);
    const eligible = [...this.runs.values()]
      .filter(
        (run) =>
          run.user_id === userId && ["pending", "running", "paused", "failed"].includes(run.status),
      )
      .sort((a, b) => b.requested_at - a.requested_at);
    return eligible[0] ?? null;
  }

  hasBackgroundStateChanges(): boolean {
    return this.backgroundStateDirty;
  }

  clearBackgroundStateChanges(): void {
    this.backgroundStateDirty = false;
  }

  hasRejectedRunStateChanges(): boolean {
    return this.rejectedRunStateDirty;
  }

  clearRejectedRunStateChanges(): void {
    this.rejectedRunStateDirty = false;
  }

  getRun(userId: string, runId: string): BackgroundRun {
    this.expireRunIfNeeded(userId);
    const run = this.runs.get(runId);
    if (!run || run.user_id !== userId) throw notFound();
    return run;
  }

  lockTokenFor(userId: string, runId: string): string {
    this.expireRunIfNeeded(userId);
    const lock = this.locks.get(userId);
    if (
      !lock ||
      lock.status !== "running" ||
      lock.runId !== runId ||
      !lock.token ||
      (lock.leaseExpiresAt ?? 0) <= this.clock()
    )
      throw locked("RunのLeaseが競合しています。");
    return lock.token;
  }

  startRun(userId: string, input: MaintenanceRunInput): BackgroundRun {
    this.assertOwner(userId);
    validateKey(input.idempotencyKey);
    if (input.kind !== "maintenance")
      throw validationError({ kind: ["maintenanceのみ指定できます。"] });
    const existing = [...this.runs.values()].find(
      (run) => run.user_id === userId && run.idempotencyKey === input.idempotencyKey,
    );
    const hash = requestHash("background.create", { kind: input.kind });
    if (existing) {
      if (existing.requestHash !== hash)
        throw conflict("IDEMPOTENCY_KEY_REUSED", "同じキーで異なる内容は送信できません。");
      if (existing.status === "rejected")
        throw conflict(
          "BACKGROUND_RUN_REJECTED",
          "このRunは競合により拒否済みです。新しいキーで再実行してください。",
        );
      return existing;
    }
    this.expireRunIfNeeded(userId);
    const now = this.clock();
    const lock = this.locks.get(userId)!;
    const blockingRun = [...this.runs.values()].find(
      (run) => run.user_id === userId && (run.status === "pending" || run.status === "running"),
    );
    if (blockingRun || (lock.status === "running" && (lock.leaseExpiresAt ?? 0) > now)) {
      const rejected: BackgroundRun = this.makeRun(userId, input, "rejected", now);
      this.runs.set(rejected.run_id, rejected);
      this.rejectedRunStateDirty = true;
      throw locked();
    }
    const run = this.makeRun(userId, input, "running", now);
    lock.status = "running";
    lock.runId = run.run_id;
    lock.token = createId("lock");
    lock.leaseExpiresAt = now + RUN_LEASE_MS;
    run.started_at = now;
    run.heartbeat_at = now;
    run.leaseExpiresAt = lock.leaseExpiresAt;
    run.stepStatuses.cycle_transition = "running";
    run.progress.current_step = "cycle_transition";
    this.runs.set(run.run_id, run);
    return run;
  }

  private makeRun(
    userId: string,
    input: MaintenanceRunInput,
    status: RunStatus,
    now: number,
  ): BackgroundRun {
    return {
      run_id: createId("run"),
      user_id: userId,
      kind: "maintenance",
      status,
      progress: {
        current_step: status === "running" ? "cycle_transition" : null,
        step_index: 0,
        step_count: 3,
        cursor: null,
        processed: 0,
        total: null,
        percent: status === "rejected" ? 0 : 0,
      },
      error:
        status === "rejected"
          ? {
              code: "BACKGROUND_RUN_REJECTED",
              message: "他の処理が実行中です。",
              failed_step: null,
              retryable: false,
              request_id: createId("request"),
            }
          : null,
      requested_at: now,
      started_at: status === "running" ? now : null,
      heartbeat_at: status === "running" ? now : null,
      finished_at: status === "rejected" ? now : null,
      resume_count: 0,
      idempotencyKey: input.idempotencyKey,
      requestHash: requestHash("background.create", { kind: input.kind }),
      leaseExpiresAt: status === "running" ? now + RUN_LEASE_MS : null,
      stepIndex: 0,
      stepStatuses: {
        cycle_transition:
          status === "running" ? "running" : status === "rejected" ? "skipped" : "pending",
        purge: status === "rejected" ? "skipped" : "pending",
        outbox_retry: status === "rejected" ? "skipped" : "pending",
      },
      stepCursors: { cycle_transition: null, purge: null, outbox_retry: null },
    };
  }

  continueRun(
    userId: string,
    runId: string,
    input: ContinueRunInput,
    lockToken?: string,
  ): {
    run: PublicRunSummary;
    step: RunStep | null;
    cursor: string | null;
    processed_count: number;
    next: "continue" | "resume" | "none";
  } {
    let run = this.getRun(userId, runId);
    if (run.status === "paused" || run.status === "failed")
      throw conflict("RUN_REQUIRES_RESUME", "このRunは再開操作が必要です。");
    if (run.status === "rejected")
      throw conflict("BACKGROUND_RUN_REJECTED", "このRunは拒否済みです。");
    if (run.status === "succeeded")
      return {
        run: this.publicRun(run),
        step: null,
        cursor: null,
        processed_count: 0,
        next: "none",
      };
    let lock = this.locks.get(userId)!;
    if (
      lock.runId !== runId ||
      lock.status !== "running" ||
      !lock.token ||
      lock.token !== (lockToken ?? lock.token) ||
      (lock.leaseExpiresAt ?? 0) <= this.clock()
    ) {
      this.expireRunIfNeeded(userId);
      throw locked("RunのLeaseが競合しています。");
    }
    const step = runSteps[run.stepIndex];
    const currentCursor = run.stepCursors[step];
    if (input.expected_cursor !== currentCursor)
      return {
        run: this.publicRun(run),
        step,
        cursor: currentCursor,
        processed_count: 0,
        next: "continue",
      };
    const beforeChunk = this.toSnapshot();
    run.stepStatuses[step] = "running";
    let processed = 0;
    try {
      const chunk =
        step === "cycle_transition"
          ? this.runCycleTransition(userId, runId)
          : step === "purge"
            ? this.runPurge(userId)
            : this.runOutboxRetry(userId);
      processed = chunk.processed;
      run.progress.processed += processed;
      run.progress.cursor = createId("cursor");
      run.stepCursors[step] = run.progress.cursor;
      if (!chunk.hasRemaining) {
        run.stepStatuses[step] = "succeeded";
        run.stepIndex += 1;
        run.progress.step_index = run.stepIndex;
        run.progress.current_step =
          run.stepIndex < runSteps.length ? runSteps[run.stepIndex] : null;
        run.progress.percent = Math.round((run.stepIndex / runSteps.length) * 100);
        if (run.stepIndex < runSteps.length) {
          const nextStep = runSteps[run.stepIndex];
          run.stepStatuses[nextStep] = "running";
          run.stepCursors[nextStep] = run.progress.cursor;
        }
      }
      run.heartbeat_at = this.clock();
      run.leaseExpiresAt = run.heartbeat_at + RUN_LEASE_MS;
      lock.leaseExpiresAt = run.leaseExpiresAt;
      if (run.stepIndex >= runSteps.length) {
        run.status = "succeeded";
        run.finished_at = this.clock();
        run.heartbeat_at = this.clock();
        lock.status = "idle";
        lock.runId = null;
        lock.token = null;
        lock.leaseExpiresAt = null;
      }
    } catch {
      this.restoreSnapshot(beforeChunk);
      run = this.runs.get(runId)!;
      lock = this.locks.get(userId)!;
      processed = 0;
      run.status = "failed";
      run.error = {
        code: "STEP_FAILED",
        message: "処理中にエラーが発生しました。",
        failed_step: step,
        retryable: true,
        request_id: createId("request"),
      };
      run.stepStatuses[step] = "failed";
      runSteps.slice(run.stepIndex + 1).forEach((name) => {
        run.stepStatuses[name] = "skipped";
      });
      run.finished_at = this.clock();
      lock.status = "idle";
      lock.runId = null;
      lock.token = null;
      lock.leaseExpiresAt = null;
    }
    return {
      run: this.publicRun(run),
      step: run.progress.current_step,
      cursor: run.progress.cursor,
      processed_count: processed,
      next: run.status === "succeeded" ? "none" : run.status === "failed" ? "resume" : "continue",
    };
  }

  resumeRun(userId: string, runId: string): PublicRunSummary {
    const run = this.getRun(userId, runId);
    const blockingRun = [...this.runs.values()].find(
      (candidate) =>
        candidate.user_id === userId &&
        candidate.run_id !== runId &&
        (candidate.status === "pending" || candidate.status === "running"),
    );
    if (blockingRun) throw locked();
    if (!["paused", "failed"].includes(run.status)) return this.publicRun(run);
    const now = this.clock();
    const lock = this.locks.get(userId)!;
    if (lock.status === "running" && (lock.leaseExpiresAt ?? 0) > now) throw locked();
    if (run.status === "failed") {
      const failedStep = runSteps.findIndex((step) => run.stepStatuses[step] === "failed");
      run.stepIndex = failedStep >= 0 ? failedStep : run.stepIndex;
      runSteps.slice(run.stepIndex).forEach((step) => {
        run.stepStatuses[step] = "pending";
      });
    }
    run.status = "running";
    run.error = null;
    run.resume_count += 1;
    run.heartbeat_at = now;
    run.leaseExpiresAt = now + RUN_LEASE_MS;
    run.progress.current_step = runSteps[run.stepIndex];
    run.stepStatuses[runSteps[run.stepIndex]] = "running";
    lock.status = "running";
    lock.runId = runId;
    lock.token = createId("lock");
    lock.leaseExpiresAt = run.leaseExpiresAt;
    return this.publicRun(run);
  }

  expireRunIfNeeded(userId: string): void {
    const lock = this.locks.get(userId);
    if (!lock || lock.status !== "running" || (lock.leaseExpiresAt ?? Infinity) > this.clock())
      return;
    const run = lock.runId ? this.runs.get(lock.runId) : null;
    if (run && run.status === "running") {
      run.status = "paused";
      run.error = {
        code: "LEASE_EXPIRED",
        message: "処理が一時停止しました。再開できます。",
        failed_step: run.progress.current_step,
        retryable: true,
        request_id: createId("request"),
      };
      run.progress.current_step = runSteps[run.stepIndex] ?? null;
    }
    lock.status = "idle";
    lock.runId = null;
    lock.token = null;
    lock.leaseExpiresAt = null;
    this.backgroundStateDirty = true;
  }

  private nextCycleTransition(userId: string): Cycle | undefined {
    const now = this.clock();
    const active = this.listCycles(userId).find((cycle) => cycle.status === "active");
    if (active) return active.endsAt <= now ? active : undefined;
    const next = this.listCycles(userId)
      .filter((cycle) => cycle.status === "upcoming")
      .sort((left, right) => left.number - right.number)[0];
    return next && next.startsAt <= now ? next : undefined;
  }

  private runCycleTransition(
    userId: string,
    runId: string,
  ): { processed: number; hasRemaining: boolean } {
    let processed = 0;
    while (processed < CHUNK_SIZE) {
      const next = this.nextCycleTransition(userId);
      if (!next) break;
      if (next.status === "active")
        this.closeCycle(userId, next.id, `run-${runId}-${next.id}`, runId);
      else if (!this.activateScheduledCycle(userId, next, runId)) break;
      processed += 1;
    }
    return { processed, hasRemaining: this.nextCycleTransition(userId) !== undefined };
  }

  private activateScheduledCycle(userId: string, cycle: Cycle, runId: string): boolean {
    this.assertUnlocked(userId, runId);
    if (
      cycle.userId !== userId ||
      cycle.status !== "upcoming" ||
      cycle.startsAt > this.clock() ||
      this.listCycles(userId).some((item) => item.status === "active")
    )
      return false;
    cycle.status = "active";
    cycle.completedAt = null;
    const mutationKey = `run-${runId}-${cycle.id}-start`;
    this.recordActivity(
      userId,
      "cycle",
      cycle.id,
      "started",
      mutationKey,
      null,
      { startsAt: cycle.startsAt, endsAt: cycle.endsAt },
      "system:manual-run",
    );
    this.recordOutbox(userId, "cycle.started", `cycle.started:${cycle.id}`, {
      cycleId: cycle.id,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
    });
    return true;
  }

  private purgeTargets(
    userId: string,
  ): Array<{ type: "issue" | "project" | "receipt"; id: string }> {
    const now = this.clock();
    const threshold = now - THIRTY_DAYS;
    return [
      ...[...this.issues.values()]
        .filter(
          (issue) =>
            issue.userId === userId && issue.deletedAt !== null && issue.deletedAt < threshold,
        )
        .map((issue) => ({ type: "issue" as const, id: issue.id })),
      ...[...this.projects.values()]
        .filter(
          (project) =>
            project.userId === userId &&
            project.deletedAt !== null &&
            project.deletedAt < threshold,
        )
        .map((project) => ({ type: "project" as const, id: project.id })),
      ...[...this.receipts.entries()]
        .filter(([, receipt]) => receipt.userId === userId && receipt.expiresAt < now)
        .map(([id]) => ({ type: "receipt" as const, id })),
    ];
  }

  private runPurge(userId: string): { processed: number; hasRemaining: boolean } {
    const targets = this.purgeTargets(userId);
    const chunk = targets.slice(0, CHUNK_SIZE);
    for (const target of chunk) {
      if (target.type === "issue") this.purgeIssue(userId, target.id);
      if (target.type === "project") this.projects.delete(target.id);
      if (target.type === "receipt") this.receipts.delete(target.id);
    }
    return { processed: chunk.length, hasRemaining: targets.length > chunk.length };
  }

  private purgeIssue(userId: string, issueId: string): void {
    for (const [id, note] of this.notes) {
      if (note.userId === userId && note.issueId === issueId) this.notes.delete(id);
    }
    for (const [id, relation] of this.relations) {
      if (
        relation.userId === userId &&
        (relation.sourceIssueId === issueId || relation.targetIssueId === issueId)
      )
        this.relations.delete(id);
    }
    for (const [key, record] of this.recentIssueViews) {
      if (record.userId === userId && record.issueId === issueId) this.recentIssueViews.delete(key);
    }
    for (let index = this.cycleHistory.length - 1; index >= 0; index -= 1) {
      const history = this.cycleHistory[index];
      if (history.userId === userId && history.issueId === issueId)
        this.cycleHistory.splice(index, 1);
    }
    for (const child of this.issues.values()) {
      if (child.userId === userId && child.parentId === issueId) {
        child.parentId = null;
        child.version += 1;
        child.updatedAt = this.clock();
      }
    }
    for (let index = this.activities.length - 1; index >= 0; index -= 1) {
      const activity = this.activities[index];
      if (activity.userId === userId && activity.entityId === issueId)
        this.activities.splice(index, 1);
    }
    this.issues.delete(issueId);
  }

  private runOutboxRetry(userId: string): { processed: number; hasRemaining: boolean } {
    const targets = this.outbox.filter(
      (event) => event.userId === userId && event.status === "pending",
    );
    const chunk = targets.slice(0, CHUNK_SIZE);
    for (const event of chunk) {
      event.status = "sent";
      event.attemptCount += 1;
    }
    return { processed: chunk.length, hasRemaining: targets.length > chunk.length };
  }

  publicRun(run: BackgroundRun): PublicRunSummary {
    const {
      user_id: _userId,
      idempotencyKey: _key,
      requestHash: _hash,
      leaseExpiresAt: _lease,
      stepIndex: _stepIndex,
      stepStatuses: _statuses,
      stepCursors: _cursors,
      ...publicRun
    } = run;
    return publicRun;
  }
}

const stores = new Map<string, OrbitStore>();

export function getOrbitStore(userId: string): OrbitStore {
  let store = stores.get(userId);
  if (!store) {
    store = new OrbitStore();
    store.ensureOwner(userId, `${userId}@orbit.local`, userId === "dev-owner");
    stores.set(userId, store);
  }
  return store;
}

export function peekOrbitStore(userId: string): OrbitStore | undefined {
  return stores.get(userId);
}

export function resetOrbitStores(): void {
  stores.clear();
}
