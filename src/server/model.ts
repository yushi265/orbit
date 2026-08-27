import {
  CYCLE_STATUS_VALUES,
  PRIORITY_VALUES,
  PROJECT_STATUS_CATEGORY_VALUES,
  RUN_STATUS_VALUES,
  RUN_STEP_VALUES,
  WORKFLOW_CATEGORY_VALUES,
  type CycleStatus,
  type ColorTheme,
  type Priority,
  type ProjectStatusCategory,
  type RunStatus,
  type RunStep,
  type WorkflowCategory,
  type ChildProgress,
  type IssueListScope,
  type IssueSearchQuery,
  type IssueSummary,
} from "../shared/contracts";

export const workflowCategories = WORKFLOW_CATEGORY_VALUES;
export const priorities = PRIORITY_VALUES;
export const cycleStatuses = CYCLE_STATUS_VALUES;
export const projectStatusCategories = PROJECT_STATUS_CATEGORY_VALUES;
export const runSteps = RUN_STEP_VALUES;
export const runStatuses = RUN_STATUS_VALUES;
export type { CycleStatus, Priority, ProjectStatusCategory, RunStatus, RunStep, WorkflowCategory };

export type Estimate = null | 1 | 2 | 3 | 5 | 8;
export type Locale = "ja" | "en";
export type Theme = "light" | "dark" | "system";
export type { ColorTheme };

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: number;
}

export interface Preferences {
  userId: string;
  timezone: string;
  locale: Locale;
  theme: Theme;
  colorTheme: ColorTheme;
  estimateEnabled: boolean;
  issueCounter: number;
}

export interface WorkflowState {
  id: string;
  userId: string;
  name: string;
  category: WorkflowCategory;
  color: string;
  position: number;
  isDefault: boolean;
}

export interface ProjectStatus {
  id: string;
  userId: string;
  name: string;
  category: ProjectStatusCategory;
  color: string;
  position: number;
  isDefault: boolean;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  statusId: string;
  priority: Priority;
  color: string;
  icon: string;
  description: string;
  startAt: number | null;
  targetAt: number | null;
  archivedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Cycle {
  id: string;
  userId: string;
  number: number;
  name: string;
  nameOverride: string | null;
  description: string;
  startsAt: number;
  endsAt: number;
  status: CycleStatus;
  completedAt: number | null;
  scheduleOverridden: boolean;
}

export interface CycleSettings {
  userId: string;
  enabled: boolean;
  durationWeeks: number;
  cooldownWeeks: number;
  startWeekday: number;
  futureCount: number;
}

export interface Issue {
  id: string;
  userId: string;
  number: number;
  identifier: string;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  estimate: Estimate;
  dueAt: number | null;
  projectId: string | null;
  cycleId: string | null;
  parentId: string | null;
  labelIds: string[];
  position: number;
  version: number;
  archivedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Label {
  id: string;
  userId: string;
  name: string;
  color: string;
}

export interface IssueNote {
  id: string;
  userId: string;
  issueId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  deletedAt: number | null;
}

export type IssueRelationType = "blocking" | "blocked_by" | "related" | "duplicate";

export interface IssueRelation {
  id: string;
  userId: string;
  sourceIssueId: string;
  targetIssueId: string;
  type: IssueRelationType;
  createdAt: number;
}

export interface IssueRelationView extends IssueRelation {
  target: Pick<Issue, "id" | "identifier" | "title" | "statusId">;
}

export interface IssueDetail {
  issue: Issue;
  parent: IssueSummary | null;
  children: IssueSummary[];
  childProgress: ChildProgress;
  notes: IssueNote[];
  relations: IssueRelationView[];
  activity: ActivityView[];
}

export interface RecentIssueViewRecord {
  id: string;
  userId: string;
  issueId: string;
  viewedAt: number;
}

export interface RecentSearchRecord {
  id: string;
  userId: string;
  query: IssueSearchQuery;
  searchedAt: number;
}

export type { IssueListScope, IssueSummary };

export interface SavedView {
  id: string;
  userId: string;
  name: string;
  query: IssueQuery;
  layout: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}

export interface Notification {
  id: string;
  userId: string;
  type: "due_soon" | "overdue" | "cycle_started" | "cycle_completed" | "automation_failed";
  title: string;
  body: string;
  entityType: "issue" | "cycle" | "project" | "run";
  entityId: string | null;
  readAt: number | null;
  deletedAt: number | null;
  createdAt: number;
}

export interface ActivityEvent {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: "user" | "system:manual-run";
  mutationKey: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: number;
}

export type ActivityView = Omit<ActivityEvent, "mutationKey">;

export interface OutboxEvent {
  id: string;
  userId: string;
  type: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "failed";
  attemptCount: number;
  createdAt: number;
}

export interface MutationReceipt {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  operation: string;
  response: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface RunProgress {
  current_step: RunStep | null;
  step_index: number;
  step_count: 3;
  cursor: string | null;
  processed: number;
  total: number | null;
  percent: number | null;
}

export interface RunError {
  code: string;
  message: string;
  failed_step: RunStep | null;
  retryable: boolean;
  request_id: string;
}

export interface BackgroundRun {
  run_id: string;
  user_id: string;
  kind: "maintenance";
  status: RunStatus;
  progress: RunProgress;
  error: RunError | null;
  requested_at: number;
  started_at: number | null;
  heartbeat_at: number | null;
  finished_at: number | null;
  resume_count: number;
  idempotencyKey: string;
  requestHash: string;
  leaseExpiresAt: number | null;
  stepIndex: number;
  stepStatuses: Record<RunStep, "pending" | "running" | "succeeded" | "failed" | "skipped">;
  stepCursors: Record<RunStep, string | null>;
}

export interface IssueQuery {
  mode: "list" | "board";
  filter: {
    text?: string;
    statusIds?: string[];
    priorities?: Priority[];
    projectIds?: string[];
    cycleIds?: string[];
    labelIds?: string[];
    due?: "none" | "overdue" | "today" | "upcoming";
    created?: { from?: number; to?: number };
  };
  group?: "status" | "priority" | "project" | "cycle" | "label";
  showEmptyGroups: boolean;
  order: "manual" | "priority" | "updated" | "created" | "due_at" | "estimate";
  layout: Record<string, boolean>;
  cursor?: string;
  limit: number;
}

export interface BootstrapPayload {
  me: User;
  preferences: Preferences;
  workflowStates: WorkflowState[];
  projectStatuses: ProjectStatus[];
  issues: Issue[];
  labels: Label[];
  projects: Project[];
  cycles: Cycle[];
  views: SavedView[];
  notifications: Notification[];
  background: { run: PublicRunSummary | null };
}

export type PublicRunSummary = Omit<
  BackgroundRun,
  | "user_id"
  | "idempotencyKey"
  | "requestHash"
  | "leaseExpiresAt"
  | "stepIndex"
  | "stepStatuses"
  | "stepCursors"
>;
