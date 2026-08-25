import type {
  CycleStatus,
  ColorTheme,
  Estimate,
  Locale,
  Priority,
  ProjectStatusCategory,
  Theme,
  WorkflowCategory,
} from "./contracts";

export interface UserViewModel {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: number;
}
export interface PreferencesViewModel {
  userId: string;
  timezone: string;
  locale: Locale;
  theme: Theme;
  colorTheme: ColorTheme;
  estimateEnabled: boolean;
  issueCounter: number;
}
export interface WorkflowStateViewModel {
  id: string;
  userId: string;
  name: string;
  category: WorkflowCategory;
  color: string;
  position: number;
  isDefault: boolean;
}
export interface ProjectStatusViewModel {
  id: string;
  userId: string;
  name: string;
  category: ProjectStatusCategory;
  color: string;
  position: number;
  isDefault: boolean;
}
export interface IssueViewModel {
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
export interface LabelViewModel {
  id: string;
  userId: string;
  name: string;
  color: string;
}

export interface IssueNoteViewModel {
  id: string;
  userId: string;
  issueId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  deletedAt: number | null;
}
export type IssueRelationTypeViewModel = "blocking" | "blocked_by" | "related" | "duplicate";
export interface IssueRelationViewModel {
  id: string;
  userId: string;
  sourceIssueId: string;
  targetIssueId: string;
  type: IssueRelationTypeViewModel;
  createdAt: number;
  target: Pick<IssueViewModel, "id" | "identifier" | "title" | "statusId">;
}
export interface ActivityViewModel {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: number;
}
export interface IssueDetailViewModel {
  issue: IssueViewModel;
  notes: IssueNoteViewModel[];
  relations: IssueRelationViewModel[];
  activity: ActivityViewModel[];
}
export interface ProjectViewModel {
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
export interface CycleViewModel {
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
export interface SavedViewViewModel {
  id: string;
  userId: string;
  name: string;
  query: { mode: "list" | "board"; order: string; [key: string]: unknown };
  layout: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}
export interface NotificationViewModel {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string | null;
  readAt: number | null;
  deletedAt: number | null;
  createdAt: number;
}
export interface RunProgressViewModel {
  current_step: "cycle_transition" | "purge" | "outbox_retry" | null;
  step_index: number;
  step_count: 3;
  cursor: string | null;
  processed: number;
  total: number | null;
  percent: number | null;
}
export interface PublicRunViewModel {
  run_id: string;
  kind: "maintenance";
  status: "pending" | "running" | "paused" | "failed" | "succeeded" | "rejected";
  progress: RunProgressViewModel;
  error: {
    code: string;
    message: string;
    failed_step: RunProgressViewModel["current_step"];
    retryable: boolean;
    request_id: string;
  } | null;
  requested_at: number;
  started_at: number | null;
  heartbeat_at: number | null;
  finished_at: number | null;
  resume_count: number;
}
export interface BootstrapViewModel {
  me: UserViewModel;
  preferences: PreferencesViewModel;
  workflowStates: WorkflowStateViewModel[];
  projectStatuses: ProjectStatusViewModel[];
  issues: IssueViewModel[];
  labels: LabelViewModel[];
  projects: ProjectViewModel[];
  cycles: CycleViewModel[];
  views: SavedViewViewModel[];
  notifications: NotificationViewModel[];
  background: { run: PublicRunViewModel | null };
}
