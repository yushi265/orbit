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
  IssueQuery,
  Notification,
  Preferences,
  Project,
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
  type LabelMutation,
  type LabelUpdate,
  type PreferencesMutation,
  type ReorderIssueInput,
  type SavedViewUpdate,
  type WorkflowStateCreateMutation,
  type WorkflowStateUpdateMutation,
  isValidTimeZone,
  workflowStateColorSchema,
  workflowStateNameSchema,
} from "../shared/contracts";
import { calculateCycleMetrics, type CycleMetrics } from "../shared/cycle-workspace";

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
  cycles: Cycle[];
  cycleSettings: CycleSettings[];
  issues: Issue[];
  labels: Label[];
  notes: IssueNote[];
  relations: IssueRelation[];
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
  readonly cycles = new Map<string, Cycle>();
  readonly cycleSettings = new Map<string, CycleSettings>();
  readonly issues = new Map<string, Issue>();
  readonly labels = new Map<string, Label>();
  readonly notes = new Map<string, IssueNote>();
  readonly relations = new Map<string, IssueRelation>();
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

  constructor(private readonly clock: () => number = nowMs) {}

  toSnapshot(): OrbitStoreSnapshot {
    return structuredClone({
      users: [...this.users.values()],
      preferences: [...this.preferences.values()],
      workflowStates: [...this.workflowStates.values()],
      projectStatuses: [...this.projectStatuses.values()],
      projects: [...this.projects.values()],
      cycles: [...this.cycles.values()],
      cycleSettings: [...this.cycleSettings.values()],
      issues: [...this.issues.values()],
      labels: [...this.labels.values()],
      notes: [...this.notes.values()],
      relations: [...this.relations.values()],
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
    if (!OrbitStore.isSnapshot(normalized, ownerUserId))
      throw new Error("Invalid OrbitStore snapshot");
    const source = structuredClone(normalized);
    const store = new OrbitStore(clock);
    const setById = <T extends { id: string }>(target: Map<string, T>, values: T[]) => {
      values.forEach((value) => target.set(value.id, value));
    };
    const setByUserId = <T extends { userId: string }>(target: Map<string, T>, values: T[]) => {
      values.forEach((value) => target.set(value.userId, value));
    };

    setById(store.users, source.users);
    setByUserId(store.preferences, source.preferences);
    setById(store.workflowStates, source.workflowStates);
    setById(store.projectStatuses, source.projectStatuses);
    setById(store.projects, source.projects);
    setById(store.cycles, source.cycles);
    setByUserId(store.cycleSettings, source.cycleSettings);
    setById(store.issues, source.issues);
    setById(store.labels, source.labels);
    setById(store.notes, source.notes);
    setById(store.relations, source.relations);
    setById(store.views, source.views);
    setById(store.notifications, source.notifications);
    source.runs.forEach((run) => store.runs.set(run.run_id, run));
    setByUserId(store.locks, source.locks);
    store.activities.push(...source.activities);
    store.outbox.push(...source.outbox);
    source.receipts.forEach((receipt) =>
      store.receipts.set(`${receipt.userId}:${receipt.idempotencyKey}`, receipt),
    );
    store.cycleHistory.push(...source.cycleHistory);
    store.seededUsers = new Set(source.seededUsers);
    return store;
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
      "cycles",
      "cycleSettings",
      "issues",
      "labels",
      "notes",
      "relations",
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
    const hasIdOwner = [
      "workflowStates",
      "projectStatuses",
      "projects",
      "cycles",
      "issues",
      "labels",
      "notes",
      "relations",
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
      hasTypes("views", {
        strings: ["id", "userId", "name"],
        numbers: ["createdAt", "updatedAt"],
      }) &&
      hasObjects("views", ["query", "layout"]) &&
      hasTypes("cycleSettings", {
        strings: ["userId"],
        numbers: ["durationWeeks", "cooldownWeeks", "startWeekday", "futureCount"],
        booleans: ["enabled"],
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
      "cycles",
      "cycleSettings",
      "issues",
      "labels",
      "notes",
      "relations",
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
      expiresAt: this.clock() + THIRTY_DAYS,
    });
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
    if (cycle && cycle.userId !== userId) throw notFound();
    const parent = input.parentId ? this.issues.get(input.parentId) : null;
    if (parent && parent.userId !== userId) throw notFound();
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
    preferences.issueCounter = number;
    this.issues.set(issue.id, issue);
    this.recordActivity(userId, "issue", issue.id, "created", input.idempotencyKey, null, {
      identifier: issue.identifier,
      title: issue.title,
    });
    this.recordOutbox(userId, "issue.created", `issue.created:${issue.id}`, { issueId: issue.id });
    this.recordReceipt(userId, "issue.create", input.idempotencyKey, input, issue);
    return issue;
  }

  getIssue(userId: string, issueId: string): Issue {
    const issue = this.issues.get(issueId);
    if (!issue || issue.userId !== userId || issue.deletedAt) throw notFound();
    return issue;
  }

  getIssueDetail(userId: string, issueId: string): IssueDetail {
    const issue = this.getIssue(userId, issueId);
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
      notes,
      relations,
      activity: activity.map(({ mutationKey: _mutationKey, ...publicEvent }) => publicEvent),
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

  listIssues(userId: string, query: Partial<IssueQuery> = {}): Issue[] {
    const defaults = defaultQuery();
    const resolved: IssueQuery = {
      ...defaults,
      ...query,
      filter: { ...defaults.filter, ...query.filter },
      layout: { ...defaults.layout, ...query.layout },
    };
    let items = [...this.issues.values()].filter(
      (item) => item.userId === userId && !item.deletedAt && !item.archivedAt,
    );
    const filter = resolved.filter;
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
      const now = new Date(this.clock());
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const tomorrow = today + DAY;
      items = items.filter((item) =>
        filter.due === "none"
          ? item.dueAt === null
          : filter.due === "overdue"
            ? item.dueAt !== null && item.dueAt < today
            : filter.due === "today"
              ? item.dueAt !== null && item.dueAt >= today && item.dueAt < tomorrow
              : item.dueAt !== null && item.dueAt >= tomorrow,
      );
    }
    const priorityOrder = new Map(priorities.map((priority, index) => [priority, index]));
    items.sort((a, b) => {
      if (resolved.order === "priority")
        return (
          priorityOrder.get(a.priority)! - priorityOrder.get(b.priority)! ||
          b.updatedAt - a.updatedAt
        );
      if (resolved.order === "updated") return b.updatedAt - a.updatedAt;
      if (resolved.order === "created") return b.createdAt - a.createdAt;
      if (resolved.order === "due_at")
        return (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER);
      if (resolved.order === "estimate") return (b.estimate ?? 0) - (a.estimate ?? 0);
      return a.position - b.position;
    });
    return items.slice(0, Math.min(Math.max(resolved.limit, 1), 500));
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
    const labelIds =
      patch.labelIds === undefined ? undefined : this.ownedLabelIds(userId, patch.labelIds);
    const before = { ...issue };
    Object.assign(issue, { ...patch, ...(labelIds === undefined ? {} : { labelIds }) });
    issue.version += 1;
    issue.updatedAt = this.clock();
    this.recordActivity(
      userId,
      "issue",
      issue.id,
      "updated",
      input.idempotencyKey,
      { version: before.version, statusId: before.statusId, priority: before.priority },
      { version: issue.version, statusId: issue.statusId, priority: issue.priority },
    );
    this.recordOutbox(userId, "issue.updated", `issue.updated:${issue.id}:${issue.version}`, {
      issueId: issue.id,
      version: issue.version,
    });
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

    const before = input.beforeIssueId ? this.issues.get(input.beforeIssueId) : null;
    if (
      input.beforeIssueId &&
      (!before ||
        before.userId !== userId ||
        before.deletedAt !== null ||
        before.archivedAt !== null)
    )
      throw notFound();

    const activeIssues = [...this.issues.values()]
      .filter(
        (issue) => issue.userId === userId && issue.deletedAt === null && issue.archivedAt === null,
      )
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.createdAt - right.createdAt ||
          left.identifier.localeCompare(right.identifier, "ja"),
      );
    const remaining = activeIssues.filter((issue) => issue.id !== target.id);
    const insertionIndex = input.beforeIssueId
      ? remaining.findIndex((issue) => issue.id === input.beforeIssueId)
      : remaining.length;
    if (insertionIndex < 0) throw notFound();
    remaining.splice(insertionIndex, 0, target);

    const changed = remaining.filter((issue, index) => issue.position !== index);
    if (changed.length === 0) {
      this.recordReceipt(userId, "issue.reorder", input.idempotencyKey, input, target);
      return target;
    }

    const now = this.clock();
    remaining.forEach((issue, index) => {
      if (issue.position === index) return;
      const beforeState = { version: issue.version, position: issue.position };
      issue.position = index;
      issue.version += 1;
      issue.updatedAt = now;
      this.recordActivity(
        userId,
        "issue",
        issue.id,
        "reordered",
        `${input.idempotencyKey}:${issue.id}`,
        beforeState,
        { version: issue.version, position: issue.position },
      );
      this.recordOutbox(userId, "issue.reordered", `issue.reordered:${issue.id}:${issue.version}`, {
        issueId: issue.id,
        position: issue.position,
        version: issue.version,
      });
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
        Object.assign(issue, {
          ...patch,
          ...(labelIds === undefined ? {} : { labelIds }),
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
    const moveable = this.listIssues(userId, {
      filter: { cycleIds: [cycle.id] },
      limit: 500,
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
      futureUpdates.push({ cycle: future, startsAt: cursor, endsAt: cursor + duration });
      cursor += duration;
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
    const id = createId("cycle");
    const cycle: Cycle = {
      id,
      userId,
      number: previous.number + 1,
      name: `Cycle ${previous.number + 1}`,
      nameOverride: null,
      description: "",
      startsAt: previous.endsAt,
      endsAt: previous.endsAt + settings.durationWeeks * 7 * DAY,
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

  search(userId: string, text: string): Issue[] {
    return this.listIssues(userId, { filter: { text }, order: "updated", limit: 50 });
  }

  bootstrap(userId: string): BootstrapPayload {
    this.assertOwner(userId);
    this.ensureUpcomingCycles(userId);
    const active = this.currentRun(userId);
    return {
      me: this.users.get(userId)!,
      preferences: this.preferences.get(userId)!,
      workflowStates: this.ownedWorkflowStates(userId),
      projectStatuses: this.ownedProjectStatuses(userId),
      issues: this.listIssues(userId),
      labels: this.listLabels(userId),
      projects: this.listProjects(userId),
      cycles: this.listCycles(userId),
      views: this.listViews(userId),
      notifications: this.listNotifications(userId),
      background: { run: active ? this.publicRun(active) : null },
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
    const run = this.getRun(userId, runId);
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
    const lock = this.locks.get(userId)!;
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
    run.stepStatuses[step] = "running";
    let processed = 0;
    try {
      if (step === "cycle_transition") processed = this.runCycleTransition(userId, runId);
      if (step === "purge") processed = this.runPurge(userId);
      if (step === "outbox_retry") processed = this.runOutboxRetry(userId);
      run.progress.processed += processed;
      run.progress.cursor = `${step}:${run.progress.processed}`;
      run.stepCursors[step] = run.progress.cursor;
      run.stepStatuses[step] = "succeeded";
      run.stepIndex += 1;
      run.progress.step_index = run.stepIndex;
      run.progress.current_step = run.stepIndex < runSteps.length ? runSteps[run.stepIndex] : null;
      run.progress.percent = Math.round((run.stepIndex / runSteps.length) * 100);
      if (run.stepIndex < runSteps.length) {
        const nextStep = runSteps[run.stepIndex];
        run.stepStatuses[nextStep] = "running";
        run.stepCursors[nextStep] = run.progress.cursor;
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

  private runCycleTransition(userId: string, runId: string): number {
    const now = this.clock();
    let processed = 0;
    for (const cycle of this.listCycles(userId)) {
      if (processed >= CHUNK_SIZE) break;
      if (cycle.status === "active" && cycle.endsAt <= now) {
        this.closeCycle(userId, cycle.id, `run-${runId}-${cycle.id}`, runId);
        processed += 1;
      }
    }
    return processed;
  }

  private runPurge(userId: string): number {
    const threshold = this.clock() - THIRTY_DAYS;
    let processed = 0;
    for (const [id, issue] of this.issues)
      if (
        processed < CHUNK_SIZE &&
        issue.userId === userId &&
        issue.deletedAt !== null &&
        issue.deletedAt < threshold
      ) {
        this.issues.delete(id);
        processed += 1;
      }
    for (const [id, project] of this.projects)
      if (
        processed < CHUNK_SIZE &&
        project.userId === userId &&
        project.deletedAt !== null &&
        project.deletedAt < threshold
      ) {
        this.projects.delete(id);
        processed += 1;
      }
    for (const [key, receipt] of this.receipts)
      if (processed < CHUNK_SIZE && receipt.userId === userId && receipt.expiresAt < threshold) {
        this.receipts.delete(key);
        processed += 1;
      }
    return processed;
  }

  private runOutboxRetry(userId: string): number {
    let processed = 0;
    for (const event of this.outbox)
      if (event.userId === userId && event.status === "pending" && processed < CHUNK_SIZE) {
        event.status = "sent";
        event.attemptCount += 1;
        processed += 1;
      }
    return processed;
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
