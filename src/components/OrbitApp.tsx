import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BootstrapViewModel as BootstrapPayload,
  CycleViewModel as Cycle,
  CycleSettingsViewModel as CycleSettings,
  IssueViewModel as Issue,
  ProjectViewModel as Project,
  PublicRunViewModel as PublicRunSummary,
  SavedViewViewModel as SavedView,
  WorkflowStateViewModel as WorkflowState,
  IssueDetailViewModel,
  IssueNoteViewModel,
  IssueRelationTypeViewModel,
  LabelViewModel as Label,
  RecentIssueViewModel,
  RecentSearchViewModel,
} from "../shared/view-models";
import type { ColorTheme, IssueListScope } from "../shared/contracts";
import { calculateCycleMetrics, cycleTabForStatus, type CycleTab } from "../shared/cycle-workspace";
import { NO_PROJECT_OPTION, projectIdFromSelection } from "./issue-project";
import {
  beforeIssueIdForDrop,
  beforeIssueIdForMove,
  filterCompletedIssues,
  issueSortOptions,
  type IssueSort,
  sortIssues,
} from "./issue-list";
import { SHOW_COMPLETED_STORAGE_KEY, parseShowCompletedPreference } from "./issue-preferences";
import { inverseIssuePatch } from "./issue-undo";
import { priorityFromSelection, priorityIconFor } from "./issue-priority";
import { hasIssueTitle, shouldSubmitIssueOnEnter } from "./issue-composer";
import { issueDetailPath, projectDetailPath } from "./navigation";
import { colorThemeOptions, resolveTheme } from "./theme";
import { timezoneOptionsFor } from "./preferences";
import { nextCommandIndex, shortcutActionFor, shortcutModifierLabel } from "./issue-core-ui";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, idempotencyKey } from "../lib/api-client";
import { queryClient } from "../lib/query";

type Section =
  | "home"
  | "issues"
  | "cycles"
  | "projects"
  | "search"
  | "inbox"
  | "views"
  | "settings";
type Props = { initialSection?: Section; issueId?: string; projectId?: string; cycleId?: string };
type ToastAction = { label: string; onClick: () => void };
type PreferencePatch = Partial<
  Pick<BootstrapPayload["preferences"], "timezone" | "locale" | "theme" | "colorTheme">
>;
type CycleSettingsPatch = Pick<BootstrapPayload["cycleSettings"], "durationWeeks" | "startWeekday">;
type IssueMutationVariables = { issue: Issue; patch: Partial<Issue>; undo?: boolean };
type IssueMutationRetry = IssueMutationVariables;
type IssueReorderVariables = {
  issue: Issue;
  beforeIssueId: string | null;
  idempotencyKey: string;
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>;
};
type SearchFilters = {
  statusId: string;
  priority: Issue["priority"] | "all";
  projectId: string;
  cycleId: string;
  labelId: string;
  due: "all" | "none" | "overdue" | "today" | "upcoming";
};

const priorityLabel: Record<Issue["priority"], string> = {
  no_priority: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
const priorityTone: Record<Issue["priority"], string> = {
  no_priority: "neutral",
  low: "low",
  medium: "medium",
  high: "high",
  urgent: "urgent",
};
const sectionLabels: Record<Section, string> = {
  home: "Home",
  issues: "Issues",
  cycles: "Cycles",
  projects: "Projects",
  search: "Search",
  inbox: "Inbox",
  views: "Views",
  settings: "Settings",
};
const sectionIcons: Record<Section, string> = {
  home: "⌂",
  issues: "☷",
  cycles: "◷",
  projects: "▦",
  search: "⌕",
  inbox: "♧",
  views: "▤",
  settings: "⚙",
};
const cycleWeekdayOptions = [
  [0, "日曜日"],
  [1, "月曜日"],
  [2, "火曜日"],
  [3, "水曜日"],
  [4, "木曜日"],
  [5, "金曜日"],
  [6, "土曜日"],
] as const;

function formatDate(value: number | null): string {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

function formatDateOnly(value: number | null): string {
  if (value === null) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function dateInputValue(value: number | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 10);
}

function formatRange(start: number, end: number): string {
  return `${formatDate(start)} — ${formatDate(end)}`;
}

function dateInputToUnix(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return Date.UTC(year, month - 1, day);
}

function shortId(value: string): string {
  return value.replace(/^[^_]+_/, "").slice(0, 6);
}

function getInitialSection(value?: Section): Section {
  if (value) return value;
  if (typeof window === "undefined") return "home";
  const path = window.location.pathname;
  if (path.startsWith("/issues")) return "issues";
  if (path.startsWith("/cycles")) return "cycles";
  if (path.startsWith("/projects")) return "projects";
  if (path.startsWith("/search")) return "search";
  if (path.startsWith("/inbox")) return "inbox";
  if (path.startsWith("/views")) return "views";
  if (path.startsWith("/settings")) return "settings";
  return "home";
}

export function OrbitApp(props: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <OrbitAppInner {...props} />
    </QueryClientProvider>
  );
}

function OrbitAppInner(props: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const initial = getInitialSection(props.initialSection);
  const [section, setSection] = useState<Section>(initial);
  const [composerOpen, setComposerOpen] = useState(Boolean(props.issueId));
  const [newTitle, setNewTitle] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newPriority, setNewPriority] = useState<Issue["priority"]>("no_priority");
  const [newDueAt, setNewDueAt] = useState<number | null>(null);
  const [newParentId, setNewParentId] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [priorityFilter, setPriorityFilter] = useState<Issue["priority"] | "all">("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [showCompleted, setShowCompleted] = useState(true);
  const [showCompletedReady, setShowCompletedReady] = useState(false);
  const [issueSort, setIssueSort] = useState<IssueSort>("updated_desc");
  const [issueScope, setIssueScope] = useState<IssueListScope>("active");
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
    action?: ToastAction;
  } | null>(null);
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [remoteSearch, setRemoteSearch] = useState<Issue[]>([]);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({
    statusId: "all",
    priority: "all",
    projectId: "all",
    cycleId: "all",
    labelId: "all",
    due: "all",
  });
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [run, setRun] = useState<PublicRunSummary | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [cycleCloseBusy, setCycleCloseBusy] = useState(false);
  const [cycleStartBusy, setCycleStartBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkMutationKeyRef = useRef<string | null>(null);
  const issueTriggerIdRef = useRef<string | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const issueFilterInputRef = useRef<HTMLInputElement>(null);
  const issueDisplayInputRef = useRef<HTMLSelectElement>(null);

  function rememberIssueFocus(issueId: string) {
    issueTriggerIdRef.current = issueId;
    void apiPost("/api/v1/recent-issue-views", {
      idempotencyKey: idempotencyKey(),
      issueId,
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["recent"] }))
      .catch(() => undefined);
    try {
      window.sessionStorage.setItem("orbit.issue-focus", issueId);
    } catch {
      // Focus restoration remains best-effort when browser storage is unavailable.
    }
  }

  function restoreIssueFocus() {
    window.setTimeout(() => {
      let issueId = issueTriggerIdRef.current;
      try {
        issueId ??= window.sessionStorage.getItem("orbit.issue-focus");
      } catch {
        // Ignore storage access failures and keep the in-memory fallback.
      }
      if (!issueId) return;
      const trigger = document.querySelector<HTMLButtonElement>(
        `button[data-issue-id="${issueId}"]`,
      );
      if (!trigger) return;
      trigger.focus();
      try {
        window.sessionStorage.removeItem("orbit.issue-focus");
      } catch {
        // Ignore storage access failures after the focus was restored.
      }
    }, 40);
  }

  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => apiGet<BootstrapPayload>("/api/v1/bootstrap"),
  });
  const scopedIssuesQuery = useQuery({
    queryKey: ["issues", issueScope],
    queryFn: () => apiGet<{ items: Issue[] }>(`/api/v1/issues?scope=${issueScope}`),
    enabled: section === "issues" && issueScope !== "active",
  });
  const recentQuery = useQuery({
    queryKey: ["recent"],
    queryFn: () =>
      apiGet<{ issueViews: RecentIssueViewModel[]; searches: RecentSearchViewModel[] }>(
        "/api/v1/recent",
      ),
    enabled: section === "search",
  });
  const trashQuery = useQuery({
    queryKey: ["issues", "trash"],
    queryFn: () => apiGet<{ items: Issue[] }>("/api/v1/issues?scope=trash"),
    enabled: section === "settings",
  });
  const data = bootstrap.data;
  const issues = data?.issues ?? [];
  const issueWorkspaceIssues =
    issueScope === "active" ? issues : (scopedIssuesQuery.data?.items ?? []);
  const projects = data?.projects ?? [];
  const cycles = data?.cycles ?? [];
  const labels = data?.labels ?? [];
  const notifications = data?.notifications ?? [];
  const workflowStates = data?.workflowStates ?? [];
  const activeCycle = cycles.find((cycle) => cycle.status === "active");
  const unread = notifications.filter((notification) => !notification.readAt).length;
  const modifierLabel = shortcutModifierLabel(
    typeof navigator === "undefined" ? undefined : navigator.platform,
  );
  const visibleIssues = useMemo(() => {
    const filtered = issueWorkspaceIssues.filter((issue) => {
      const matchesText =
        !filterText.trim() ||
        `${issue.identifier} ${issue.title} ${issue.description}`
          .toLocaleLowerCase()
          .includes(filterText.toLocaleLowerCase());
      const matchesPriority = priorityFilter === "all" || issue.priority === priorityFilter;
      const matchesLabel = labelFilter === "all" || issue.labelIds.includes(labelFilter);
      return matchesText && matchesPriority && matchesLabel;
    });
    return sortIssues(
      filterCompletedIssues(filtered, workflowStates, showCompleted),
      issueSort,
      workflowStates,
    );
  }, [
    issueWorkspaceIssues,
    filterText,
    priorityFilter,
    labelFilter,
    workflowStates,
    showCompleted,
    issueSort,
  ]);

  useEffect(() => {
    const visibleIds = new Set(visibleIssues.map((issue) => issue.id));
    setSelected((current) => {
      const next = current.filter((issueId) => visibleIds.has(issueId));
      return next.length === current.length ? current : next;
    });
  }, [visibleIssues]);

  useEffect(() => {
    if (labelFilter !== "all" && !labels.some((label) => label.id === labelFilter))
      setLabelFilter("all");
  }, [labels, labelFilter]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = parseShowCompletedPreference(
          window.localStorage.getItem(SHOW_COMPLETED_STORAGE_KEY),
        );
        if (stored !== undefined) setShowCompleted(stored);
      } catch {
        // Ignore storage access failures and keep the default visibility.
      }
    }
    setShowCompletedReady(true);
  }, []);

  useEffect(() => {
    if (!showCompletedReady || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SHOW_COMPLETED_STORAGE_KEY, String(showCompleted));
    } catch {
      // Ignore storage access failures after the preference is applied in memory.
    }
  }, [showCompleted, showCompletedReady]);

  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = resolveTheme(data.preferences.theme, media.matches);
      const colorTheme =
        colorThemeOptions.find((option) => option.value === data.preferences.colorTheme) ??
        colorThemeOptions[0];
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.colorTheme = colorTheme.value;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", resolved === "dark" ? "#11151d" : colorTheme.accent);
    };
    applyTheme();
    if (data.preferences.theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [data?.preferences.theme, data?.preferences.colorTheme]);

  useEffect(() => {
    if (!data || typeof document === "undefined") return;
    document.documentElement.lang = data.preferences.locale === "en" ? "en" : "ja";
  }, [data?.preferences.locale]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js?v=4", { updateViaCache: "none" })
        .catch(() => undefined);
  }, []);

  useEffect(() => {
    const current = data?.background.run ?? null;
    setRun(current);
  }, [data?.background.run]);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) return;
    const blocking = run?.status === "pending" || run?.status === "running";
    const content = [...shell.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.classList.contains("run-overlay"),
    );
    content.forEach((element) => {
      if (blocking) {
        element.setAttribute("inert", "");
        element.setAttribute("aria-hidden", "true");
      } else {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      }
    });
    return () => {
      content.forEach((element) => {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      });
    };
  }, [run?.status]);

  useEffect(() => {
    if (!composerOpen && !props.issueId) restoreIssueFocus();
  }, [composerOpen, props.issueId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      const action = shortcutActionFor({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        editable: editing,
      });
      if (!action || run?.status === "pending" || run?.status === "running") return;
      event.preventDefault();
      if (action === "command") {
        setCommandOpen(true);
        return;
      }
      if (action === "close") {
        setCommandOpen(false);
        setShortcutsOpen(false);
        if (!bulkBusy) setSelected([]);
        if (composerOpen && props.issueId) {
          setSection("issues");
          void router.navigate({ to: "/issues" as never }).then(restoreIssueFocus);
        }
        setComposerOpen(false);
        return;
      }
      if (action === "create") {
        setComposerOpen(true);
        return;
      }
      if (action === "help") {
        setShortcutsOpen(true);
        return;
      }
      if (action === "toggle-board") {
        setViewMode((mode) => (mode === "list" ? "board" : "list"));
        return;
      }
      if (action === "toggle-selection") {
        if (!focusedIssueId) return;
        setSelected((current) =>
          current.includes(focusedIssueId)
            ? current.filter((issueId) => issueId !== focusedIssueId)
            : [...current, focusedIssueId],
        );
        return;
      }
      if (action === "focus-display") {
        if (section === "issues") issueDisplayInputRef.current?.focus();
        return;
      }
      if (action === "focus-filter") {
        if (section === "issues")
          document.querySelector<HTMLElement>("#issues-priority-filter")?.focus();
        return;
      }
      if (action === "focus-search") {
        if (section === "issues") issueFilterInputRef.current?.focus();
        else if (section === "search")
          document.querySelector<HTMLInputElement>("#global-search-input")?.focus();
        else {
          setSection("search");
          void router.navigate({ to: "/search" as never }).then(() => {
            window.setTimeout(() => {
              document.querySelector<HTMLInputElement>("#global-search-input")?.focus();
            }, 0);
          });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bulkBusy, composerOpen, focusedIssueId, props.issueId, router, run?.status, section]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
  const dismissToast = () => {
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = undefined;
    }
    setToast(null);
  };
  const showToast = (kind: "success" | "error", text: string, action?: ToastAction) => {
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, text, action });
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = undefined;
      setToast(null);
    }, 3500);
  };

  async function installPwa() {
    if (!installPrompt) return;
    try {
      const result = await installPrompt.prompt();
      if (result.outcome === "accepted") showToast("success", "Orbitをインストールしました");
    } catch {
      showToast("error", "PWAのインストールを開始できませんでした");
    } finally {
      setInstallPrompt(null);
    }
  }

  const createIssue = useMutation({
    mutationFn: () =>
      apiPost<{ issue: Issue }>("/api/v1/issues", {
        idempotencyKey: idempotencyKey(),
        title: newTitle.trim(),
        priority: newPriority,
        dueAt: newDueAt,
        parentId: newParentId || null,
        projectId: projectIdFromSelection(newProjectId),
        cycleId: activeCycle?.id ?? null,
      }),
    onSuccess: ({ issue }) => {
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current ? { ...current, issues: [issue, ...current.issues] } : current,
      );
      setNewTitle("");
      setNewProjectId("");
      setNewPriority("no_priority");
      setNewDueAt(null);
      setNewParentId("");
      setComposerOpen(false);
      showToast("success", `${issue.identifier} を作成しました`);
    },
    onError: (error) =>
      showToast("error", error instanceof ApiError ? error.message : "Issueの作成に失敗しました。"),
  });

  const updateIssue = useMutation({
    mutationFn: ({ issue, patch }: IssueMutationVariables) =>
      apiPatch<{ issue: Issue }>(`/api/v1/issues/${issue.id}`, {
        idempotencyKey: idempotencyKey(),
        version: issue.version,
        patch,
      }),
    onMutate: async ({ issue, patch }) => {
      setPendingIssueId(issue.id);
      await queryClient.cancelQueries({ queryKey: ["bootstrap"] });
      const previous = queryClient.getQueryData<BootstrapPayload>(["bootstrap"]);
      const previousDetail = queryClient.getQueryData<IssueDetailViewModel>([
        "issue-detail",
        issue.id,
      ]);
      if (previous)
        queryClient.setQueryData<BootstrapPayload>(["bootstrap"], {
          ...previous,
          issues: previous.issues.map((item) =>
            item.id === issue.id ? { ...item, ...patch } : item,
          ),
        });
      if (previousDetail)
        queryClient.setQueryData<IssueDetailViewModel>(["issue-detail", issue.id], {
          ...previousDetail,
          issue: { ...previousDetail.issue, ...patch },
        });
      return { previous, previousDetail };
    },
    onSuccess: ({ issue: updatedIssue }, variables) => {
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current
          ? {
              ...current,
              issues: current.issues.map((item) =>
                item.id === updatedIssue.id ? updatedIssue : item,
              ),
            }
          : current,
      );
      queryClient.setQueryData<IssueDetailViewModel>(["issue-detail", updatedIssue.id], (current) =>
        current ? { ...current, issue: updatedIssue } : current,
      );
      for (const issueId of new Set([
        updatedIssue.id,
        variables.issue.parentId,
        updatedIssue.parentId,
      ])) {
        if (issueId) void queryClient.invalidateQueries({ queryKey: ["issue-detail", issueId] });
      }
      showToast(
        "success",
        variables.undo ? "元に戻しました" : "変更を保存しました",
        variables.undo
          ? undefined
          : {
              label: "元に戻す",
              onClick: () => {
                dismissToast();
                updateIssue.mutate({
                  issue: updatedIssue,
                  patch: inverseIssuePatch(variables.issue, variables.patch),
                  undo: true,
                });
              },
            },
      );
    },
    onError: async (error, variables, context) => {
      let retryIssue = variables.issue;
      if (error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT") {
        await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        const latestIssue = queryClient
          .getQueryData<BootstrapPayload>(["bootstrap"])
          ?.issues.find((item) => item.id === variables.issue.id);
        if (latestIssue) {
          retryIssue = latestIssue;
          queryClient.setQueryData<IssueDetailViewModel>(
            ["issue-detail", latestIssue.id],
            (current) => (current ? { ...current, issue: latestIssue } : current),
          );
        }
      } else if (context?.previous) {
        const previousIssue = context.previous.issues.find(
          (item) => item.id === variables.issue.id,
        );
        queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
          current && previousIssue
            ? {
                ...current,
                issues: current.issues.map((item) =>
                  item.id === previousIssue.id ? previousIssue : item,
                ),
              }
            : current,
        );
      }
      if (
        !(error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT") &&
        context?.previousDetail
      )
        queryClient.setQueryData(["issue-detail", variables.issue.id], context.previousDetail);
      const retry = {
        issue: retryIssue,
        patch: variables.patch,
        undo: variables.undo,
      } satisfies IssueMutationRetry;
      showToast(
        "error",
        error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT"
          ? "他の場所で更新されています。最新の内容を確認してください。"
          : error instanceof ApiError
            ? error.message
            : "保存に失敗しました。",
        {
          label: "再試行",
          onClick: () => {
            dismissToast();
            updateIssue.mutate(retry);
          },
        },
      );
    },
    onSettled: () => setPendingIssueId(null),
  });

  const reorderIssueMutation = useMutation({
    mutationFn: ({ issue, beforeIssueId, idempotencyKey: mutationKey }: IssueReorderVariables) =>
      apiPost<{ issue: Issue }>("/api/v1/issues/reorder", {
        idempotencyKey: mutationKey,
        issueId: issue.id,
        version: issue.version,
        beforeIssueId,
      }),
    onSuccess: async ({ issue }) => {
      await refresh();
      showToast("success", `${issue.identifier} の順序を保存しました`);
    },
    onError: async (error, variables) => {
      let retryVariables = variables;
      if (error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT") {
        await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        const latestIssue = queryClient
          .getQueryData<BootstrapPayload>(["bootstrap"])
          ?.issues.find((issue) => issue.id === variables.issue.id);
        if (latestIssue)
          retryVariables = {
            ...variables,
            issue: latestIssue,
            idempotencyKey: idempotencyKey(),
          };
      }
      showToast(
        "error",
        error instanceof ApiError ? error.message : "Issueの並び替えに失敗しました。",
        {
          label: "再試行",
          onClick: () => reorderIssueMutation.mutate(retryVariables),
        },
      );
    },
  });

  async function savePreferences(
    patch: PreferencePatch,
    mutationKey = idempotencyKey(),
  ): Promise<void> {
    const result = await apiPatch<{ preferences: BootstrapPayload["preferences"] }>(
      "/api/v1/preferences",
      { idempotencyKey: mutationKey, ...patch },
    );
    queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
      current ? { ...current, preferences: result.preferences } : current,
    );
  }

  async function saveCycleSettings(
    patch: CycleSettingsPatch,
    mutationKey = idempotencyKey(),
  ): Promise<void> {
    const result = await apiPatch<{ cycleSettings: BootstrapPayload["cycleSettings"] }>(
      "/api/v1/cycle-settings",
      { idempotencyKey: mutationKey, ...patch },
    );
    queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
      current ? { ...current, cycleSettings: result.cycleSettings } : current,
    );
    await refresh();
  }

  async function saveColorTheme(
    colorTheme: ColorTheme,
    mutationKey = idempotencyKey(),
  ): Promise<void> {
    try {
      const result = await apiPatch<{ preferences: BootstrapPayload["preferences"] }>(
        "/api/v1/preferences",
        { idempotencyKey: mutationKey, colorTheme },
      );
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current ? { ...current, preferences: result.preferences } : current,
      );
      showToast("success", "カラーテーマを変更しました");
    } catch (error) {
      showToast(
        "error",
        error instanceof ApiError ? error.message : "カラーテーマの変更に失敗しました。",
        { label: "再試行", onClick: () => void saveColorTheme(colorTheme, mutationKey) },
      );
      throw error;
    }
  }

  async function navigate(next: Section) {
    setSection(next);
    setSelected([]);
    const path = next === "home" ? "/" : next === "settings" ? "/settings" : `/${next}`;
    await router.navigate({ to: path as never });
  }

  async function markNotificationRead(notification: BootstrapPayload["notifications"][number]) {
    if (notification.readAt) return;
    await apiPatch(`/api/v1/notifications/${notification.id}`, {
      idempotencyKey: idempotencyKey(),
      read: true,
    });
  }

  async function openNotification(notification: BootstrapPayload["notifications"][number]) {
    await markNotificationRead(notification);
    await refresh();
    if (notification.entityType === "issue" && notification.entityId) {
      setSection("issues");
      setComposerOpen(true);
      await router.navigate({ to: `/issues/${notification.entityId}` as never });
    } else if (notification.entityType === "project" && notification.entityId) {
      setSection("projects");
      await router.navigate({ to: `/projects/${notification.entityId}` as never });
    } else if (notification.entityType === "cycle" && notification.entityId) {
      setSection("cycles");
      await router.navigate({ to: `/cycles/${notification.entityId}` as never });
    } else {
      await navigate("inbox");
    }
  }

  async function markAllNotifications() {
    const unreadNotifications = notifications.filter((notification) => !notification.readAt);
    const results = await Promise.allSettled(
      unreadNotifications.map((notification) => markNotificationRead(notification)),
    );
    await refresh();
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
  }

  async function continueMaintenance(initial: PublicRunSummary): Promise<PublicRunSummary> {
    let current = initial;
    setRun(current);
    for (let attempt = 0; attempt < 5 && current.status === "running"; attempt += 1) {
      const result = await apiPost<{ run: PublicRunSummary }>(
        `/api/v1/background-runs/${current.run_id}/continue`,
        {
          idempotencyKey: idempotencyKey(),
          expected_cursor: current.progress.cursor,
        },
      );
      current = result.run;
      setRun(current);
    }
    return current;
  }

  async function runMaintenance() {
    if (runBusy) return;
    setRunBusy(true);
    try {
      const started = await apiPost<{ run: PublicRunSummary }>("/api/v1/background-runs", {
        kind: "maintenance",
        idempotencyKey: idempotencyKey(),
      });
      const current = await continueMaintenance(started.run);
      showToast(
        "success",
        current.status === "succeeded" ? "メンテナンスを完了しました" : "処理を一時停止しました",
      );
      await refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof ApiError ? error.message : "バックグラウンド処理に失敗しました",
      );
    } finally {
      setRunBusy(false);
    }
  }

  async function resumeMaintenance() {
    if (!run || runBusy) return;
    setRunBusy(true);
    try {
      const result = await apiPost<{ run: PublicRunSummary }>(
        `/api/v1/background-runs/${run.run_id}/resume`,
        { idempotencyKey: idempotencyKey() },
      );
      const current = await continueMaintenance(result.run);
      showToast("success", "処理を再開しました");
      if (current.status === "succeeded") await refresh();
    } catch (error) {
      showToast("error", error instanceof ApiError ? error.message : "処理の再開に失敗しました");
    } finally {
      setRunBusy(false);
    }
  }

  function executeSearch(value: string, filtersForRequest = searchFilters) {
    setSearchText(value);
    setSearchError(null);
    if (searchTimer.current !== undefined) window.clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setRemoteSearch([]);
      setSearchBusy(false);
      return;
    }
    setSearchBusy(true);
    searchTimer.current = window.setTimeout(() => {
      const params = new URLSearchParams({ q: value.trim() });
      if (filtersForRequest.statusId !== "all") params.set("status", filtersForRequest.statusId);
      if (filtersForRequest.priority !== "all") params.set("priority", filtersForRequest.priority);
      if (filtersForRequest.projectId !== "all") params.set("project", filtersForRequest.projectId);
      if (filtersForRequest.cycleId !== "all") params.set("cycle", filtersForRequest.cycleId);
      if (filtersForRequest.labelId !== "all") params.set("label", filtersForRequest.labelId);
      if (filtersForRequest.due !== "all") params.set("due", filtersForRequest.due);
      void apiGet<{ items: Issue[] }>(`/api/v1/search?${params.toString()}`)
        .then((result) => {
          setRemoteSearch(result.items);
          setSearchBusy(false);
          void apiPost("/api/v1/recent-searches", {
            idempotencyKey: idempotencyKey(),
            query: {
              text: value.trim(),
              filter: {
                statusIds:
                  filtersForRequest.statusId === "all" ? undefined : [filtersForRequest.statusId],
                priorities:
                  filtersForRequest.priority === "all" ? undefined : [filtersForRequest.priority],
                projectIds:
                  filtersForRequest.projectId === "all" ? undefined : [filtersForRequest.projectId],
                cycleIds:
                  filtersForRequest.cycleId === "all" ? undefined : [filtersForRequest.cycleId],
                labelIds:
                  filtersForRequest.labelId === "all" ? undefined : [filtersForRequest.labelId],
                due: filtersForRequest.due === "all" ? undefined : filtersForRequest.due,
              },
            },
          })
            .then(() => queryClient.invalidateQueries({ queryKey: ["recent"] }))
            .catch(() => undefined);
        })
        .catch((error) => {
          setSearchBusy(false);
          setSearchError(error instanceof ApiError ? error.message : "検索に失敗しました");
        });
    }, 300);
  }

  function updateSearchFilters(next: SearchFilters) {
    setSearchFilters(next);
    if (searchText.trim()) executeSearch(searchText, next);
  }

  async function createProject() {
    if (!projectName.trim()) return;
    try {
      await apiPost("/api/v1/projects", {
        idempotencyKey: idempotencyKey(),
        name: projectName.trim(),
      });
      setProjectName("");
      setProjectComposerOpen(false);
      showToast("success", "Projectを作成しました");
      await refresh();
    } catch (error) {
      showToast("error", error instanceof ApiError ? error.message : "Projectの作成に失敗しました");
    }
  }

  async function bulkUpdateIssues(patch: Record<string, unknown>) {
    setBulkBusy(true);
    const mutationKey =
      bulkMutationKeyRef.current ?? (bulkMutationKeyRef.current = idempotencyKey());
    try {
      await apiPost("/api/v1/issues/bulk", {
        idempotencyKey: mutationKey,
        issueIds: selected,
        patch,
      });
      await refresh();
      bulkMutationKeyRef.current = null;
      showToast("success", `${selected.length}件のIssueを一括更新しました`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "IDEMPOTENCY_KEY_REUSED") await refresh();
      if (!(error instanceof ApiError) || error.status !== 423) bulkMutationKeyRef.current = null;
      throw error;
    } finally {
      setBulkBusy(false);
    }
  }

  async function changeIssueLifecycle(issue: Issue, action: "archive" | "restore" | "trash") {
    await apiPost(`/api/v1/issues/${issue.id}?action=${action}`, {
      idempotencyKey: idempotencyKey(),
    });
    await refresh();
    await queryClient.invalidateQueries({ queryKey: ["issues"] });
    showToast(
      "success",
      action === "archive"
        ? `${issue.identifier}をアーカイブしました`
        : action === "restore"
          ? `${issue.identifier}を復元しました`
          : `${issue.identifier}をゴミ箱へ移動しました`,
    );
  }

  async function closeCycle(cycle: Cycle) {
    if (cycleCloseBusy) return;
    setCycleCloseBusy(true);
    try {
      await apiPost(`/api/v1/cycles/${cycle.id}`, { idempotencyKey: idempotencyKey() });
      showToast("success", "Cycleを完了しました");
      await refresh();
    } catch (error) {
      showToast("error", error instanceof ApiError ? error.message : "Cycleの更新に失敗しました");
    } finally {
      setCycleCloseBusy(false);
    }
  }

  async function startCycle(cycle: Cycle): Promise<boolean> {
    if (cycleStartBusy) return false;
    setCycleStartBusy(true);
    try {
      await apiPost(`/api/v1/cycles/${cycle.id}/start`, { idempotencyKey: idempotencyKey() });
      showToast("success", "Cycleを開始しました");
      await refresh();
      return true;
    } catch (error) {
      showToast("error", error instanceof ApiError ? error.message : "Cycleの開始に失敗しました");
      return false;
    } finally {
      setCycleStartBusy(false);
    }
  }

  if (bootstrap.isLoading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">O</div>
        <p>Orbitを準備しています…</p>
      </div>
    );
  if (bootstrap.error || !data)
    return (
      <div className="loading-screen error-screen">
        <div className="brand-mark">!</div>
        <h1>接続できません</h1>
        <p>ワークスペースの読み込みに失敗しました。</p>
        <button className="button primary" onClick={() => bootstrap.refetch()}>
          再試行
        </button>
      </div>
    );

  function closeIssueDetail() {
    setSection("issues");
    setComposerOpen(false);
    void router.navigate({ to: "/issues" }).then(restoreIssueFocus);
  }

  const activeRun =
    run && ["pending", "running", "paused", "failed"].includes(run.status) ? run : null;
  const selectedIssue =
    selected.length === 1 ? issues.find((issue) => issue.id === selected[0]) : undefined;
  return (
    <div className="app-shell">
      <Sidebar
        section={section}
        unread={unread}
        onNavigate={navigate}
        onCreate={() => setComposerOpen(true)}
      />
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark small">O</span>
            <span>Orbit</span>
          </div>
          <div className="breadcrumbs">
            <span className="eyebrow">WORKSPACE</span>
            <span className="crumb-slash">/</span>
            <strong>{sectionLabels[section]}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="search-trigger"
              onClick={() => {
                setCommandOpen(true);
                setSearchText("");
              }}
            >
              <span>⌕</span>
              <span className="search-placeholder">検索</span>
              <kbd>{modifierLabel} K</kbd>
            </button>
            <button className="icon-button" aria-label="通知" onClick={() => navigate("inbox")}>
              ♧{unread > 0 && <span className="notification-dot" />}
            </button>
            <button className="avatar">OU</button>
          </div>
        </header>
        <main className="content-area">
          {section === "home" && (
            <HomeView
              data={data}
              onNavigate={navigate}
              onOpenIssue={(issue) => {
                rememberIssueFocus(issue.id);
                setSection("issues");
                setComposerOpen(true);
                if (typeof window !== "undefined")
                  void router.navigate({ to: `/issues/${issue.id}` as never });
              }}
            />
          )}
          {section === "issues" && (
            <IssuesView
              issues={visibleIssues}
              scope={issueScope}
              scopeLoading={scopedIssuesQuery.isLoading}
              setScope={setIssueScope}
              workflowStates={workflowStates}
              filterText={filterText}
              setFilterText={setFilterText}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              labelFilter={labelFilter}
              setLabelFilter={setLabelFilter}
              showCompleted={showCompleted}
              setShowCompleted={setShowCompleted}
              issueSort={issueSort}
              setIssueSort={setIssueSort}
              projects={projects}
              allIssues={issueWorkspaceIssues}
              cycles={cycles}
              labels={labels}
              viewMode={viewMode}
              setViewMode={setViewMode}
              selected={selected}
              setSelected={setSelected}
              pendingIssueId={pendingIssueId}
              reorderBusy={reorderIssueMutation.isPending}
              onUpdate={(issue, patch) => updateIssue.mutate({ issue, patch })}
              onRestore={(issue) => void changeIssueLifecycle(issue, "restore")}
              onFocusIssue={setFocusedIssueId}
              filterInputRef={issueFilterInputRef}
              displayInputRef={issueDisplayInputRef}
              modifierLabel={modifierLabel}
              onReorder={(issue, beforeIssueId) =>
                reorderIssueMutation.mutate({
                  issue,
                  beforeIssueId,
                  idempotencyKey: idempotencyKey(),
                })
              }
              onBulk={bulkUpdateIssues}
              bulkBusy={bulkBusy}
              resetBulkMutation={() => {
                bulkMutationKeyRef.current = null;
              }}
              onCreate={() => setComposerOpen(true)}
              onOpenIssue={(issue) => {
                rememberIssueFocus(issue.id);
                setComposerOpen(true);
                if (typeof window !== "undefined")
                  void router.navigate({ to: `/issues/${issue.id}` as never });
              }}
            />
          )}
          {section === "cycles" && (
            <CyclesView
              cycles={cycles}
              issues={issues}
              cycleId={props.cycleId}
              workflowStates={workflowStates}
              pendingIssueId={pendingIssueId}
              onUpdateIssue={(issue, patch) => updateIssue.mutate({ issue, patch })}
              onRefresh={refresh}
              onNavigateIssues={() => void navigate("issues")}
              onNavigateCycles={() => void navigate("cycles")}
              closeBusy={cycleCloseBusy}
              startBusy={cycleStartBusy}
              onClose={(cycle) => void closeCycle(cycle)}
              onStart={startCycle}
            />
          )}
          {section === "projects" && (
            <ProjectsView
              projects={projects}
              issues={issues}
              projectId={props.projectId}
              workflowStates={workflowStates}
              projectStatuses={data.projectStatuses}
              onCreate={() => setProjectComposerOpen(true)}
              onRefresh={refresh}
              onOpenIssue={(issue) => {
                rememberIssueFocus(issue.id);
                setSection("issues");
                setComposerOpen(true);
                void router.navigate({ to: issueDetailPath(issue.id) as never });
              }}
            />
          )}
          {section === "search" && (
            <SearchView
              query={searchText}
              onQuery={executeSearch}
              results={remoteSearch}
              onOpenIssueId={(issueId) => {
                const issue = issues.find((item) => item.id === issueId);
                if (issue) rememberIssueFocus(issue.id);
                setSection("issues");
                setComposerOpen(true);
                void router.navigate({ to: `/issues/${issueId}` as never });
              }}
              searchBusy={searchBusy}
              searchError={searchError}
              onRetry={() => executeSearch(searchText)}
              workflowStates={workflowStates}
              projects={projects}
              cycles={cycles}
              labels={labels}
              filters={searchFilters}
              setFilters={updateSearchFilters}
              recentIssueViews={recentQuery.data?.issueViews ?? []}
              recentSearches={recentQuery.data?.searches ?? []}
              modifierLabel={modifierLabel}
              onOpen={(issue) => {
                rememberIssueFocus(issue.id);
                setSection("issues");
                setComposerOpen(true);
                if (typeof window !== "undefined")
                  void router.navigate({ to: `/issues/${issue.id}` as never });
              }}
            />
          )}
          {section === "inbox" && (
            <InboxView
              notifications={notifications}
              onOpenNotification={openNotification}
              onMarkAllRead={markAllNotifications}
              onNavigateIssues={() => void navigate("issues")}
            />
          )}
          {section === "views" && (
            <ViewsView
              views={data.views}
              onRefresh={refresh}
              onNavigateIssues={() => void navigate("issues")}
            />
          )}
          {section === "settings" && (
            <SettingsView
              preferences={data.preferences}
              cycleSettings={data.cycleSettings}
              workflowStates={workflowStates}
              labels={labels}
              onRefresh={refresh}
              run={activeRun}
              runBusy={runBusy}
              onRun={runMaintenance}
              onResume={resumeMaintenance}
              onPreferences={savePreferences}
              onCycleSettings={saveCycleSettings}
              onColorTheme={saveColorTheme}
              canInstallPwa={installPrompt !== null}
              onInstallPwa={() => void installPwa()}
              trashIssues={trashQuery.data?.items ?? []}
              trashLoading={trashQuery.isLoading}
              onRestoreIssue={(issue) => changeIssueLifecycle(issue, "restore")}
            />
          )}
        </main>
      </div>
      <MobileNav
        section={section}
        unread={unread}
        onNavigate={navigate}
        onCreate={() => setComposerOpen(true)}
      />
      {activeRun && <RunOverlay run={activeRun} busy={runBusy} onResume={resumeMaintenance} />}
      {composerOpen &&
        (props.issueId ? (
          <IssueDetailPanel
            key={props.issueId}
            issueId={props.issueId}
            fallbackIssue={issues.find((item) => item.id === props.issueId)}
            knownIssues={issues}
            projects={projects}
            onUpdate={(issue, patch) => updateIssue.mutate({ issue, patch })}
            pending={pendingIssueId === props.issueId}
            workflowStates={workflowStates}
            onArchive={() => {
              const issue = issues.find((item) => item.id === props.issueId);
              return issue ? changeIssueLifecycle(issue, "archive") : Promise.resolve();
            }}
            onClose={closeIssueDetail}
          />
        ) : (
          <IssueComposer
            title={newTitle}
            setTitle={setNewTitle}
            projects={projects}
            projectId={newProjectId}
            setProjectId={setNewProjectId}
            priority={newPriority}
            setPriority={setNewPriority}
            dueAt={newDueAt}
            setDueAt={setNewDueAt}
            parentId={newParentId}
            setParentId={setNewParentId}
            issues={issues}
            onClose={() => {
              setComposerOpen(false);
              setNewTitle("");
              setNewProjectId("");
              setNewPriority("no_priority");
              setNewDueAt(null);
              setNewParentId("");
            }}
            onSubmit={() => createIssue.mutate()}
            busy={createIssue.isPending}
          />
        ))}
      {projectComposerOpen && (
        <Modal title="新しいProject" onClose={() => setProjectComposerOpen(false)}>
          <label className="field-label" htmlFor="project-name">
            名前
          </label>
          <input
            id="project-name"
            className="text-input"
            autoFocus
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createProject();
            }}
            placeholder="例：Orbit MVP"
          />
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setProjectComposerOpen(false)}>
              キャンセル
            </button>
            <button className="button primary" onClick={() => void createProject()}>
              作成する
            </button>
          </div>
        </Modal>
      )}
      {commandOpen && (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          onCreate={() => {
            setCommandOpen(false);
            setComposerOpen(true);
          }}
          onNavigate={(next) => {
            setCommandOpen(false);
            void navigate(next);
          }}
          onSearch={(value) => {
            setCommandOpen(false);
            void navigate("search");
            void executeSearch(value);
          }}
          selectedIssue={selectedIssue}
          onOpenSelected={() => {
            if (!selectedIssue) return;
            setCommandOpen(false);
            rememberIssueFocus(selectedIssue.id);
            setSection("issues");
            setComposerOpen(true);
            void router.navigate({ to: `/issues/${selectedIssue.id}` as never });
          }}
          onArchiveSelected={() => {
            if (!selectedIssue) return;
            setCommandOpen(false);
            void changeIssueLifecycle(selectedIssue, "archive").then(() => setSelected([]));
          }}
          onClearSelection={() => {
            setSelected([]);
            setCommandOpen(false);
          }}
          modifierLabel={modifierLabel}
        />
      )}
      {shortcutsOpen && (
        <Modal title="キーボードショートカット" onClose={() => setShortcutsOpen(false)}>
          <div className="shortcut-list">
            {[
              ["C", "Issueを作成"],
              [`${modifierLabel} K`, "コマンドメニュー"],
              [`${modifierLabel} F`, "現在View内検索"],
              ["F", "Filterへ移動"],
              ["Shift + V", "Display optionsへ移動"],
              [`${modifierLabel} B`, "List / Board切替"],
              ["X", "Issue選択"],
              ["?", "ショートカット一覧"],
              ["Esc", "閉じる / 選択解除"],
            ].map(([key, label]) => (
              <div className="shortcut-row" key={key}>
                <kbd>{key}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span>{toast.kind === "success" ? "✓" : "!"}</span>
          {toast.text}
          {toast.action && (
            <button className="text-button" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  section,
  unread,
  onNavigate,
  onCreate,
}: {
  section: Section;
  unread: number;
  onNavigate: (section: Section) => void;
  onCreate: () => void;
}) {
  const primary: Section[] = ["home", "issues", "cycles", "projects"];
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">O</span>
        <span className="brand-name">Orbit</span>
        <span className="brand-version">MVP</span>
      </div>
      <button className="workspace-switcher">
        <span className="workspace-avatar">O</span>
        <span className="workspace-name">Personal space</span>
        <span className="chevron">⌄</span>
      </button>
      <nav className="side-nav">
        <div className="nav-label">WORKSPACE</div>
        {primary.map((item) => (
          <NavItem
            key={item}
            item={item}
            active={section === item}
            onClick={() => onNavigate(item)}
          />
        ))}
        <div className="nav-label second">COLLECTIONS</div>
        {(["search", "inbox", "views"] as Section[]).map((item) => (
          <NavItem
            key={item}
            item={item}
            active={section === item}
            onClick={() => onNavigate(item)}
            badge={item === "inbox" ? unread : 0}
          />
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="create-sidebar" onClick={onCreate}>
          <span className="create-plus">＋</span>
          <span>新しいIssue</span>
          <kbd>C</kbd>
        </button>
        <button
          className={`nav-item ${section === "settings" ? "active" : ""}`}
          onClick={() => onNavigate("settings")}
        >
          <span className="nav-icon">⚙</span>
          <span>Settings</span>
        </button>
        <div className="user-card">
          <div className="avatar">OU</div>
          <div>
            <strong>Orbit User</strong>
            <span>Personal workspace</span>
          </div>
          <span className="more">•••</span>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({
  section,
  unread,
  onNavigate,
  onCreate,
}: {
  section: Section;
  unread: number;
  onNavigate: (section: Section) => void;
  onCreate: () => void;
}) {
  return (
    <nav className="mobile-nav">
      <NavItem item="home" active={section === "home"} onClick={() => onNavigate("home")} />
      <NavItem
        item="inbox"
        active={section === "inbox"}
        onClick={() => onNavigate("inbox")}
        badge={unread}
      />
      <NavItem
        item="projects"
        active={section === "projects"}
        onClick={() => onNavigate("projects")}
      />
      <button className="mobile-create" onClick={onCreate}>
        ＋
      </button>
      <NavItem item="cycles" active={section === "cycles"} onClick={() => onNavigate("cycles")} />
      <NavItem item="search" active={section === "search"} onClick={() => onNavigate("search")} />
      <NavItem
        item="settings"
        active={section === "settings"}
        onClick={() => onNavigate("settings")}
      />
    </nav>
  );
}

function NavItem({
  item,
  active,
  onClick,
  badge = 0,
}: {
  item: Section;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <span className="nav-icon">{sectionIcons[item]}</span>
      <span>{sectionLabels[item]}</span>
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

function HomeView({
  data,
  onNavigate,
  onOpenIssue,
}: {
  data: BootstrapPayload;
  onNavigate: (section: Section) => void;
  onOpenIssue: (issue: Issue, trigger?: HTMLButtonElement) => void;
}) {
  const cycle = data.cycles.find((item) => item.status === "active");
  const cycleIssues = cycle ? data.issues.filter((item) => item.cycleId === cycle.id) : [];
  const cycleMetrics = calculateCycleMetrics(cycleIssues, data.workflowStates);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUNDAY, AUGUST 23</span>
          <h1>
            おかえりなさい、<em>Orbit User</em>
          </h1>
          <p className="subheading">今日も、小さく進めていきましょう。</p>
        </div>
        <button className="button primary" onClick={() => onNavigate("issues")}>
          Issuesを見る <span>→</span>
        </button>
      </div>
      <div className="home-grid">
        <section className="hero-card cycle-card">
          <div className="card-top">
            <div>
              <span className="eyebrow coral">CURRENT CYCLE</span>
              <h2>{cycle?.nameOverride ?? cycle?.name ?? "Active Cycleなし"}</h2>
              <p>
                {cycle ? formatRange(cycle.startsAt, cycle.endsAt) : "次のCycleを設定しましょう"}
              </p>
            </div>
            <span className="cycle-orbit">◒</span>
          </div>
          {cycle && (
            <>
              <div className="progress-line">
                <span
                  style={{
                    width: `${cycleMetrics.progressPercent}%`,
                  }}
                />
              </div>
              <div className="cycle-stats">
                <div>
                  <strong>
                    {cycleMetrics.completed}
                    <small> / {cycleMetrics.total - cycleMetrics.canceled}</small>
                  </strong>
                  <span>完了したIssue</span>
                </div>
                <button className="text-button" onClick={() => onNavigate("cycles")}>
                  Cycle詳細 →
                </button>
              </div>
            </>
          )}
        </section>
        <section className="metric-card">
          <span className="metric-icon purple">✦</span>
          <span className="eyebrow">OPEN ISSUES</span>
          <strong>{data.issues.length}</strong>
          <span className="metric-foot">Across your workspace</span>
        </section>
        <section className="metric-card">
          <span className="metric-icon green">↗</span>
          <span className="eyebrow">PROJECTS</span>
          <strong>{data.projects.length}</strong>
          <span className="metric-foot">
            {data.projects.filter((item) => item.archivedAt).length ? "1 archived" : "All active"}
          </span>
        </section>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">RECENTLY UPDATED</span>
          <h2>最近のIssue</h2>
        </div>
        <button className="text-button" onClick={() => onNavigate("issues")}>
          すべて見る →
        </button>
      </div>
      <div className="recent-list">
        {data.issues.slice(0, 4).map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            state={data.workflowStates.find((item) => item.id === issue.statusId)}
            compact
            onClick={(trigger) => onOpenIssue(issue, trigger)}
          />
        ))}
      </div>
    </div>
  );
}

export function IssuesView({
  issues,
  scope,
  scopeLoading,
  setScope,
  workflowStates,
  filterText,
  setFilterText,
  priorityFilter,
  setPriorityFilter,
  labelFilter,
  setLabelFilter,
  showCompleted,
  setShowCompleted,
  issueSort,
  setIssueSort,
  projects,
  allIssues,
  cycles,
  labels,
  viewMode,
  setViewMode,
  selected,
  setSelected,
  pendingIssueId,
  reorderBusy,
  onUpdate,
  onRestore,
  onFocusIssue,
  filterInputRef,
  displayInputRef,
  modifierLabel,
  onReorder,
  onBulk,
  bulkBusy,
  resetBulkMutation,
  onCreate,
  onOpenIssue,
}: {
  issues: Issue[];
  scope: IssueListScope;
  scopeLoading: boolean;
  setScope: (value: IssueListScope) => void;
  workflowStates: WorkflowState[];
  filterText: string;
  setFilterText: (value: string) => void;
  priorityFilter: Issue["priority"] | "all";
  setPriorityFilter: (value: Issue["priority"] | "all") => void;
  labelFilter: string;
  setLabelFilter: (value: string) => void;
  showCompleted: boolean;
  setShowCompleted: (value: boolean) => void;
  issueSort: IssueSort;
  setIssueSort: (value: IssueSort) => void;
  projects: Project[];
  allIssues: Issue[];
  cycles: Cycle[];
  labels: Label[];
  viewMode: "list" | "board";
  setViewMode: (value: "list" | "board") => void;
  selected: string[];
  setSelected: (value: string[]) => void;
  pendingIssueId: string | null;
  reorderBusy: boolean;
  onUpdate: (issue: Issue, patch: Partial<Issue>) => void;
  onRestore: (issue: Issue) => void;
  onFocusIssue: (issueId: string) => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
  displayInputRef: RefObject<HTMLSelectElement | null>;
  modifierLabel: "⌘" | "Ctrl";
  onReorder: (issue: Issue, beforeIssueId: string | null) => void;
  onBulk: (patch: Record<string, unknown>) => Promise<void>;
  bulkBusy: boolean;
  resetBulkMutation: () => void;
  onCreate: () => void;
  onOpenIssue: (issue: Issue, trigger?: HTMLButtonElement) => void;
}) {
  const [bulkField, setBulkField] = useState<"status" | "priority" | "cycle" | "project" | "label">(
    "status",
  );
  const [bulkValue, setBulkValue] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [dropTargetIssueId, setDropTargetIssueId] = useState<string | null>(null);
  const manualOrder = issueSort === "manual";
  const orderedIssues = sortIssues(allIssues, "manual", workflowStates);
  const grouped = workflowStates
    .map((state) => ({ state, issues: issues.filter((issue) => issue.statusId === state.id) }))
    .filter((group) => group.issues.length > 0);
  const hasIssueFilter =
    Boolean(filterText.trim()) ||
    priorityFilter !== "all" ||
    labelFilter !== "all" ||
    !showCompleted;
  function clearIssueFilters() {
    setFilterText("");
    setPriorityFilter("all");
    setLabelFilter("all");
    setShowCompleted(true);
  }

  function dropIssue(dropTargetId: string) {
    const draggedId = draggedIssueId;
    setDraggedIssueId(null);
    setDropTargetIssueId(null);
    if (!manualOrder || !draggedId || draggedId === dropTargetId || reorderBusy) return;
    const draggedIssue = issues.find((issue) => issue.id === draggedId);
    if (!draggedIssue) return;
    onReorder(draggedIssue, beforeIssueIdForDrop(orderedIssues, draggedId, dropTargetId));
  }

  function moveIssue(issue: Issue, direction: "up" | "down") {
    if (!manualOrder || reorderBusy) return;
    const index = issues.findIndex((item) => item.id === issue.id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= issues.length) return;
    const beforeIssueId =
      allIssues.length === issues.length
        ? beforeIssueIdForMove(orderedIssues, issue.id, direction)
        : beforeIssueIdForDrop(orderedIssues, issue.id, issues[targetIndex].id);
    onReorder(issue, beforeIssueId);
  }

  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">WORKSPACE / ISSUES</span>
          <h1>Issues</h1>
          <p className="subheading">すべての作業を、ここから見渡します。</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          ＋ 新しいIssue <kbd>C</kbd>
        </button>
      </div>
      <div className="toolbar">
        <div className="inline-search">
          <span>⌕</span>
          <input
            ref={filterInputRef}
            id="issues-filter-input"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Issueを検索…"
          />
          <kbd>{modifierLabel} F</kbd>
        </div>
        <select
          className="filter-select"
          id="issues-priority-filter"
          aria-label="Priorityで絞り込む"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value as Issue["priority"] | "all")}
        >
          <option value="all">すべてのPriority</option>
          {Object.entries(priorityLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          id="issues-scope-filter"
          aria-label="Issueの表示範囲"
          value={scope}
          disabled={scopeLoading}
          onChange={(event) => setScope(event.target.value as IssueListScope)}
        >
          <option value="active">Active Issues</option>
          <option value="archived">Archived Issues</option>
        </select>
        <select
          className="filter-select"
          aria-label="Labelで絞り込む"
          value={labelFilter}
          onChange={(event) => setLabelFilter(event.target.value)}
        >
          <option value="all">すべてのLabel</option>
          {labels.map((label) => (
            <option value={label.id} key={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          ref={displayInputRef}
          id="issues-sort-select"
          aria-label="Issueのソート"
          value={issueSort}
          onChange={(event) => setIssueSort(event.target.value as IssueSort)}
        >
          {issueSortOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="completed-toggle">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.target.checked)}
          />
          完了Issueを表示
        </label>
        <div className="toolbar-spacer" />
        <div className="view-toggle-group">
          <button
            className={`view-toggle ${viewMode === "list" ? "selected" : ""}`}
            onClick={() => setViewMode("list")}
          >
            ☷ List
          </button>
          <button
            className={`view-toggle ${viewMode === "board" ? "selected" : ""}`}
            onClick={() => setViewMode("board")}
          >
            ▦ Board
          </button>
        </div>
      </div>
      {scopeLoading && <p className="detail-empty">表示範囲を読み込んでいます…</p>}
      {manualOrder && viewMode === "list" && (
        <p className="manual-order-hint">Issueをドラッグするか、↑↓ボタンで並び替えます。</p>
      )}
      {selected.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Issue一括操作">
          <strong>{selected.length}件選択中</strong>
          <select
            aria-label="一括更新属性"
            value={bulkField}
            onChange={(event) => {
              setBulkField(event.target.value as typeof bulkField);
              setBulkValue("");
              resetBulkMutation();
            }}
            disabled={bulkBusy}
          >
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="cycle">Cycle</option>
            <option value="project">Project</option>
            <option value="label">Label</option>
          </select>
          <select
            aria-label="一括更新値"
            value={bulkValue}
            onChange={(event) => {
              setBulkValue(event.target.value);
              resetBulkMutation();
            }}
            disabled={bulkBusy}
          >
            <option value="">選択…</option>
            {bulkField === "status" &&
              workflowStates.map((state) => (
                <option value={state.id} key={state.id}>
                  {state.name}
                </option>
              ))}
            {bulkField === "priority" &&
              Object.entries(priorityLabel).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            {bulkField === "cycle" && (
              <>
                <option value="__none__">Cycleなし</option>
                {cycles.map((cycle) => (
                  <option value={cycle.id} key={cycle.id}>
                    {cycle.nameOverride ?? cycle.name}
                  </option>
                ))}
              </>
            )}
            {bulkField === "project" && (
              <>
                <option value={NO_PROJECT_OPTION}>Projectなし</option>
                {projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name}
                  </option>
                ))}
              </>
            )}
            {bulkField === "label" && (
              <>
                <option value="__none__">Labelなし</option>
                {labels.map((label) => (
                  <option value={label.id} key={label.id}>
                    {label.name}
                  </option>
                ))}
              </>
            )}
          </select>
          <button
            className="button secondary"
            disabled={bulkBusy || !bulkValue}
            onClick={() => {
              const patch =
                bulkField === "status"
                  ? { statusId: bulkValue }
                  : bulkField === "priority"
                    ? { priority: bulkValue }
                    : bulkField === "cycle"
                      ? { cycleId: bulkValue === "__none__" ? null : bulkValue }
                      : bulkField === "project"
                        ? { projectId: projectIdFromSelection(bulkValue) }
                        : { labelIds: bulkValue === "__none__" ? [] : [bulkValue] };
              setBulkError(null);
              void onBulk(patch)
                .then(() => setSelected([]))
                .catch((error) =>
                  setBulkError(
                    error instanceof ApiError
                      ? error.fieldErrors
                        ? Object.values(error.fieldErrors).flat().join(" ")
                        : error.message
                      : "一括更新に失敗しました。",
                  ),
                );
            }}
          >
            {bulkBusy ? "適用中…" : "一括適用"}
          </button>
          <button
            onClick={() => {
              resetBulkMutation();
              setBulkError(null);
              setSelected([]);
            }}
            disabled={bulkBusy}
          >
            選択解除
          </button>
          {bulkError && (
            <span className="bulk-error" role="alert">
              {bulkError}
              <button
                onClick={() => {
                  setBulkError(null);
                  const patch =
                    bulkField === "status"
                      ? { statusId: bulkValue }
                      : bulkField === "priority"
                        ? { priority: bulkValue }
                        : bulkField === "cycle"
                          ? { cycleId: bulkValue === "__none__" ? null : bulkValue }
                          : bulkField === "project"
                            ? { projectId: projectIdFromSelection(bulkValue) }
                            : { labelIds: bulkValue === "__none__" ? [] : [bulkValue] };
                  void onBulk(patch)
                    .then(() => setSelected([]))
                    .catch((error) =>
                      setBulkError(
                        error instanceof ApiError ? error.message : "再試行に失敗しました。",
                      ),
                    );
                }}
                disabled={bulkBusy}
              >
                再試行
              </button>
            </span>
          )}
        </div>
      )}
      {viewMode === "board" ? (
        <div className="board-grid">
          {grouped.map(({ state, issues: groupIssues }) => (
            <div className="board-column" key={state.id}>
              <div className="column-heading">
                <span className="status-dot" style={{ background: state.color }} />
                <strong>{state.name}</strong>
                <span className="count-pill">{groupIssues.length}</span>
              </div>
              {groupIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  state={state}
                  labels={labels}
                  onClick={(trigger) => onOpenIssue(issue, trigger)}
                />
              ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <EmptyState
              title={hasIssueFilter ? "条件に一致するIssueはありません" : "Issueはまだありません"}
              action={hasIssueFilter ? "フィルターを解除" : "最初のIssueを作成"}
              onAction={hasIssueFilter ? clearIssueFilters : onCreate}
            />
          )}
        </div>
      ) : (
        <div className={`issue-table ${manualOrder ? "manual-order" : ""}`}>
          <div className="table-header">
            {manualOrder && <span className="reorder-cell">MOVE</span>}
            <span className="check-cell">
              <input
                type="checkbox"
                aria-label="全選択"
                checked={issues.length > 0 && selected.length === issues.length}
                disabled={bulkBusy}
                onChange={(event) => {
                  resetBulkMutation();
                  setBulkError(null);
                  setSelected(event.target.checked ? issues.map((issue) => issue.id) : []);
                }}
              />
            </span>
            <span>ISSUE</span>
            <span>STATUS</span>
            <span>PRIORITY</span>
            <span>PROJECT</span>
            <span>DUE</span>
          </div>
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              state={workflowStates.find((item) => item.id === issue.statusId)}
              workflowStates={workflowStates}
              selected={selected.includes(issue.id)}
              pending={pendingIssueId === issue.id || bulkBusy}
              onSelect={(checked) => {
                resetBulkMutation();
                setBulkError(null);
                setSelected(
                  checked ? [...selected, issue.id] : selected.filter((id) => id !== issue.id),
                );
              }}
              onClick={(trigger) => onOpenIssue(issue, trigger)}
              onUpdate={scope === "active" ? onUpdate : undefined}
              labels={labels}
              projects={projects}
              onRestore={scope === "archived" ? onRestore : undefined}
              onFocusIssue={onFocusIssue}
              manualOrder={manualOrder}
              dragging={draggedIssueId === issue.id}
              dropTarget={dropTargetIssueId === issue.id}
              onDragStart={() => setDraggedIssueId(issue.id)}
              onDragEnd={() => {
                setDraggedIssueId(null);
                setDropTargetIssueId(null);
              }}
              onDragOver={() => setDropTargetIssueId(issue.id)}
              onDrop={() => dropIssue(issue.id)}
              onMove={(direction) => moveIssue(issue, direction)}
              reorderBusy={reorderBusy}
            />
          ))}
          {issues.length === 0 && (
            <EmptyState
              title={hasIssueFilter ? "条件に一致するIssueはありません" : "Issueはまだありません"}
              action={hasIssueFilter ? "フィルターを解除" : "最初のIssueを作成"}
              onAction={() => {
                if (hasIssueFilter) {
                  clearIssueFilters();
                } else {
                  onCreate();
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PriorityIcon({ priority }: { priority: Issue["priority"] }) {
  const icon = priorityIconFor(priority);
  const barCount = icon.name === "low" ? 1 : icon.name === "medium" ? 2 : 3;
  return (
    <span
      className={`priority-icon ${icon.name}`}
      role="img"
      aria-label={icon.label}
      title={icon.label}
    >
      {icon.name === "none" ? (
        <span aria-hidden="true" className="priority-none-mark" />
      ) : icon.name === "urgent" ? (
        <span aria-hidden="true" className="priority-urgent-mark">
          ✦
        </span>
      ) : (
        <span aria-hidden="true" className="priority-bars">
          {Array.from({ length: barCount }, (_, index) => (
            <span key={index} />
          ))}
        </span>
      )}
    </span>
  );
}

function IssueRow({
  issue,
  state,
  workflowStates = [],
  compact = false,
  selected = false,
  pending = false,
  labels = [],
  onSelect,
  onClick,
  onUpdate,
  onRestore,
  onFocusIssue,
  projects = [],
  manualOrder = false,
  dragging = false,
  dropTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
  reorderBusy = false,
}: {
  issue: Issue;
  state?: WorkflowState;
  workflowStates?: WorkflowState[];
  compact?: boolean;
  selected?: boolean;
  pending?: boolean;
  labels?: Label[];
  onSelect?: (checked: boolean) => void;
  onClick?: (trigger: HTMLButtonElement) => void;
  onUpdate?: (issue: Issue, patch: Partial<Issue>) => void;
  onRestore?: (issue: Issue) => void;
  onFocusIssue?: (issueId: string) => void;
  projects?: Project[];
  manualOrder?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onMove?: (direction: "up" | "down") => void;
  reorderBusy?: boolean;
}) {
  return (
    <div
      className={`issue-row ${compact ? "compact" : ""} ${pending ? "pending" : ""} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""}`}
      draggable={manualOrder && !pending && !reorderBusy}
      onDragStart={
        manualOrder
          ? (event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", issue.id);
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={manualOrder ? onDragEnd : undefined}
      onDragOver={
        manualOrder
          ? (event) => {
              event.preventDefault();
              onDragOver?.();
            }
          : undefined
      }
      onDrop={
        manualOrder
          ? (event) => {
              event.preventDefault();
              onDrop?.();
            }
          : undefined
      }
    >
      {manualOrder && (
        <span className="reorder-cell">
          <span className="drag-handle" aria-hidden="true">
            ⠿
          </span>
          <button
            type="button"
            className="reorder-button"
            aria-label={`${issue.identifier}を上へ移動`}
            disabled={pending || reorderBusy}
            onClick={() => onMove?.("up")}
          >
            ↑
          </button>
          <button
            type="button"
            className="reorder-button"
            aria-label={`${issue.identifier}を下へ移動`}
            disabled={pending || reorderBusy}
            onClick={() => onMove?.("down")}
          >
            ↓
          </button>
        </span>
      )}
      <span className="check-cell">
        {onSelect && (
          <input
            type="checkbox"
            aria-label={`${issue.identifier}を選択`}
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
            disabled={pending}
          />
        )}
      </span>
      <button
        className="issue-main"
        data-issue-id={issue.id}
        aria-pressed={selected}
        onFocus={() => onFocusIssue?.(issue.id)}
        onClick={(event) => onClick?.(event.currentTarget)}
      >
        <span className="issue-id">{issue.identifier}</span>
        <strong>{issue.title}</strong>
        {issue.description && !compact && (
          <span className="issue-description">{issue.description}</span>
        )}
        {labels.length > 0 && (
          <span className="issue-labels" aria-label="Labels">
            {issue.labelIds
              .map((labelId) => labels.find((label) => label.id === labelId))
              .filter((label): label is Label => Boolean(label))
              .map((label) => (
                <span className="label-chip" key={label.id}>
                  <span className="label-chip-dot" style={{ background: label.color }} />
                  {label.name}
                </span>
              ))}
          </span>
        )}
      </button>
      <span className="status-cell">
        <span className="status-dot" style={{ background: state?.color }} />
        {onUpdate && !compact ? (
          <select
            aria-label={`${issue.identifier}のStatus`}
            value={issue.statusId}
            disabled={pending}
            onChange={(event) => onUpdate(issue, { statusId: event.target.value })}
          >
            {(workflowStates.length ? workflowStates : state ? [state] : []).map((status) => (
              <option value={status.id} key={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        ) : (
          <span>{state?.name ?? "—"}</span>
        )}
      </span>
      <span className="priority-cell">
        {onUpdate && !compact ? (
          <span className="priority-control">
            <PriorityIcon priority={issue.priority} />
            <select
              className="priority-icon-select"
              aria-label={`${issue.identifier}のPriority`}
              value={issue.priority}
              disabled={pending}
              onChange={(event) =>
                onUpdate(issue, { priority: priorityFromSelection(event.target.value) })
              }
            >
              {Object.entries(priorityLabel).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <PriorityIcon priority={issue.priority} />
        )}
      </span>
      <span className="project-cell">
        {projects.length > 0 && onUpdate ? (
          <select
            aria-label={`${issue.identifier}のProject`}
            value={issue.projectId ?? ""}
            disabled={pending}
            onChange={(event) =>
              onUpdate(issue, { projectId: projectIdFromSelection(event.target.value) })
            }
          >
            <option value="">Projectなし</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : issue.projectId ? (
          "◈ Project"
        ) : (
          "Projectなし"
        )}
      </span>
      <span className="due-cell">
        {onRestore && !compact ? (
          <button className="text-button" onClick={() => onRestore(issue)}>
            復元
          </button>
        ) : onUpdate && !compact ? (
          <input
            type="date"
            aria-label={`${issue.identifier}のDue date`}
            value={dateInputValue(issue.dueAt)}
            disabled={pending}
            onChange={(event) => onUpdate(issue, { dueAt: dateInputToUnix(event.target.value) })}
          />
        ) : (
          formatDate(issue.dueAt)
        )}
      </span>
    </div>
  );
}

function IssueCard({
  issue,
  state: _state,
  labels = [],
  onClick,
}: {
  issue: Issue;
  state: WorkflowState;
  labels?: Label[];
  onClick: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <button
      className="issue-card"
      data-issue-id={issue.id}
      onClick={(event) => onClick(event.currentTarget)}
    >
      <span className="issue-id">{issue.identifier}</span>
      <strong>{issue.title}</strong>
      <div>
        <span className={`priority-badge ${priorityTone[issue.priority]}`}>
          {priorityLabel[issue.priority]}
        </span>
        {issue.labelIds.map((labelId) => {
          const label = labels.find((item) => item.id === labelId);
          return label ? (
            <span className="label-chip" key={label.id}>
              <span className="label-chip-dot" style={{ background: label.color }} />
              {label.name}
            </span>
          ) : null;
        })}
      </div>
    </button>
  );
}

function CyclesView({
  cycles,
  cycleId,
  issues,
  workflowStates,
  pendingIssueId,
  onUpdateIssue,
  onRefresh,
  onNavigateIssues,
  onNavigateCycles,
  closeBusy,
  startBusy,
  onClose,
  onStart,
}: {
  cycles: Cycle[];
  cycleId?: string;
  issues: Issue[];
  workflowStates: WorkflowState[];
  pendingIssueId: string | null;
  onUpdateIssue: (issue: Issue, patch: Partial<Issue>) => void;
  onRefresh: () => void;
  onNavigateIssues: () => void;
  onNavigateCycles: () => void;
  closeBusy: boolean;
  startBusy: boolean;
  onClose: (cycle: Cycle) => void;
  onStart: (cycle: Cycle) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<CycleTab>("current");
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(cycleId ?? null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [assignmentTargetId, setAssignmentTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeCycle = cycleId ? (cycles.find((cycle) => cycle.id === cycleId) ?? null) : null;
  const tabCycles = cycles.filter((cycle) => cycleTabForStatus(cycle.status) === tab);
  const selectedCycle =
    tabCycles.find((cycle) => cycle.id === selectedCycleId) ?? tabCycles[0] ?? null;
  const nextCycle =
    selectedCycle?.status === "active"
      ? cycles.find(
          (cycle) => cycle.status === "upcoming" && cycle.number === selectedCycle.number + 1,
        )
      : null;
  const cycleIssues = selectedCycle
    ? issues.filter((issue) => issue.cycleId === selectedCycle.id && !issue.deletedAt)
    : [];
  const availableIssues = issues.filter((issue) => !issue.cycleId && !issue.deletedAt);
  const metrics = calculateCycleMetrics(cycleIssues, workflowStates);

  useEffect(() => {
    if (!cycleId) return;
    const routeCycle = cycles.find((cycle) => cycle.id === cycleId);
    if (!routeCycle) return;
    setTab(cycleTabForStatus(routeCycle.status));
    setSelectedCycleId(routeCycle.id);
  }, [cycleId, cycles]);

  useEffect(() => {
    if (!selectedCycle) {
      setSelectedCycleId(tabCycles[0]?.id ?? null);
      return;
    }
    setSelectedCycleId((current) => (current === selectedCycle.id ? current : selectedCycle.id));
    setNameDraft(selectedCycle.nameOverride ?? selectedCycle.name);
    setDescriptionDraft(selectedCycle.description);
    setAssignmentTargetId("");
    setEditing(false);
    setError(null);
  }, [
    selectedCycle?.id,
    selectedCycle?.name,
    selectedCycle?.nameOverride,
    selectedCycle?.description,
  ]);

  if (cycleId && !routeCycle) {
    return (
      <div className="page error-screen">
        <span className="eyebrow coral">CYCLE DETAIL</span>
        <h1>Cycleが見つかりません</h1>
        <button className="button secondary" onClick={onNavigateCycles}>
          Cyclesへ戻る
        </button>
      </div>
    );
  }

  function cancelMetadataEdit() {
    if (selectedCycle) {
      setNameDraft(selectedCycle.nameOverride ?? selectedCycle.name);
      setDescriptionDraft(selectedCycle.description);
    }
    setEditing(false);
    setError(null);
  }

  function handleMetadataKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelMetadataEdit();
    }
  }

  async function saveMetadata() {
    if (!selectedCycle || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/cycles/${selectedCycle.id}`, {
        idempotencyKey: idempotencyKey(),
        nameOverride: nameDraft === selectedCycle.name ? null : nameDraft,
        description: descriptionDraft,
      });
      setEditing(false);
      onRefresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "IDEMPOTENCY_KEY_REUSED") {
        await onRefresh();
        setError("別の内容で保存されました。最新のCycleを読み込みました。");
      } else if (caught instanceof ApiError && caught.fieldErrors) {
        setError(Object.values(caught.fieldErrors).flat().join(" "));
      } else {
        setError(caught instanceof ApiError ? caught.message : "Cycleの保存に失敗しました。");
      }
    } finally {
      setSaving(false);
    }
  }

  function assignIssue() {
    if (!selectedCycle || !assignmentTargetId || selectedCycle.status === "completed") return;
    const issue = issues.find((item) => item.id === assignmentTargetId);
    if (!issue) return;
    onUpdateIssue(issue, { cycleId: selectedCycle.id });
    setAssignmentTargetId("");
  }

  return (
    <div className="page">
      {(closeBusy || startBusy) && (
        <div
          className="cycle-blocking-overlay"
          role="status"
          tabIndex={0}
          autoFocus
          onKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="cycle-blocking-card">
            <span className="run-spinner">◌</span>
            <strong>{startBusy ? "Cycleを開始しています" : "Cycleを完了しています"}</strong>
            <span>処理が終わるまで操作できません。</span>
          </div>
        </div>
      )}
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">PLANNING / CYCLES</span>
          <h1>Cycles</h1>
          <p className="subheading">短い期間に、集中する仕事を選びます。</p>
        </div>
        <div className="cycle-page-actions">
          {nextCycle && (
            <button
              className="button primary"
              onClick={() =>
                void onStart(nextCycle).then((started) => {
                  if (started) setTab("current");
                })
              }
              disabled={closeBusy || startBusy}
            >
              {startBusy ? "開始中…" : "次のCycleを開始"}
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => {
              if (!selectedCycle) return;
              if (selectedCycle.status === "active") onClose(selectedCycle);
              if (selectedCycle.status === "upcoming")
                void onStart(selectedCycle).then((started) => {
                  if (started) setTab("current");
                });
            }}
            disabled={
              closeBusy || startBusy || !selectedCycle || selectedCycle.status === "completed"
            }
          >
            {closeBusy
              ? "完了処理中…"
              : startBusy
                ? "開始中…"
                : selectedCycle?.status === "upcoming"
                  ? "Cycleを開始"
                  : "Cycleを完了"}
          </button>
        </div>
      </div>
      <div className="cycle-tabs">
        {(["current", "upcoming", "past"] as const).map((value) => (
          <button
            className={tab === value ? "selected" : ""}
            aria-selected={tab === value}
            disabled={closeBusy || startBusy}
            key={value}
            onClick={() => setTab(value)}
          >
            {value === "current" ? "Current" : value === "upcoming" ? "Upcoming" : "Past"}
            <span className="cycle-tab-count">
              {cycles.filter((cycle) => cycleTabForStatus(cycle.status) === value).length}
            </span>
          </button>
        ))}
      </div>
      {selectedCycle ? (
        <section className="detail-card cycle-detail cycle-workspace">
          <div className="detail-card-head cycle-workspace-head">
            <div>
              <span className="eyebrow coral">
                {selectedCycle.status.toUpperCase()} CYCLE · #{selectedCycle.number}
              </span>
              {editing ? (
                <input
                  className="text-input cycle-name-input"
                  aria-label="Cycle名"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={handleMetadataKeyDown}
                />
              ) : (
                <h2>{selectedCycle.nameOverride ?? selectedCycle.name}</h2>
              )}
              <p>{formatRange(selectedCycle.startsAt, selectedCycle.endsAt)}</p>
            </div>
            <div className="cycle-head-actions">
              <span className="large-orbit">◒</span>
              <button
                className="button ghost"
                onClick={() => (editing ? cancelMetadataEdit() : setEditing(true))}
                disabled={saving || closeBusy}
              >
                {editing ? "取消" : "編集"}
              </button>
            </div>
          </div>
          {editing && (
            <div className="cycle-metadata-editor" onKeyDown={handleMetadataKeyDown}>
              <label className="field-label" htmlFor="cycle-description">
                Description
              </label>
              <textarea
                id="cycle-description"
                className="text-input cycle-description-input"
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                rows={3}
              />
              <button
                className="button primary"
                onClick={() => void saveMetadata()}
                disabled={saving}
              >
                {saving ? "保存中…" : "Cycleを保存"}
              </button>
            </div>
          )}
          {!editing && selectedCycle.description && (
            <p className="cycle-description">{selectedCycle.description}</p>
          )}
          <div className="cycle-metrics" aria-label="Cycle進捗">
            <div>
              <strong>{cycleIssues.length}</strong>
              <span>Issues</span>
            </div>
            <div>
              <strong>{metrics.completed}</strong>
              <span>Completed</span>
            </div>
            <div>
              <strong>{metrics.progressPercent}%</strong>
              <span>Progress</span>
            </div>
          </div>
          <div className="detail-progress">
            <div className="progress-line">
              <span style={{ width: `${metrics.progressPercent}%` }} />
            </div>
            <div className="progress-caption">
              <strong>
                {metrics.completed} / {metrics.total - metrics.canceled} completed
              </strong>
              <span>{metrics.canceled} canceled</span>
            </div>
          </div>
          {selectedCycle.status !== "completed" && (
            <div className="cycle-assignment">
              <label className="field-label" htmlFor="cycle-issue-target">
                Issueを追加
              </label>
              <select
                id="cycle-issue-target"
                aria-label="Cycleへ追加するIssue"
                value={assignmentTargetId}
                disabled={closeBusy}
                onChange={(event) => setAssignmentTargetId(event.target.value)}
              >
                <option value="">Issueを選択…</option>
                {availableIssues.map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {issue.identifier} · {issue.title}
                  </option>
                ))}
              </select>
              <button
                className="button secondary"
                onClick={assignIssue}
                disabled={closeBusy || !assignmentTargetId}
              >
                追加
              </button>
            </div>
          )}
          {error && (
            <div className="detail-live-error" role="alert">
              {error}
            </div>
          )}
          <div className="cycle-list">
            {cycleIssues.map((issue) => (
              <div className="mini-issue cycle-issue-row" key={issue.id}>
                <span className={`priority-dot ${priorityTone[issue.priority]}`} />
                <span className="issue-id">{issue.identifier}</span>
                <strong>{issue.title}</strong>
                <span className="cycle-issue-status">
                  {workflowStates.find((state) => state.id === issue.statusId)?.name ?? "—"}
                </span>
                {selectedCycle.status !== "completed" && (
                  <button
                    className="text-button danger"
                    onClick={() => onUpdateIssue(issue, { cycleId: null })}
                    disabled={closeBusy || pendingIssueId === issue.id}
                  >
                    解除
                  </button>
                )}
              </div>
            ))}
            {cycleIssues.length === 0 && (
              <p className="detail-empty">このCycleにIssueはありません。</p>
            )}
          </div>
        </section>
      ) : (
        <EmptyState
          title={tab === "current" ? "Active Cycleはありません" : "Cycleはありません"}
          action={tab === "current" ? "Upcomingを確認" : "Issuesを見る"}
          onAction={() => (tab === "current" ? setTab("upcoming") : onNavigateIssues())}
        />
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">TIMELINE</span>
          <h2>Cycle履歴</h2>
        </div>
      </div>
      <div className="timeline-list">
        {cycles.map((cycle) => (
          <button
            className={`timeline-row cycle-row-button ${selectedCycleId === cycle.id ? "selected" : ""}`}
            key={cycle.id}
            disabled={closeBusy}
            onClick={() => {
              setTab(cycleTabForStatus(cycle.status));
              setSelectedCycleId(cycle.id);
            }}
          >
            <span className={`timeline-dot ${cycle.status}`} />
            <div>
              <strong>{cycle.nameOverride ?? cycle.name}</strong>
              <span>{formatRange(cycle.startsAt, cycle.endsAt)}</span>
            </div>
            <span className={`status-pill ${cycle.status}`}>{cycle.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectsView({
  projects,
  issues,
  projectId,
  workflowStates,
  projectStatuses,
  onCreate,
  onRefresh,
  onOpenIssue,
}: {
  projects: Project[];
  issues: Issue[];
  projectId?: string;
  workflowStates: WorkflowState[];
  projectStatuses: BootstrapPayload["projectStatuses"];
  onCreate: () => void;
  onRefresh: () => void;
  onOpenIssue: (issue: Issue) => void;
}) {
  const router = useRouter();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutationKeyRef = useRef<string | null>(null);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId);
  }, [projectId]);

  const projectIssues = selectedProject
    ? issues.filter(
        (issue) =>
          issue.userId === selectedProject.userId &&
          issue.projectId === selectedProject.id &&
          !issue.deletedAt,
      )
    : [];
  const projectMetrics = calculateCycleMetrics(projectIssues, workflowStates);

  useEffect(() => {
    if (!selectedProject) return;
    setNameDraft(selectedProject.name);
    setDescriptionDraft(selectedProject.description);
    setStatusDraft(selectedProject.statusId);
    setTargetDraft(
      selectedProject.targetAt !== null
        ? new Date(selectedProject.targetAt).toISOString().slice(0, 10)
        : "",
    );
    setEditing(false);
    setError(null);
  }, [
    selectedProject?.id,
    selectedProject?.name,
    selectedProject?.description,
    selectedProject?.statusId,
    selectedProject?.targetAt,
  ]);

  if (projectId && !selectedProject) {
    return (
      <div className="page error-screen">
        <span className="eyebrow coral">PROJECT DETAIL</span>
        <h1>Projectが見つかりません</h1>
        <button
          className="button secondary"
          onClick={() => void router.navigate({ to: "/projects" })}
        >
          Projectsへ戻る
        </button>
      </div>
    );
  }

  function cancelEdit() {
    mutationKeyRef.current = null;
    if (selectedProject) {
      setNameDraft(selectedProject.name);
      setDescriptionDraft(selectedProject.description);
      setStatusDraft(selectedProject.statusId);
      setTargetDraft(
        selectedProject.targetAt !== null
          ? new Date(selectedProject.targetAt).toISOString().slice(0, 10)
          : "",
      );
    }
    setEditing(false);
    setError(null);
  }

  async function saveProject() {
    if (!selectedProject || saving) return;
    setSaving(true);
    setError(null);
    const mutationKey = mutationKeyRef.current ?? (mutationKeyRef.current = idempotencyKey());
    try {
      await apiPatch(`/api/v1/projects/${selectedProject.id}`, {
        idempotencyKey: mutationKey,
        patch: {
          name: nameDraft,
          description: descriptionDraft,
          statusId: statusDraft,
          targetAt: dateInputToUnix(targetDraft),
        },
      });
      mutationKeyRef.current = null;
      setEditing(false);
      await onRefresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "IDEMPOTENCY_KEY_REUSED") {
        mutationKeyRef.current = null;
        setEditing(false);
        await onRefresh();
        setError("別の内容で保存されています。最新のProjectを読み込みました。");
      } else {
        if (caught instanceof ApiError && caught.status !== 423) mutationKeyRef.current = null;
        setError(
          caught instanceof ApiError && caught.fieldErrors
            ? Object.values(caught.fieldErrors).flat().join(" ")
            : caught instanceof ApiError
              ? caught.message
              : "Projectの保存に失敗しました。",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">DELIVERY / PROJECTS</span>
          <h1>Projects</h1>
          <p className="subheading">成果物単位で、進捗とIssueを束ねます。</p>
        </div>
        <button className="button primary" onClick={onCreate} disabled={saving}>
          ＋ 新しいProject
        </button>
      </div>
      <div className="project-grid">
        {projects.map((project) => {
          const projectIssues = issues.filter(
            (issue) =>
              issue.userId === project.userId && issue.projectId === project.id && !issue.deletedAt,
          );
          return (
            <Link
              className={`project-card ${selectedProjectId === project.id ? "selected" : ""}`}
              data-project-id={project.id}
              key={project.id}
              to={projectDetailPath(project.id) as never}
              onClick={(event) => {
                if (saving) {
                  event.preventDefault();
                  return;
                }
                setSelectedProjectId(project.id);
              }}
            >
              <div className="project-card-top">
                <span className="project-icon" style={{ background: project.color }}>
                  {project.icon}
                </span>
                <span className="priority-badge high">{priorityLabel[project.priority]}</span>
              </div>
              <h2>{project.name}</h2>
              <p>{project.description || "説明はまだありません。"}</p>
              <div className="project-progress">
                <div className="progress-line">
                  <span
                    style={{
                      width: `${calculateCycleMetrics(projectIssues, workflowStates).progressPercent}%`,
                    }}
                  />
                </div>
                <span>
                  {projectIssues.length} Issues · {formatDateOnly(project.targetAt)}まで
                </span>
              </div>
            </Link>
          );
        })}
        {projects.length === 0 && (
          <EmptyState
            title="Projectはまだありません"
            action="最初のProjectを作成"
            onAction={onCreate}
          />
        )}
      </div>
      {selectedProject && (
        <section className="detail-card project-detail-workspace">
          <div className="detail-card-head">
            <div>
              <span className="eyebrow coral">PROJECT DETAIL</span>
              {editing ? (
                <input
                  className="text-input project-name-input"
                  aria-label="Project名"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => event.key === "Escape" && cancelEdit()}
                  disabled={saving}
                />
              ) : (
                <h2>{selectedProject.name}</h2>
              )}
              <p>{selectedProject.description || "説明はまだありません。"}</p>
              <div className="project-detail-properties">
                <span className="status-pill">
                  {projectStatuses.find((status) => status.id === selectedProject.statusId)?.name ??
                    "Status"}
                </span>
                <span>Target {formatDateOnly(selectedProject.targetAt)}</span>
              </div>
            </div>
            <button
              className="button ghost"
              onClick={() => (editing ? cancelEdit() : setEditing(true))}
              disabled={saving}
            >
              {editing ? "取消" : "編集"}
            </button>
          </div>
          {editing && (
            <div className="project-metadata-editor">
              <label className="field-label" htmlFor="project-description-detail">
                Description
              </label>
              <textarea
                id="project-description-detail"
                className="text-input project-description-input"
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && cancelEdit()}
                disabled={saving}
                rows={3}
              />
              <label className="field-label" htmlFor="project-status-detail">
                Status
              </label>
              <select
                id="project-status-detail"
                className="text-input"
                value={statusDraft}
                onChange={(event) => setStatusDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && cancelEdit()}
                disabled={saving}
              >
                {projectStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>
              <label className="field-label" htmlFor="project-target-detail">
                Target date
              </label>
              <input
                id="project-target-detail"
                className="text-input"
                type="date"
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && cancelEdit()}
                disabled={saving}
              />
              <button
                className="button primary"
                onClick={() => void saveProject()}
                disabled={saving}
              >
                {saving ? "保存中…" : "Projectを保存"}
              </button>
            </div>
          )}
          {error && (
            <div className="detail-live-error" role="alert">
              {error}
              {editing && (
                <button
                  className="text-button"
                  onClick={() => void saveProject()}
                  disabled={saving}
                >
                  再試行
                </button>
              )}
            </div>
          )}
          <div className="cycle-metrics project-metrics" aria-label="Project進捗">
            <div>
              <strong>{projectMetrics.total}</strong>
              <span>Issues</span>
            </div>
            <div>
              <strong>{projectMetrics.completed}</strong>
              <span>Completed</span>
            </div>
            <div>
              <strong>{projectMetrics.progressPercent}%</strong>
              <span>Progress</span>
            </div>
          </div>
          <div className="cycle-list project-issue-list">
            {projectIssues.map((issue) => (
              <button
                className="mini-issue project-issue-link"
                key={issue.id}
                aria-label={`${issue.identifier} ${issue.title}を開く`}
                onClick={() => onOpenIssue(issue)}
              >
                <span className={`priority-dot ${priorityTone[issue.priority]}`} />
                <span className="issue-id">{issue.identifier}</span>
                <strong>{issue.title}</strong>
                <span className="cycle-issue-status">
                  {workflowStates.find((state) => state.id === issue.statusId)?.name}
                </span>
              </button>
            ))}
            {projectIssues.length === 0 && (
              <p className="detail-empty">このProjectにIssueはありません。</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export function SearchView({
  query,
  onQuery,
  results,
  onOpen,
  onOpenIssueId,
  searchBusy,
  searchError,
  onRetry,
  workflowStates,
  projects,
  cycles,
  labels,
  filters,
  setFilters,
  recentIssueViews,
  recentSearches,
  modifierLabel,
}: {
  query: string;
  onQuery: (value: string, filters?: SearchFilters) => void;
  results: Issue[];
  onOpen: (issue: Issue) => void;
  onOpenIssueId: (issueId: string) => void;
  searchBusy: boolean;
  searchError: string | null;
  onRetry: () => void;
  workflowStates: WorkflowState[];
  projects: Project[];
  cycles: Cycle[];
  labels: Label[];
  filters: SearchFilters;
  setFilters: (value: SearchFilters) => void;
  recentIssueViews: RecentIssueViewModel[];
  recentSearches: RecentSearchViewModel[];
  modifierLabel: "⌘" | "Ctrl";
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => setActiveIndex(0), [query, results.length]);

  function updateFilter<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters({ ...filters, [key]: value });
  }

  return (
    <div className="page search-page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">DISCOVER</span>
          <h1>Search</h1>
          <p className="subheading">Issue ID、タイトル、説明から探します。</p>
        </div>
      </div>
      <div className="search-hero">
        <span>⌕</span>
        <input
          id="global-search-input"
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="何を探していますか？"
          role="combobox"
          aria-controls="global-search-results"
          aria-expanded={Boolean(query)}
          aria-activedescendant={
            query && results[activeIndex] ? `search-result-${results[activeIndex].id}` : undefined
          }
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => nextCommandIndex(results.length, current, 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => nextCommandIndex(results.length, current, -1));
            } else if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault();
              onOpen(results[activeIndex]);
            }
          }}
        />
        <kbd>{modifierLabel} F</kbd>
      </div>
      <div className="search-filters" aria-label="検索Filter">
        <select
          aria-label="検索Status"
          value={filters.statusId}
          onChange={(event) => updateFilter("statusId", event.target.value)}
        >
          <option value="all">すべてのStatus</option>
          {workflowStates.map((state) => (
            <option value={state.id} key={state.id}>
              {state.name}
            </option>
          ))}
        </select>
        <select
          aria-label="検索Priority"
          value={filters.priority}
          onChange={(event) =>
            updateFilter("priority", event.target.value as SearchFilters["priority"])
          }
        >
          <option value="all">すべてのPriority</option>
          {Object.entries(priorityLabel).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="検索Project"
          value={filters.projectId}
          onChange={(event) => updateFilter("projectId", event.target.value)}
        >
          <option value="all">すべてのProject</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select
          aria-label="検索Cycle"
          value={filters.cycleId}
          onChange={(event) => updateFilter("cycleId", event.target.value)}
        >
          <option value="all">すべてのCycle</option>
          {cycles.map((cycle) => (
            <option value={cycle.id} key={cycle.id}>
              {cycle.nameOverride ?? cycle.name}
            </option>
          ))}
        </select>
        <select
          aria-label="検索Label"
          value={filters.labelId}
          onChange={(event) => updateFilter("labelId", event.target.value)}
        >
          <option value="all">すべてのLabel</option>
          {labels.map((label) => (
            <option value={label.id} key={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <select
          aria-label="検索Due"
          value={filters.due}
          onChange={(event) => updateFilter("due", event.target.value as SearchFilters["due"])}
        >
          <option value="all">すべての期限</option>
          <option value="none">期限なし</option>
          <option value="overdue">期限超過</option>
          <option value="today">今日</option>
          <option value="upcoming">近日</option>
        </select>
      </div>
      {searchError && (
        <div className="detail-live-error" role="alert">
          {searchError}
          <button className="text-button" onClick={onRetry} disabled={searchBusy}>
            再試行
          </button>
        </div>
      )}
      {!query ? (
        <div className="search-recent">
          <section>
            <div className="section-heading">
              <div>
                <span className="eyebrow">RECENT ISSUES</span>
                <h2>最近開いたIssue</h2>
              </div>
            </div>
            {recentIssueViews.map((view) => (
              <button
                className="search-result"
                key={view.issue.id}
                onClick={() => onOpenIssueId(view.issue.id)}
              >
                <span className="issue-id">{view.issue.identifier}</span>
                <strong>{view.issue.title}</strong>
                <span>最近開いたIssue</span>
                <span>→</span>
              </button>
            ))}
            {recentIssueViews.length === 0 && (
              <p className="detail-empty">最近開いたIssueはありません。</p>
            )}
          </section>
          <section>
            <div className="section-heading">
              <div>
                <span className="eyebrow">RECENT SEARCHES</span>
                <h2>最近の検索</h2>
              </div>
            </div>
            {recentSearches.map((search) => (
              <button
                className="search-result"
                key={search.id}
                onClick={() => {
                  const filter = search.query.filter;
                  const nextFilters = {
                    statusId: filter.statusIds?.[0] ?? "all",
                    priority: filter.priorities?.[0] ?? "all",
                    projectId: filter.projectIds?.[0] ?? "all",
                    cycleId: filter.cycleIds?.[0] ?? "all",
                    labelId: filter.labelIds?.[0] ?? "all",
                    due: filter.due ?? "all",
                  } satisfies SearchFilters;
                  setFilters(nextFilters);
                  onQuery(search.query.text, nextFilters);
                }}
              >
                <span className="issue-id">検索</span>
                <strong>{search.query.text}</strong>
                <span>{search.query.filter.text ?? ""}</span>
                <span>→</span>
              </button>
            ))}
            {recentSearches.length === 0 && (
              <p className="detail-empty">最近の検索はありません。</p>
            )}
          </section>
        </div>
      ) : (
        <div className="search-results">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RESULTS</span>
              <h2>{results.length}件のIssue</h2>
            </div>
          </div>
          {searchBusy && <p className="detail-empty">検索しています…</p>}
          <div id="global-search-results" role="listbox" aria-label="検索結果">
            {results.map((issue, index) => (
              <button
                className={`search-result ${index === activeIndex ? "active" : ""}`}
                id={`search-result-${issue.id}`}
                role="option"
                aria-selected={index === activeIndex}
                key={issue.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onOpen(issue)}
              >
                <span className="issue-id">{issue.identifier}</span>
                <strong>{issue.title}</strong>
                <span>{issue.description || "説明なし"}</span>
                <span>→</span>
              </button>
            ))}
          </div>
          {results.length === 0 && (
            <EmptyState
              title="見つかりませんでした"
              action="検索語を変える"
              onAction={() => undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}

function InboxView({
  notifications,
  onOpenNotification,
  onMarkAllRead,
  onNavigateIssues,
}: {
  notifications: BootstrapPayload["notifications"];
  onOpenNotification: (notification: BootstrapPayload["notifications"][number]) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onNavigateIssues: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNotification, setRetryNotification] = useState<
    BootstrapPayload["notifications"][number] | null
  >(null);
  const [errorAction, setErrorAction] = useState<"individual" | "all" | null>(null);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  async function open(notification: BootstrapPayload["notifications"][number]) {
    setBusyId(notification.id);
    setError(null);
    try {
      await onOpenNotification(notification);
      setRetryNotification(null);
      setErrorAction(null);
    } catch (caught) {
      setRetryNotification(notification);
      setErrorAction("individual");
      setError(
        caught instanceof ApiError && caught.fieldErrors
          ? Object.values(caught.fieldErrors).flat().join(" ")
          : caught instanceof ApiError
            ? caught.message
            : "通知の処理に失敗しました。",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function markAll() {
    setAllBusy(true);
    setError(null);
    try {
      await onMarkAllRead();
      setRetryNotification(null);
      setErrorAction(null);
    } catch (caught) {
      setErrorAction("all");
      setError(
        caught instanceof ApiError && caught.fieldErrors
          ? Object.values(caught.fieldErrors).flat().join(" ")
          : caught instanceof ApiError
            ? caught.message
            : "通知を既読にできませんでした。",
      );
    } finally {
      setAllBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">UPDATES</span>
          <h1>Inbox</h1>
          <p className="subheading">あなたのワークスペースの変化。</p>
        </div>
        <button
          className="button ghost"
          onClick={() => void markAll()}
          disabled={!unreadCount || allBusy || Boolean(busyId)}
        >
          {allBusy ? "更新中…" : "すべて既読"}
        </button>
      </div>
      {error && (
        <div className="detail-live-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() =>
              errorAction === "individual" && retryNotification
                ? void open(retryNotification)
                : void markAll()
            }
            disabled={allBusy || Boolean(busyId) || (!unreadCount && errorAction !== "individual")}
          >
            再試行
          </button>
        </div>
      )}
      <div className="inbox-list">
        {notifications.map((notification) => (
          <div
            className={`notification-row ${notification.readAt ? "read" : ""}`}
            key={notification.id}
          >
            <button
              className="notification-main"
              onClick={() => void open(notification)}
              disabled={Boolean(busyId) || allBusy}
            >
              <span className="notification-icon">
                {notification.type === "overdue" ? "!" : "✦"}
              </span>
              <span className="notification-copy">
                <strong>{notification.title}</strong>
                <span>{notification.body}</span>
                <small>{formatDate(notification.createdAt)}</small>
              </span>
            </button>
            <button
              className="more"
              aria-label={`${notification.title}を開く`}
              onClick={() => void open(notification)}
              disabled={Boolean(busyId) || allBusy}
            >
              •••
            </button>
          </div>
        ))}
        {notifications.length === 0 && (
          <EmptyState
            title="新しい通知はありません"
            action="Issueを見る"
            onAction={onNavigateIssues}
          />
        )}
      </div>
    </div>
  );
}

function ViewsView({
  views,
  onRefresh,
  onNavigateIssues,
}: {
  views: SavedView[];
  onRefresh: () => void;
  onNavigateIssues: () => void;
}) {
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [modeDraft, setModeDraft] = useState<"list" | "board">("list");
  const [orderDraft, setOrderDraft] = useState("manual");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutationKeyRef = useRef<string | null>(null);
  const deleteRetryRef = useRef<SavedView | null>(null);
  const [errorAction, setErrorAction] = useState<"save" | "delete" | null>(null);
  const selectedView = views.find((view) => view.id === selectedViewId) ?? null;

  function filterSummary(view: SavedView): string {
    const entries = Object.entries(view.query.filter as Record<string, unknown>).filter(
      ([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined),
    );
    return entries.length
      ? entries
          .map(([key, value]) => {
            const display = Array.isArray(value)
              ? `${value.length}件`
              : value && typeof value === "object"
                ? "設定済み"
                : String(value);
            return `${key}: ${display}`;
          })
          .join(" · ")
      : "Filter: all Issues";
  }

  function startCreate() {
    mutationKeyRef.current = null;
    setEditorOpen(true);
    setEditingView(null);
    setNameDraft("");
    setModeDraft("list");
    setOrderDraft("manual");
    setError(null);
    setErrorAction(null);
  }

  function startEdit(view: SavedView) {
    mutationKeyRef.current = null;
    setEditorOpen(true);
    setSelectedViewId(view.id);
    setEditingView(view);
    setNameDraft(view.name);
    setModeDraft(view.query.mode);
    setOrderDraft(view.query.order === "estimate" ? "updated" : view.query.order);
    setError(null);
    setErrorAction(null);
  }

  function cancelEdit() {
    mutationKeyRef.current = null;
    setEditorOpen(false);
    setEditingView(null);
    setNameDraft("");
    setError(null);
    setErrorAction(null);
  }

  async function saveView() {
    if (!nameDraft.trim() || saving) return;
    setSaving(true);
    setError(null);
    setErrorAction("save");
    const mutationKey = mutationKeyRef.current ?? (mutationKeyRef.current = idempotencyKey());
    const query = editingView
      ? { ...editingView.query, mode: modeDraft, order: orderDraft }
      : {
          mode: modeDraft,
          filter: {},
          showEmptyGroups: false,
          order: orderDraft,
          layout: { priority: true },
          limit: 100,
        };
    try {
      if (editingView) {
        await apiPatch(`/api/v1/views/${editingView.id}`, {
          idempotencyKey: mutationKey,
          name: nameDraft,
          query,
          layout: query.layout,
        });
      } else {
        await apiPost("/api/v1/views", {
          idempotencyKey: mutationKey,
          name: nameDraft,
          query,
          layout: query.layout,
        });
      }
      mutationKeyRef.current = null;
      setErrorAction(null);
      cancelEdit();
      await onRefresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "IDEMPOTENCY_KEY_REUSED") {
        mutationKeyRef.current = null;
        setEditorOpen(false);
        setEditingView(null);
        setNameDraft("");
        setErrorAction(null);
        await onRefresh();
        setError("別の内容で保存されています。最新のSaved Viewを読み込みました。");
      } else if (caught instanceof ApiError && caught.fieldErrors) {
        if (caught.status !== 423) mutationKeyRef.current = null;
        setError(Object.values(caught.fieldErrors).flat().join(" "));
      } else {
        if (caught instanceof ApiError && caught.status !== 423) mutationKeyRef.current = null;
        setError(caught instanceof ApiError ? caught.message : "Saved Viewの保存に失敗しました。");
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeView(view: SavedView) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setErrorAction("delete");
    deleteRetryRef.current = view;
    const mutationKey = mutationKeyRef.current ?? (mutationKeyRef.current = idempotencyKey());
    try {
      await apiDelete(`/api/v1/views/${view.id}`, mutationKey);
      mutationKeyRef.current = null;
      deleteRetryRef.current = null;
      setErrorAction(null);
      if (editingView?.id === view.id) cancelEdit();
      if (selectedViewId === view.id) setSelectedViewId(null);
      await onRefresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status !== 423) mutationKeyRef.current = null;
      setError(
        caught instanceof ApiError && caught.fieldErrors
          ? Object.values(caught.fieldErrors).flat().join(" ")
          : caught instanceof ApiError
            ? caught.message
            : "Saved Viewの削除に失敗しました。",
      );
    } finally {
      setSaving(false);
    }
  }

  function retryDelete() {
    if (deleteRetryRef.current) void removeView(deleteRetryRef.current);
  }

  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">SAVED VIEWS</span>
          <h1>Views</h1>
          <p className="subheading">よく使う見え方を保存しておきます。</p>
        </div>
        <button className="button secondary" onClick={startCreate} disabled={saving}>
          ＋ Viewを保存
        </button>
      </div>
      {editorOpen && (
        <section className="detail-card view-editor">
          <div className="modal-title">
            <h2>{editingView ? "Saved Viewを編集" : "Saved Viewを作成"}</h2>
            <button
              className="icon-button"
              aria-label="View編集を閉じる"
              onClick={cancelEdit}
              disabled={saving}
            >
              ×
            </button>
          </div>
          <label className="field-label" htmlFor="saved-view-name">
            Name
          </label>
          <input
            id="saved-view-name"
            className="text-input"
            aria-label="Saved View名"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && cancelEdit()}
            disabled={saving}
          />
          <div className="view-editor-grid">
            <label className="field-label" htmlFor="saved-view-mode">
              Mode
            </label>
            <label className="field-label" htmlFor="saved-view-order">
              Order
            </label>
            <select
              id="saved-view-mode"
              value={modeDraft}
              onChange={(event) => setModeDraft(event.target.value as "list" | "board")}
              disabled={saving}
            >
              <option value="list">List</option>
              <option value="board">Board</option>
            </select>
            <select
              id="saved-view-order"
              value={orderDraft}
              onChange={(event) => setOrderDraft(event.target.value)}
              disabled={saving}
            >
              {[
                ["manual", "Manual"],
                ["priority", "Priority"],
                ["updated", "Updated"],
                ["created", "Created"],
                ["due_at", "Due date"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <div className="detail-live-error" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() => (errorAction === "delete" ? retryDelete() : void saveView())}
                disabled={saving}
              >
                再試行
              </button>
            </div>
          )}
          <div className="modal-actions">
            <button className="button ghost" onClick={cancelEdit} disabled={saving}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => void saveView()}
              disabled={saving || !nameDraft.trim()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </section>
      )}
      {error && !editorOpen && (
        <div className="detail-live-error" role="alert">
          {error}
          {errorAction === "delete" && (
            <button className="text-button" onClick={retryDelete} disabled={saving}>
              再試行
            </button>
          )}
        </div>
      )}
      {selectedView && (
        <section className="detail-card view-inspector">
          <div className="detail-section-heading">
            <div>
              <span className="eyebrow">SELECTED VIEW</span>
              <h3>{selectedView.name}</h3>
            </div>
            <span className="status-pill">{selectedView.query.mode}</span>
          </div>
          <p>{filterSummary(selectedView)}</p>
          <span className="view-inspector-meta">
            Order: {selectedView.query.order === "estimate" ? "updated" : selectedView.query.order}{" "}
            · Limit: {String(selectedView.query.limit ?? "—")}
          </span>
        </section>
      )}
      <div className="view-list">
        {views.map((view) => (
          <div className="saved-view-row" key={view.id}>
            <button
              className="saved-view-select"
              onClick={() => setSelectedViewId(view.id)}
              disabled={saving}
            >
              <span className="view-icon">▤</span>
              <span>
                <strong>{view.name}</strong>
                <small>
                  {view.query.mode} · {view.query.order}
                </small>
              </span>
            </button>
            <button className="text-button" onClick={() => startEdit(view)} disabled={saving}>
              編集
            </button>
            <button
              className="text-button danger"
              onClick={() => void removeView(view)}
              disabled={saving}
            >
              削除
            </button>
          </div>
        ))}
        {views.length === 0 && (
          <EmptyState
            title="Saved Viewはまだありません"
            action="Issuesで条件を作る"
            onAction={onNavigateIssues}
          />
        )}
      </div>
    </div>
  );
}

export function SettingsView({
  preferences,
  cycleSettings,
  workflowStates,
  labels,
  onRefresh,
  run,
  runBusy,
  onRun,
  onResume,
  onPreferences,
  onCycleSettings,
  onColorTheme,
  canInstallPwa,
  onInstallPwa,
  trashIssues,
  trashLoading,
  onRestoreIssue,
}: {
  preferences: BootstrapPayload["preferences"];
  cycleSettings: CycleSettings;
  workflowStates: WorkflowState[];
  labels: BootstrapPayload["labels"];
  onRefresh: () => Promise<unknown> | void;
  run: PublicRunSummary | null;
  runBusy: boolean;
  onRun: () => void;
  onResume: () => void;
  onPreferences: (patch: PreferencePatch, mutationKey?: string) => Promise<void>;
  onCycleSettings: (patch: CycleSettingsPatch, mutationKey?: string) => Promise<void>;
  onColorTheme: (colorTheme: ColorTheme, mutationKey: string) => Promise<void>;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
  trashIssues?: Issue[];
  trashLoading?: boolean;
  onRestoreIssue?: (issue: Issue) => Promise<void>;
}) {
  const [themeDraft, setThemeDraft] = useState(preferences.theme);
  const [colorThemeDraft, setColorThemeDraft] = useState(preferences.colorTheme);
  const [timezoneDraft, setTimezoneDraft] = useState(preferences.timezone);
  const [localeDraft, setLocaleDraft] = useState(preferences.locale);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceFieldErrors, setPreferenceFieldErrors] = useState<Record<
    string,
    string[]
  > | null>(null);
  const [preferenceSaved, setPreferenceSaved] = useState<string | null>(null);
  const [preferenceRetry, setPreferenceRetry] = useState<(() => void) | null>(null);
  const preferenceMutationKeyRef = useRef<{ key: string; patch: PreferencePatch } | null>(null);
  const [cycleDurationDraft, setCycleDurationDraft] = useState(cycleSettings.durationWeeks);
  const [cycleStartWeekdayDraft, setCycleStartWeekdayDraft] = useState(cycleSettings.startWeekday);
  const [cycleSettingsSaving, setCycleSettingsSaving] = useState(false);
  const [cycleSettingsError, setCycleSettingsError] = useState<string | null>(null);
  const [cycleSettingsFieldErrors, setCycleSettingsFieldErrors] = useState<Record<
    string,
    string[]
  > | null>(null);
  const [cycleSettingsSaved, setCycleSettingsSaved] = useState<string | null>(null);
  const [cycleSettingsRetry, setCycleSettingsRetry] = useState<(() => void) | null>(null);
  const cycleSettingsMutationKeyRef = useRef<{
    key: string;
    patch: CycleSettingsPatch;
  } | null>(null);
  const [colorThemeSaving, setColorThemeSaving] = useState(false);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("#E05252");
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const labelMutationKeyRef = useRef<string | null>(null);
  const labelDeleteRetryRef = useRef<BootstrapPayload["labels"][number] | null>(null);
  const [labelErrorAction, setLabelErrorAction] = useState<"save" | "delete" | null>(null);
  const [trashSavingId, setTrashSavingId] = useState<string | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);

  useEffect(() => setThemeDraft(preferences.theme), [preferences.theme]);
  useEffect(() => setColorThemeDraft(preferences.colorTheme), [preferences.colorTheme]);
  useEffect(() => setTimezoneDraft(preferences.timezone), [preferences.timezone]);
  useEffect(() => setLocaleDraft(preferences.locale), [preferences.locale]);
  useEffect(
    () => setCycleDurationDraft(cycleSettings.durationWeeks),
    [cycleSettings.durationWeeks],
  );
  useEffect(
    () => setCycleStartWeekdayDraft(cycleSettings.startWeekday),
    [cycleSettings.startWeekday],
  );

  async function restoreTrashIssue(issue: Issue): Promise<void> {
    if (!onRestoreIssue || trashSavingId) return;
    setTrashSavingId(issue.id);
    setTrashError(null);
    try {
      await onRestoreIssue(issue);
    } catch (error) {
      setTrashError(error instanceof ApiError ? error.message : "Issueの復元に失敗しました。");
    } finally {
      setTrashSavingId(null);
    }
  }

  async function savePreference(patch: PreferencePatch, restore: () => void): Promise<void> {
    setPreferenceSaving(true);
    setPreferenceError(null);
    setPreferenceFieldErrors(null);
    setPreferenceSaved(null);
    const previous = preferenceMutationKeyRef.current;
    const mutationKey =
      previous && JSON.stringify(previous.patch) === JSON.stringify(patch)
        ? previous.key
        : idempotencyKey();
    try {
      await onPreferences(patch, mutationKey);
      preferenceMutationKeyRef.current = null;
      setPreferenceRetry(null);
      setPreferenceSaved("設定を保存しました。");
    } catch (error) {
      preferenceMutationKeyRef.current = { key: mutationKey, patch };
      restore();
      setPreferenceError(error instanceof ApiError ? error.message : "設定の保存に失敗しました。");
      setPreferenceFieldErrors(error instanceof ApiError ? (error.fieldErrors ?? null) : null);
      setPreferenceRetry(() => () => void savePreference(patch, restore));
    } finally {
      setPreferenceSaving(false);
    }
  }

  async function saveCycleSettingsForm(
    event?: ReactFormEvent<HTMLFormElement>,
    retryPatch?: CycleSettingsPatch,
  ): Promise<void> {
    event?.preventDefault();
    if (cycleSettingsSaving) return;
    const patch: CycleSettingsPatch = retryPatch ?? {
      durationWeeks: cycleDurationDraft,
      startWeekday: cycleStartWeekdayDraft,
    };
    setCycleSettingsSaving(true);
    setCycleSettingsError(null);
    setCycleSettingsFieldErrors(null);
    setCycleSettingsSaved(null);
    const previous = cycleSettingsMutationKeyRef.current;
    const mutationKey =
      previous && JSON.stringify(previous.patch) === JSON.stringify(patch)
        ? previous.key
        : idempotencyKey();
    try {
      await onCycleSettings(patch, mutationKey);
      cycleSettingsMutationKeyRef.current = null;
      setCycleSettingsRetry(null);
      setCycleSettingsSaved("Cycle設定を保存しました。");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        cycleSettingsMutationKeyRef.current = null;
        try {
          await onRefresh();
        } catch {
          // Keep the conflict message visible when the refresh itself fails.
        }
      } else if (error instanceof ApiError && error.status === 423) {
        cycleSettingsMutationKeyRef.current = { key: mutationKey, patch };
      } else {
        cycleSettingsMutationKeyRef.current = null;
      }
      setCycleSettingsError(
        error instanceof ApiError ? error.message : "Cycle設定の保存に失敗しました。",
      );
      setCycleSettingsFieldErrors(error instanceof ApiError ? (error.fieldErrors ?? null) : null);
      setCycleSettingsRetry(() => () => void saveCycleSettingsForm(undefined, patch));
    } finally {
      setCycleSettingsSaving(false);
    }
  }

  function startLabelEdit(label: BootstrapPayload["labels"][number]) {
    labelMutationKeyRef.current = null;
    setEditingLabelId(label.id);
    setLabelName(label.name);
    setLabelColor(label.color);
    setLabelError(null);
    setLabelErrorAction(null);
  }

  function cancelLabelEdit() {
    labelMutationKeyRef.current = null;
    setEditingLabelId(null);
    setLabelName("");
    setLabelColor("#E05252");
    setLabelError(null);
    setLabelErrorAction(null);
  }

  async function saveLabel() {
    if (!labelName.trim() || labelSaving) return;
    setLabelSaving(true);
    setLabelError(null);
    setLabelErrorAction("save");
    const mutationKey =
      labelMutationKeyRef.current ?? (labelMutationKeyRef.current = idempotencyKey());
    try {
      if (editingLabelId) {
        await apiPatch(`/api/v1/labels/${editingLabelId}`, {
          idempotencyKey: mutationKey,
          name: labelName,
          color: labelColor,
        });
      } else {
        await apiPost("/api/v1/labels", {
          idempotencyKey: mutationKey,
          name: labelName,
          color: labelColor,
        });
      }
      cancelLabelEdit();
      setLabelErrorAction(null);
      await onRefresh();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 423) labelMutationKeyRef.current = null;
      setLabelError(
        error instanceof ApiError && error.fieldErrors
          ? Object.values(error.fieldErrors).flat().join(" ")
          : error instanceof ApiError
            ? error.message
            : "Labelの保存に失敗しました。",
      );
    } finally {
      setLabelSaving(false);
    }
  }

  async function removeLabel(label: BootstrapPayload["labels"][number]) {
    if (labelSaving) return;
    setLabelSaving(true);
    setLabelError(null);
    setLabelErrorAction("delete");
    labelDeleteRetryRef.current = label;
    const mutationKey =
      labelMutationKeyRef.current ?? (labelMutationKeyRef.current = idempotencyKey());
    try {
      await apiDelete(`/api/v1/labels/${label.id}`, mutationKey);
      labelMutationKeyRef.current = null;
      labelDeleteRetryRef.current = null;
      setLabelErrorAction(null);
      if (editingLabelId === label.id) cancelLabelEdit();
      await onRefresh();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 423) labelMutationKeyRef.current = null;
      setLabelError(error instanceof ApiError ? error.message : "Labelの削除に失敗しました。");
    } finally {
      setLabelSaving(false);
    }
  }

  function retryLabelDelete() {
    if (labelDeleteRetryRef.current) void removeLabel(labelDeleteRetryRef.current);
  }

  return (
    <div className="page settings-page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>Settings</h1>
          <p className="subheading">Orbitを自分の作業スタイルに合わせます。</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-icon">◉</span>
            <div>
              <h2>Appearance</h2>
              <p>テーマと表示の設定</p>
            </div>
            <span className="setting-value" role="status">
              {preferenceSaving ? "保存中…" : (preferenceSaved ?? "")}
            </span>
          </div>
          <div className="setting-row">
            <div>
              <strong>Theme</strong>
              <span>ライト・ダーク・システム</span>
              {preferenceFieldErrors?.theme && (
                <span id="preference-theme-error" className="setting-field-error" role="alert">
                  {preferenceFieldErrors.theme.join(" ")}
                </span>
              )}
            </div>
            <select
              aria-label="表示モード"
              aria-invalid={Boolean(preferenceFieldErrors?.theme)}
              aria-describedby={preferenceFieldErrors?.theme ? "preference-theme-error" : undefined}
              value={themeDraft}
              disabled={preferenceSaving}
              onChange={(event) => {
                const nextTheme = event.target.value as "light" | "dark" | "system";
                const previousTheme = themeDraft;
                setThemeDraft(nextTheme);
                void savePreference({ theme: nextTheme }, () => setThemeDraft(previousTheme));
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Color theme</strong>
              <span>アクセントカラー</span>
            </div>
            <span className="color-theme-control">
              <span
                className="color-theme-swatch"
                aria-hidden="true"
                style={{
                  background: colorThemeOptions.find((option) => option.value === colorThemeDraft)
                    ?.accent,
                }}
              />
              <select
                aria-label="カラーテーマ"
                value={colorThemeDraft}
                disabled={colorThemeSaving}
                onChange={(event) => {
                  const nextColorTheme = event.target.value as ColorTheme;
                  const previousColorTheme = colorThemeDraft;
                  setColorThemeDraft(nextColorTheme);
                  setColorThemeSaving(true);
                  void onColorTheme(nextColorTheme, idempotencyKey())
                    .catch(() => setColorThemeDraft(previousColorTheme))
                    .finally(() => setColorThemeSaving(false));
                }}
              >
                {colorThemeOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="setting-row">
            <div>
              <strong>Timezone</strong>
              <span>Cycle境界と日付表示</span>
              {preferenceFieldErrors?.timezone && (
                <span id="preference-timezone-error" className="setting-field-error" role="alert">
                  {preferenceFieldErrors.timezone.join(" ")}
                </span>
              )}
            </div>
            <select
              aria-label="タイムゾーン"
              aria-invalid={Boolean(preferenceFieldErrors?.timezone)}
              aria-describedby={
                preferenceFieldErrors?.timezone ? "preference-timezone-error" : undefined
              }
              value={timezoneDraft}
              disabled={preferenceSaving}
              onChange={(event) => {
                const nextTimezone = event.target.value;
                const previousTimezone = timezoneDraft;
                setTimezoneDraft(nextTimezone);
                void savePreference({ timezone: nextTimezone }, () =>
                  setTimezoneDraft(previousTimezone),
                );
              }}
            >
              {timezoneOptionsFor(timezoneDraft).map((timezone) => (
                <option value={timezone} key={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Language</strong>
              <span>表示言語</span>
              {preferenceFieldErrors?.locale && (
                <span id="preference-locale-error" className="setting-field-error" role="alert">
                  {preferenceFieldErrors.locale.join(" ")}
                </span>
              )}
            </div>
            <select
              aria-label="表示言語"
              aria-invalid={Boolean(preferenceFieldErrors?.locale)}
              aria-describedby={
                preferenceFieldErrors?.locale ? "preference-locale-error" : undefined
              }
              value={localeDraft}
              disabled={preferenceSaving}
              onChange={(event) => {
                const nextLocale = event.target.value as "ja" | "en";
                const previousLocale = localeDraft;
                setLocaleDraft(nextLocale);
                void savePreference({ locale: nextLocale }, () => setLocaleDraft(previousLocale));
              }}
            >
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>PWA</strong>
              <span>ホーム画面にOrbitを追加</span>
            </div>
            {canInstallPwa ? (
              <button className="button secondary" onClick={onInstallPwa}>
                Install Orbit
              </button>
            ) : (
              <span className="setting-value">ブラウザメニューから追加</span>
            )}
          </div>
        </section>
        <section className="settings-card cycle-settings-card">
          <div className="settings-card-title">
            <span className="settings-icon orange">◷</span>
            <div>
              <h2>Cycle</h2>
              <p>期間と開始曜日の設定</p>
            </div>
            <span className="setting-value" role="status">
              {cycleSettingsSaving ? "保存中…" : (cycleSettingsSaved ?? "")}
            </span>
          </div>
          <form
            className="cycle-settings-form"
            onSubmit={(event) => void saveCycleSettingsForm(event)}
          >
            <div className="setting-row">
              <div>
                <strong>Cycle期間</strong>
                <span>1〜8週間</span>
                {cycleSettingsFieldErrors?.durationWeeks && (
                  <span id="cycle-duration-error" className="setting-field-error" role="alert">
                    {cycleSettingsFieldErrors.durationWeeks.join(" ")}
                  </span>
                )}
              </div>
              <select
                aria-label="Cycle期間"
                aria-invalid={Boolean(cycleSettingsFieldErrors?.durationWeeks)}
                aria-describedby={
                  cycleSettingsFieldErrors?.durationWeeks ? "cycle-duration-error" : undefined
                }
                value={String(cycleDurationDraft)}
                disabled={cycleSettingsSaving}
                onChange={(event) => {
                  setCycleDurationDraft(Number(event.target.value));
                  setCycleSettingsSaved(null);
                }}
              >
                {Array.from({ length: 8 }, (_, index) => index + 1).map((weeks) => (
                  <option value={weeks} key={weeks}>
                    {weeks}週間
                  </option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <div>
                <strong>Cycle開始曜日</strong>
                <span>Timezoneの00:00を開始境界にします</span>
                {cycleSettingsFieldErrors?.startWeekday && (
                  <span id="cycle-weekday-error" className="setting-field-error" role="alert">
                    {cycleSettingsFieldErrors.startWeekday.join(" ")}
                  </span>
                )}
              </div>
              <select
                aria-label="Cycle開始曜日"
                aria-invalid={Boolean(cycleSettingsFieldErrors?.startWeekday)}
                aria-describedby={
                  cycleSettingsFieldErrors?.startWeekday ? "cycle-weekday-error" : undefined
                }
                value={String(cycleStartWeekdayDraft)}
                disabled={cycleSettingsSaving}
                onChange={(event) => {
                  setCycleStartWeekdayDraft(Number(event.target.value));
                  setCycleSettingsSaved(null);
                }}
              >
                {cycleWeekdayOptions.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="cycle-settings-actions">
              <span className="setting-value">{preferences.timezone}</span>
              <button className="button secondary" type="submit" disabled={cycleSettingsSaving}>
                {cycleSettingsSaving ? "保存中…" : "Cycle設定を保存"}
              </button>
            </div>
          </form>
          {cycleSettingsError && (
            <div className="detail-live-error" role="alert">
              {cycleSettingsError}
              {cycleSettingsRetry && (
                <button
                  className="text-button"
                  onClick={cycleSettingsRetry}
                  disabled={cycleSettingsSaving}
                >
                  再試行
                </button>
              )}
            </div>
          )}
        </section>
        {preferenceError && (
          <div className="detail-live-error" role="alert">
            {preferenceError}
            {preferenceRetry && (
              <button className="text-button" onClick={preferenceRetry} disabled={preferenceSaving}>
                再試行
              </button>
            )}
          </div>
        )}
        <WorkflowSettingsCard workflowStates={workflowStates} onRefresh={onRefresh} />
        {trashIssues !== undefined && (
          <section className="settings-card trash-settings-card">
            <div className="settings-card-title">
              <span className="settings-icon orange">⌫</span>
              <div>
                <h2>Trash</h2>
                <p>削除したIssueを30日以内に復元できます</p>
              </div>
            </div>
            {trashLoading ? (
              <p className="detail-empty">Trashを読み込んでいます…</p>
            ) : trashIssues.length === 0 ? (
              <p className="detail-empty">Trashは空です。</p>
            ) : (
              <div className="trash-list">
                {trashIssues.map((issue) => (
                  <div className="trash-row" key={issue.id}>
                    <div>
                      <strong>{issue.identifier}</strong>
                      <span>{issue.title}</span>
                    </div>
                    {onRestoreIssue && (
                      <button
                        className="text-button"
                        disabled={trashSavingId !== null}
                        onClick={() => void restoreTrashIssue(issue)}
                      >
                        {trashSavingId === issue.id ? "復元中…" : "復元"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {trashError && (
              <div className="detail-live-error" role="alert">
                {trashError}
              </div>
            )}
          </section>
        )}
        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-icon orange">↻</span>
            <div>
              <h2>Background processing</h2>
              <p>Cycle、Purge、Outboxをまとめて整理</p>
            </div>
          </div>
          <div className="run-status-box">
            <div className={`run-indicator ${run?.status ?? "idle"}`} />
            <div>
              <strong>
                {run
                  ? run.status === "pending"
                    ? "処理を開始中"
                    : run.status === "running"
                      ? "処理を実行中"
                      : run.status === "paused"
                        ? "一時停止中"
                        : run.status === "failed"
                          ? "復旧が必要"
                          : "完了"
                  : "待機中"}
              </strong>
              <span>
                {run
                  ? `${run.progress.current_step ?? "—"} · ${run.progress.percent ?? 0}%`
                  : "最後の実行はありません"}
              </span>
            </div>
            <div className="run-progress-ring">{run?.progress.percent ?? 0}%</div>
          </div>
          {run && ["paused", "failed"].includes(run.status) ? (
            <button className="button primary full" onClick={onResume}>
              Runを再開
            </button>
          ) : (
            <button className="button secondary full" onClick={onRun} disabled={runBusy}>
              {runBusy ? "実行中…" : "Maintenance Runを実行"}
            </button>
          )}
          <p className="setting-note">
            実行中はIssue、Cycle、Projectの変更が一時的にロックされます。読み取りと再認証は利用できます。
          </p>
        </section>
        <section className="settings-card labels-settings-card">
          <div className="settings-card-title">
            <span className="settings-icon purple">●</span>
            <div>
              <h2>Labels</h2>
              <p>Issueを分類する名前と色</p>
            </div>
          </div>
          <div className="label-editor-row">
            <input
              className="text-input"
              aria-label="Label名"
              value={labelName}
              onChange={(event) => setLabelName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelLabelEdit();
                if (event.key === "Enter") void saveLabel();
              }}
              placeholder="例：Bug"
              disabled={labelSaving}
            />
            <input
              className="text-input label-color-input"
              aria-label="Label色"
              value={labelColor}
              onChange={(event) => setLabelColor(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelLabelEdit();
                if (event.key === "Enter") void saveLabel();
              }}
              disabled={labelSaving}
            />
            <button
              className="button secondary"
              onClick={() => void saveLabel()}
              disabled={labelSaving || !labelName.trim()}
            >
              {labelSaving ? "保存中…" : editingLabelId ? "更新" : "追加"}
            </button>
            {editingLabelId && (
              <button className="text-button" onClick={cancelLabelEdit} disabled={labelSaving}>
                取消
              </button>
            )}
          </div>
          {labelError && (
            <div className="detail-live-error" role="alert">
              {labelError}
              <button
                className="text-button"
                onClick={() =>
                  labelErrorAction === "delete" ? retryLabelDelete() : void saveLabel()
                }
                disabled={labelSaving}
              >
                再試行
              </button>
            </div>
          )}
          <div className="label-settings-list">
            {labels.map((label) => (
              <div className="label-settings-row" key={label.id}>
                <span className="label-chip">
                  <span className="label-chip-dot" style={{ background: label.color }} />
                  {label.name}
                </span>
                <button
                  className="text-button"
                  onClick={() => startLabelEdit(label)}
                  disabled={labelSaving}
                >
                  編集
                </button>
                <button
                  className="text-button danger"
                  onClick={() => void removeLabel(label)}
                  disabled={labelSaving}
                >
                  削除
                </button>
              </div>
            ))}
            {labels.length === 0 && <p className="detail-empty">Labelはまだありません。</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

const workflowCategoryLabels: Record<WorkflowState["category"], string> = {
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

function WorkflowSettingsCard({
  workflowStates,
  onRefresh,
}: {
  workflowStates: WorkflowState[];
  onRefresh: () => Promise<unknown> | void;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#4F7CFF");
  const [newCategory, setNewCategory] = useState<WorkflowState["category"]>("unstarted");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const mutationKeyRef = useRef<{ key: string; signature: string } | null>(null);

  type WorkflowMutation = (mutationKey: string) => Promise<void>;

  function startEdit(state: WorkflowState) {
    setEditingId(state.id);
    setEditingName(state.name);
    setEditingColor(state.color);
    setError(null);
    setFieldErrors(null);
    setSaved(null);
    setRetry(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
    setEditingColor("");
    setError(null);
    setFieldErrors(null);
    setRetry(null);
  }

  async function executeMutation(
    operation: WorkflowMutation,
    successMessage: string,
    signature: string,
    onSuccess?: () => void,
  ): Promise<boolean> {
    setSaving(true);
    setError(null);
    setFieldErrors(null);
    setSaved(null);
    const previous = mutationKeyRef.current;
    const mutationKey =
      previous && previous.signature === signature ? previous.key : idempotencyKey();
    try {
      await operation(mutationKey);
      mutationKeyRef.current = null;
      setRetry(null);
      setFieldErrors(null);
      await onRefresh();
      onSuccess?.();
      setSaved(successMessage);
      return true;
    } catch (cause) {
      mutationKeyRef.current = { key: mutationKey, signature };
      const message =
        cause instanceof ApiError && cause.fieldErrors
          ? Object.values(cause.fieldErrors).flat().join(" ")
          : cause instanceof ApiError
            ? cause.message
            : "Workflowの保存に失敗しました。";
      setError(message);
      setFieldErrors(cause instanceof ApiError ? (cause.fieldErrors ?? null) : null);
      setRetry(() => () => void executeMutation(operation, successMessage, signature, onSuccess));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function fieldError(field: string): string | null {
    const messages = fieldErrors?.[field];
    return messages?.length ? messages.join(" ") : null;
  }

  async function createState() {
    if (!newName.trim() || saving) return;
    const name = newName;
    const color = newColor;
    const category = newCategory;
    await executeMutation(
      (mutationKey) =>
        apiPost("/api/v1/workflow-states", {
          idempotencyKey: mutationKey,
          name,
          category,
          color,
        }),
      "Workflowを追加しました。",
      JSON.stringify({ action: "create", name, color, category }),
      () => {
        setNewName("");
        setNewColor("#4F7CFF");
      },
    );
  }

  async function updateState(stateId: string) {
    if (!editingName.trim() || saving) return;
    const name = editingName;
    const color = editingColor;
    await executeMutation(
      (mutationKey) =>
        apiPatch(`/api/v1/workflow-states/${stateId}`, {
          idempotencyKey: mutationKey,
          name,
          color,
        }),
      "Workflowを更新しました。",
      JSON.stringify({ action: "update", stateId, name, color }),
      cancelEdit,
    );
  }

  function updatePosition(stateId: string, position: number) {
    if (saving) return;
    void executeMutation(
      (mutationKey) =>
        apiPatch(`/api/v1/workflow-states/${stateId}`, {
          idempotencyKey: mutationKey,
          position,
        }),
      "Workflowの順序を更新しました。",
      JSON.stringify({ action: "position", stateId, position }),
    );
  }

  function makeDefault(stateId: string) {
    if (saving) return;
    void executeMutation(
      (mutationKey) =>
        apiPatch(`/api/v1/workflow-states/${stateId}`, {
          idempotencyKey: mutationKey,
          isDefault: true,
        }),
      "既定Workflowを更新しました。",
      JSON.stringify({ action: "default", stateId }),
    );
  }

  function removeState(state: WorkflowState) {
    if (saving || state.isDefault) return;
    void executeMutation(
      (mutationKey) => apiDelete(`/api/v1/workflow-states/${state.id}`, mutationKey),
      "Workflowを削除しました。",
      JSON.stringify({ action: "delete", stateId: state.id }),
    );
  }

  return (
    <section
      className="settings-card label-settings-card"
      aria-labelledby="workflow-settings-title"
    >
      <div className="settings-card-title">
        <span className="settings-icon purple">≡</span>
        <div>
          <h2 id="workflow-settings-title">Workflow</h2>
          <p>Issueの状態・順序・既定値</p>
        </div>
      </div>
      <div className="label-editor-row workflow-editor-row">
        <input
          className="text-input"
          aria-label="Workflow名"
          aria-invalid={Boolean(fieldError("name"))}
          aria-describedby={fieldError("name") ? "workflow-create-name-error" : undefined}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void createState();
          }}
          placeholder="例：Review"
          disabled={saving}
        />
        <input
          className="text-input label-color-input"
          aria-label="Workflow色"
          aria-invalid={Boolean(fieldError("color"))}
          aria-describedby={fieldError("color") ? "workflow-create-color-error" : undefined}
          value={newColor}
          onChange={(event) => setNewColor(event.target.value)}
          disabled={saving}
        />
        <select
          aria-label="Workflowカテゴリ"
          aria-invalid={Boolean(fieldError("category"))}
          aria-describedby={fieldError("category") ? "workflow-create-category-error" : undefined}
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value as WorkflowState["category"])}
          disabled={saving}
        >
          {Object.entries(workflowCategoryLabels).map(([category, label]) => (
            <option value={category} key={category}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="button secondary"
          onClick={() => void createState()}
          disabled={saving || !newName.trim()}
        >
          {saving ? "保存中…" : "追加"}
        </button>
      </div>
      {fieldError("name") && (
        <span id="workflow-create-name-error" className="setting-field-error" role="alert">
          {fieldError("name")}
        </span>
      )}
      {fieldError("color") && (
        <span id="workflow-create-color-error" className="setting-field-error" role="alert">
          {fieldError("color")}
        </span>
      )}
      {fieldError("category") && (
        <span id="workflow-create-category-error" className="setting-field-error" role="alert">
          {fieldError("category")}
        </span>
      )}
      {error && (
        <div className="detail-live-error" role="alert">
          {error}
          {retry && (
            <button className="text-button" onClick={retry} disabled={saving}>
              再試行
            </button>
          )}
        </div>
      )}
      {saved && (
        <p className="setting-note" role="status">
          {saved}
        </p>
      )}
      <div className="label-settings-list workflow-settings-list">
        {workflowStates.map((state, index) =>
          editingId === state.id ? (
            <div className="label-settings-row workflow-settings-row" key={state.id}>
              <input
                className="text-input"
                aria-label={`${state.name}のWorkflow名`}
                aria-invalid={Boolean(fieldError("name"))}
                aria-describedby={fieldError("name") ? "workflow-edit-name-error" : undefined}
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                disabled={saving}
              />
              <input
                className="text-input label-color-input"
                aria-label={`${state.name}のWorkflow色`}
                aria-invalid={Boolean(fieldError("color"))}
                aria-describedby={fieldError("color") ? "workflow-edit-color-error" : undefined}
                value={editingColor}
                onChange={(event) => setEditingColor(event.target.value)}
                disabled={saving}
              />
              <button
                className="button secondary"
                onClick={() => void updateState(state.id)}
                disabled={saving || !editingName.trim()}
              >
                保存
              </button>
              <button className="text-button" onClick={cancelEdit} disabled={saving}>
                取消
              </button>
              {fieldError("name") && (
                <span id="workflow-edit-name-error" className="setting-field-error" role="alert">
                  {fieldError("name")}
                </span>
              )}
              {fieldError("color") && (
                <span id="workflow-edit-color-error" className="setting-field-error" role="alert">
                  {fieldError("color")}
                </span>
              )}
            </div>
          ) : (
            <div className="label-settings-row workflow-settings-row" key={state.id}>
              <span className="label-chip">
                <span className="label-chip-dot" style={{ background: state.color }} />
                {state.name}
              </span>
              <span className="setting-value">{workflowCategoryLabels[state.category]}</span>
              {state.isDefault && <span className="setting-value">既定</span>}
              <button
                className="text-button"
                onClick={() => updatePosition(state.id, index - 1)}
                disabled={saving || index === 0}
                aria-label={`${state.name}を上へ移動`}
              >
                ↑
              </button>
              <button
                className="text-button"
                onClick={() => updatePosition(state.id, index + 1)}
                disabled={saving || index === workflowStates.length - 1}
                aria-label={`${state.name}を下へ移動`}
              >
                ↓
              </button>
              <button className="text-button" onClick={() => startEdit(state)} disabled={saving}>
                編集
              </button>
              <button
                className="text-button"
                onClick={() => makeDefault(state.id)}
                disabled={saving || state.isDefault}
              >
                既定にする
              </button>
              <button
                className="text-button danger"
                onClick={() => removeState(state)}
                disabled={saving || state.isDefault}
              >
                削除
              </button>
            </div>
          ),
        )}
        {workflowStates.length === 0 && <p className="detail-empty">Workflowはまだありません。</p>}
      </div>
    </section>
  );
}

export function RunOverlay({
  run,
  busy,
  onResume,
}: {
  run: PublicRunSummary;
  busy: boolean;
  onResume: () => void;
}) {
  const blocking = ["pending", "running"].includes(run.status);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (blocking) overlayRef.current?.focus();
  }, [blocking]);

  return (
    <div
      ref={overlayRef}
      className={`run-overlay ${blocking ? "blocking" : ""}`}
      role={blocking ? "dialog" : "status"}
      aria-modal={blocking || undefined}
      aria-labelledby="run-overlay-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (!blocking || event.key !== "Tab") return;
        event.preventDefault();
        overlayRef.current?.focus();
      }}
    >
      <div className="run-overlay-card">
        <div className="run-spinner">
          {blocking ? "◌" : run.status === "failed" || run.status === "paused" ? "!" : "✓"}
        </div>
        <span className="eyebrow coral">BACKGROUND RUN</span>
        <h2 id="run-overlay-title">
          {run.status === "pending"
            ? "処理を開始しています"
            : run.status === "running"
              ? "ワークスペースを整えています"
              : run.status === "paused"
                ? "処理が一時停止しました"
                : run.status === "failed"
                  ? "処理の再開が必要です"
                  : "Maintenance complete"}
        </h2>
        <p>
          {run.progress.current_step
            ? `${run.progress.current_step} を処理中 · ${run.progress.percent ?? 0}%`
            : "処理が完了しました。"}
        </p>
        <div className="progress-line">
          <span style={{ width: `${run.progress.percent ?? 0}%` }} />
        </div>
        {run.status === "paused" || run.status === "failed" ? (
          <button className="button primary" onClick={onResume} disabled={busy}>
            同じRunを再開
          </button>
        ) : (
          !blocking && (
            <button className="button ghost" onClick={() => undefined}>
              閉じる
            </button>
          )
        )}
        <span className="run-safe-note">
          個人データはこのRunの所有者スコープ内だけを処理します。
        </span>
      </div>
    </div>
  );
}

const relationLabels: Record<IssueRelationTypeViewModel, string> = {
  blocking: "Blocks",
  blocked_by: "Blocked by",
  related: "Related",
  duplicate: "Duplicate",
};

function textDocument(value: string) {
  return {
    type: "doc" as const,
    content: value.split("\n").map((line) => ({
      type: "paragraph" as const,
      content: line ? [{ type: "text" as const, text: line }] : [],
    })),
  };
}

function IssueDetailPanel({
  issueId,
  fallbackIssue,
  knownIssues,
  projects,
  onUpdate,
  pending,
  workflowStates,
  onArchive,
  onClose,
}: {
  issueId: string;
  fallbackIssue?: Issue;
  knownIssues: Issue[];
  projects: Project[];
  onUpdate: (issue: Issue, patch: Partial<Issue>) => void;
  pending: boolean;
  workflowStates: WorkflowState[];
  onArchive: () => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["issue-detail", issueId],
    queryFn: () => apiGet<IssueDetailViewModel>(`/api/v1/issues/${issueId}`),
  });
  const detail = detailQuery.data;
  const notFound = detailQuery.error instanceof ApiError && detailQuery.error.status === 404;
  const issue = notFound ? undefined : (detail?.issue ?? fallbackIssue);
  const [description, setDescription] = useState(issue?.description ?? "");
  const [titleDraft, setTitleDraft] = useState(issue?.title ?? "");
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const [projectIdDraft, setProjectIdDraft] = useState(issue?.projectId ?? "");
  const [noteBody, setNoteBody] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationType, setRelationType] = useState<IssueRelationTypeViewModel>("related");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descriptionRetry, setDescriptionRetry] = useState<{
    description: string;
    title: string;
  } | null>(null);
  const [projectRetry, setProjectRetry] = useState<string | null>(null);

  useEffect(() => {
    if (issue) setDescription(issue.description);
    if (issue) setTitleDraft(issue.title);
    if (issue) setProjectIdDraft(issue.projectId ?? "");
  }, [issue?.id, issue?.description, issue?.title, issue?.projectId]);

  useEffect(() => {
    const input = titleInputRef.current;
    if (!input) return;

    const resizeTitle = () => {
      input.style.height = "0px";
      input.style.height = `${input.scrollHeight}px`;
    };

    resizeTitle();
    window.addEventListener("resize", resizeTitle);
    return () => window.removeEventListener("resize", resizeTitle);
  }, [titleDraft]);

  useEffect(() => {
    setProjectRetry(null);
    setDescriptionRetry(null);
    setError(null);
  }, [issue?.id]);

  function applyUpdatedIssue(updatedIssue: Issue) {
    queryClient.setQueryData<IssueDetailViewModel>(["issue-detail", issueId], (current) =>
      current ? { ...current, issue: updatedIssue } : current,
    );
    queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
      current
        ? {
            ...current,
            issues: current.issues.map((item) =>
              item.id === updatedIssue.id ? updatedIssue : item,
            ),
          }
        : current,
    );
  }

  async function saveDescription(nextDescription = description, nextTitle = titleDraft) {
    if (!issue || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiPatch<{ issue: Issue }>(`/api/v1/issues/${issue.id}`, {
        idempotencyKey: idempotencyKey(),
        version: issue.version,
        patch: { title: nextTitle, descriptionJson: textDocument(nextDescription) },
      });
      applyUpdatedIssue(result.issue);
      await detailQuery.refetch();
      setDescriptionRetry(null);
    } catch (caught) {
      setDescriptionRetry({ description: nextDescription, title: nextTitle });
      if (caught instanceof ApiError && caught.code === "ISSUE_VERSION_CONFLICT") {
        const latest = await detailQuery.refetch();
        if (latest.data) {
          setDescription(latest.data.issue.description);
          setTitleDraft(latest.data.issue.title);
        } else {
          setDescription(issue.description);
          setTitleDraft(issue.title);
        }
      } else {
        setDescription(issue.description);
        setTitleDraft(issue.title);
      }
      setError(caught instanceof ApiError ? caught.message : "説明の保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function saveProject(nextProjectId = projectIdDraft) {
    if (!issue || saving) return;
    if (nextProjectId === (issue.projectId ?? "")) {
      setProjectRetry(null);
      return;
    }
    setSaving(true);
    setError(null);
    setProjectRetry(null);
    try {
      const result = await apiPatch<{ issue: Issue }>(`/api/v1/issues/${issue.id}`, {
        idempotencyKey: idempotencyKey(),
        version: issue.version,
        patch: { projectId: projectIdFromSelection(nextProjectId) },
      });
      applyUpdatedIssue(result.issue);
      setProjectRetry(null);
      await detailQuery.refetch();
    } catch (caught) {
      setProjectRetry(nextProjectId);
      if (caught instanceof ApiError && caught.code === "ISSUE_VERSION_CONFLICT") {
        const latest = await detailQuery.refetch();
        if (latest.data) {
          applyUpdatedIssue(latest.data.issue);
          setProjectIdDraft(latest.data.issue.projectId ?? "");
        } else {
          setProjectIdDraft(issue.projectId ?? "");
        }
      } else {
        setProjectIdDraft(issue.projectId ?? "");
      }
      setError(caught instanceof ApiError ? caught.message : "Projectの保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function trashIssue() {
    if (!issue || saving) return;
    if (typeof window !== "undefined" && !window.confirm("このIssueをゴミ箱へ移動しますか？"))
      return;
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/v1/issues/${issue.id}?action=trash`, {
        idempotencyKey: idempotencyKey(),
      });
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current
          ? { ...current, issues: current.issues.filter((item) => item.id !== issue.id) }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["issues"] });
      queryClient.removeQueries({ queryKey: ["issue-detail", issue.id] });
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Issueの削除に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function archiveCurrentIssue() {
    if (!issue || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onArchive();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Issueのアーカイブに失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!noteBody || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/v1/issues/${issueId}/notes`, {
        idempotencyKey: idempotencyKey(),
        body: noteBody,
      });
      setNoteBody("");
      await detailQuery.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "メモの追加に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function editNote(note: IssueNoteViewModel) {
    if (!noteDraft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/issues/${issueId}/notes/${note.id}`, {
        idempotencyKey: idempotencyKey(),
        body: noteDraft,
      });
      setEditingNoteId(null);
      setNoteDraft("");
      await detailQuery.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "メモの保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function removeNote(noteId: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiDelete(`/api/v1/issues/${issueId}/notes/${noteId}`);
      await detailQuery.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "メモの削除に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function addRelation() {
    if (!relationTargetId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/v1/issues/${issueId}/relations`, {
        idempotencyKey: idempotencyKey(),
        targetIssueId: relationTargetId,
        type: relationType,
      });
      setRelationTargetId("");
      await detailQuery.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Relationの追加に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function removeRelation(relationId: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiDelete(`/api/v1/issues/${issueId}/relations/${relationId}`);
      await detailQuery.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Relationの削除に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop issue-detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-detail-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="detail-panel modal-panel">
        <div className="detail-header">
          <div>
            <span className="eyebrow coral">{issue?.identifier ?? "ISSUE DETAIL"}</span>
            <textarea
              id="issue-detail-title"
              className="detail-title-input"
              aria-label="Issueタイトル"
              ref={titleInputRef}
              value={titleDraft}
              rows={1}
              onChange={(event) => setTitleDraft(event.target.value)}
            />
          </div>
          <button
            className="icon-button detail-close"
            aria-label="Issue詳細を閉じる"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {detailQuery.isLoading && <div className="detail-skeleton">詳細を読み込んでいます…</div>}
        {detailQuery.error && (
          <div className="detail-error">
            <strong>{notFound ? "Issueが見つかりません" : "Issue詳細を読み込めません"}</strong>
            {notFound ? (
              <button className="text-button" onClick={onClose}>
                Issuesへ戻る →
              </button>
            ) : (
              <button className="text-button" onClick={() => detailQuery.refetch()}>
                再試行 →
              </button>
            )}
          </div>
        )}
        {issue && (
          <div className="detail-grid">
            <section className="detail-main">
              <div className="detail-properties">
                <select
                  className="detail-priority-select"
                  aria-label="IssueのPriority"
                  value={issue.priority}
                  disabled={pending || saving}
                  onChange={(event) =>
                    onUpdate(issue, { priority: priorityFromSelection(event.target.value) })
                  }
                >
                  {Object.entries(priorityLabel).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="status-pill active">Version {issue.version}</span>
                <select
                  className="detail-status-select"
                  aria-label="IssueのStatus"
                  value={issue.statusId}
                  disabled={pending || saving}
                  onChange={(event) => onUpdate(issue, { statusId: event.target.value })}
                >
                  {workflowStates.map((state) => (
                    <option value={state.id} key={state.id}>
                      {state.name}
                    </option>
                  ))}
                </select>
                <span className="detail-date">更新 {formatDate(issue.updatedAt)}</span>
              </div>
              <div className="detail-property-editor">
                <label className="field-label" htmlFor="issue-project">
                  Project
                </label>
                <select
                  id="issue-project"
                  aria-label="IssueのProject"
                  value={projectIdDraft}
                  disabled={saving}
                  onChange={(event) => setProjectIdDraft(event.target.value)}
                >
                  <option value="">Projectなし</option>
                  {projects.map((project) => (
                    <option value={project.id} key={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary"
                  disabled={saving || projectIdDraft === (issue.projectId ?? "")}
                  onClick={() => void saveProject()}
                >
                  {saving ? "保存中…" : "Projectを保存"}
                </button>
              </div>
              <div className="detail-property-editor issue-core-properties">
                <label className="field-label" htmlFor="issue-due-date">
                  Due date
                </label>
                <input
                  id="issue-due-date"
                  type="date"
                  aria-label="IssueのDue date"
                  value={dateInputValue(issue.dueAt)}
                  disabled={pending || saving}
                  onChange={(event) =>
                    onUpdate(issue, { dueAt: dateInputToUnix(event.target.value) })
                  }
                />
                <label className="field-label" htmlFor="issue-parent">
                  Parent Issue
                </label>
                <select
                  id="issue-parent"
                  aria-label="IssueのParent"
                  value={issue.parentId ?? ""}
                  disabled={pending || saving}
                  onChange={(event) => onUpdate(issue, { parentId: event.target.value || null })}
                >
                  <option value="">Parentなし</option>
                  {knownIssues
                    .filter(
                      (candidate) =>
                        candidate.id !== issue.id &&
                        candidate.deletedAt === null &&
                        candidate.archivedAt === null,
                    )
                    .map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>
                        {candidate.identifier} · {candidate.title}
                      </option>
                    ))}
                </select>
              </div>
              {detail && (
                <section className="issue-hierarchy" aria-label="親子Issue">
                  <div className="detail-section-heading">
                    <div>
                      <span className="eyebrow">HIERARCHY</span>
                      <h3>親子Issue</h3>
                    </div>
                    <span className="detail-count">{detail.children.length}</span>
                  </div>
                  {detail.parent && (
                    <button
                      className="text-button hierarchy-parent"
                      onClick={() =>
                        void router.navigate({ to: `/issues/${detail.parent!.id}` as never })
                      }
                    >
                      ↑ {detail.parent.identifier} · {detail.parent.title}
                    </button>
                  )}
                  <p className="child-progress-summary">
                    子Issue {detail.childProgress.completed} / {detail.childProgress.total} 完了 （
                    {detail.childProgress.progressPercent}%）
                  </p>
                  <div className="child-issue-list">
                    {detail.children.map((child) => (
                      <button
                        className="text-button child-issue-link"
                        key={child.id}
                        onClick={() => void router.navigate({ to: `/issues/${child.id}` as never })}
                      >
                        {child.identifier} · {child.title}
                      </button>
                    ))}
                    {detail.children.length === 0 && (
                      <p className="detail-empty">Sub-issueはまだありません。</p>
                    )}
                  </div>
                </section>
              )}
              <label className="detail-label" htmlFor="issue-description">
                Description
              </label>
              <textarea
                id="issue-description"
                className="detail-textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="説明を追加…"
                rows={6}
              />
              <div className="detail-actions">
                <button
                  className="button primary"
                  disabled={
                    saving || (description === issue.description && titleDraft === issue.title)
                  }
                  onClick={() => void saveDescription()}
                >
                  {saving ? "保存中…" : "説明を保存"}
                </button>
                <button className="button ghost" onClick={onClose}>
                  閉じる
                </button>
                <button
                  className="button ghost"
                  disabled={saving || pending}
                  onClick={() => void archiveCurrentIssue()}
                >
                  アーカイブ
                </button>
                <button
                  className="button ghost danger"
                  disabled={saving}
                  onClick={() => void trashIssue()}
                >
                  ゴミ箱へ
                </button>
              </div>
              <section className="detail-section">
                <div className="detail-section-heading">
                  <div>
                    <span className="eyebrow">NOTES</span>
                    <h3>作業メモ</h3>
                  </div>
                  <span className="detail-count">{detail?.notes.length ?? 0}</span>
                </div>
                <div className="note-compose">
                  <textarea
                    aria-label="新しい作業メモ"
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    placeholder="調査結果や次の一手をメモ…"
                    rows={3}
                  />
                  <button
                    className="button secondary"
                    disabled={saving || !noteBody}
                    onClick={() => void addNote()}
                  >
                    メモを追加
                  </button>
                </div>
                <div className="note-list">
                  {detail?.notes.map((note) => (
                    <article className="note-card" key={note.id}>
                      {editingNoteId === note.id ? (
                        <textarea
                          aria-label="編集中の作業メモ"
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          rows={3}
                        />
                      ) : (
                        <p className="note-body">{note.body}</p>
                      )}
                      <div className="note-footer">
                        <span>
                          {formatDate(note.editedAt ?? note.createdAt)}
                          {note.editedAt ? " · 編集済み" : ""}
                        </span>
                        {editingNoteId === note.id ? (
                          <>
                            <button className="text-button" onClick={() => void editNote(note)}>
                              保存
                            </button>
                            <button className="text-button" onClick={() => setEditingNoteId(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="text-button"
                              onClick={() => {
                                setEditingNoteId(note.id);
                                setNoteDraft(note.body);
                              }}
                            >
                              編集
                            </button>
                            <button
                              className="text-button danger"
                              onClick={() => void removeNote(note.id)}
                            >
                              削除
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                  {detail?.notes.length === 0 && (
                    <p className="detail-empty">まだメモはありません。</p>
                  )}
                </div>
              </section>
              <section className="detail-section">
                <div className="detail-section-heading">
                  <div>
                    <span className="eyebrow">RELATIONS</span>
                    <h3>関連Issue</h3>
                  </div>
                  <span className="detail-count">{detail?.relations.length ?? 0}</span>
                </div>
                <div className="relation-compose">
                  <select
                    aria-label="Relation先"
                    value={relationTargetId}
                    onChange={(event) => setRelationTargetId(event.target.value)}
                  >
                    <option value="">Issueを選択…</option>
                    {knownIssues
                      .filter((item) => item.id !== issue.id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.identifier} · {item.title}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="Relation種別"
                    value={relationType}
                    onChange={(event) =>
                      setRelationType(event.target.value as IssueRelationTypeViewModel)
                    }
                  >
                    {Object.entries(relationLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary"
                    disabled={saving || !relationTargetId}
                    onClick={() => void addRelation()}
                  >
                    追加
                  </button>
                </div>
                <div className="relation-list">
                  {detail?.relations.map((relation) => (
                    <div className="relation-card" key={relation.id}>
                      <span className="relation-type">{relationLabels[relation.type]}</span>
                      <button
                        className="relation-target"
                        onClick={() =>
                          void router.navigate({ to: `/issues/${relation.target.id}` as never })
                        }
                      >
                        <span className="issue-id">{relation.target.identifier}</span>
                        <strong>{relation.target.title}</strong>
                      </button>
                      <button
                        className="text-button danger"
                        aria-label={`${relation.target.identifier}とのRelationを削除`}
                        onClick={() => void removeRelation(relation.id)}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                  {detail?.relations.length === 0 && (
                    <p className="detail-empty">関連Issueはありません。</p>
                  )}
                </div>
              </section>
            </section>
            <aside className="detail-activity">
              <span className="eyebrow">ACTIVITY</span>
              <h3>変更履歴</h3>
              <div className="activity-list">
                {detail?.activity.map((event) => (
                  <div className="activity-item" key={event.id}>
                    <span className="activity-dot" />
                    <div>
                      <strong>{event.action}</strong>
                      <span>{formatDate(event.createdAt)}</span>
                    </div>
                  </div>
                ))}
                {detail?.activity.length === 0 && (
                  <p className="detail-empty">Activityはありません。</p>
                )}
              </div>
            </aside>
          </div>
        )}
        {error && (
          <div className="detail-live-error" role="alert">
            <span>{error}</span>
            {descriptionRetry !== null && (
              <button
                className="text-button"
                onClick={() => {
                  const retry = descriptionRetry;
                  setDescription(retry.description);
                  setTitleDraft(retry.title);
                  setError(null);
                  setDescriptionRetry(null);
                  void saveDescription(retry.description, retry.title);
                }}
              >
                説明を再試行
              </button>
            )}
            {projectRetry !== null && (
              <button
                className="text-button"
                onClick={() => {
                  const retry = projectRetry;
                  setProjectIdDraft(retry);
                  setError(null);
                  void saveProject(retry);
                }}
              >
                Projectを再試行
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function IssueComposer({
  title,
  setTitle,
  projects,
  projectId,
  setProjectId,
  priority,
  setPriority,
  dueAt,
  setDueAt,
  parentId,
  setParentId,
  issues,
  existingIssue,
  onClose,
  onSubmit,
  busy,
}: {
  title: string;
  setTitle: (value: string) => void;
  projects: Project[];
  projectId: string;
  setProjectId: (value: string) => void;
  priority: Issue["priority"];
  setPriority: (value: Issue["priority"]) => void;
  dueAt: number | null;
  setDueAt: (value: number | null) => void;
  parentId: string;
  setParentId: (value: string) => void;
  issues: Issue[];
  existingIssue?: Issue;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-composer-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="composer modal-panel">
        <div className="composer-top">
          <span className="eyebrow">{existingIssue ? existingIssue.identifier : "NEW ISSUE"}</span>
          <h2 id="issue-composer-title" className="visually-hidden">
            {existingIssue ? "Issue詳細" : "新しいIssue"}
          </h2>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        {existingIssue ? (
          <>
            <h2>{existingIssue.title}</h2>
            <p className="composer-description">
              Issue detail URL: <code>/issues/{shortId(existingIssue.id)}</code>
            </p>
            <div className="composer-properties">
              <span className={`priority-badge ${priorityTone[existingIssue.priority]}`}>
                {priorityLabel[existingIssue.priority]}
              </span>
              <span className="status-pill active">Version {existingIssue.version}</span>
            </div>
          </>
        ) : (
          <>
            <textarea
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (
                  shouldSubmitIssueOnEnter({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: event.nativeEvent.isComposing,
                    keyCode: event.keyCode,
                    busy,
                  })
                ) {
                  event.preventDefault();
                  if (hasIssueTitle(title)) onSubmit();
                }
              }}
              placeholder="何を進めますか？"
              rows={3}
            />
            <label className="field-label" htmlFor="new-issue-project">
              Project
            </label>
            <select
              id="new-issue-project"
              aria-label="新しいIssueのProject"
              className="text-input"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Projectなし</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="new-issue-priority">
              Priority
            </label>
            <select
              id="new-issue-priority"
              aria-label="新しいIssueのPriority"
              className="text-input"
              value={priority}
              onChange={(event) => setPriority(priorityFromSelection(event.target.value))}
            >
              {Object.entries(priorityLabel).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="new-issue-due-date">
              Due date
            </label>
            <input
              id="new-issue-due-date"
              type="date"
              aria-label="新しいIssueのDue date"
              className="text-input"
              value={dateInputValue(dueAt)}
              onChange={(event) => setDueAt(dateInputToUnix(event.target.value))}
            />
            <label className="field-label" htmlFor="new-issue-parent">
              Parent Issue
            </label>
            <select
              id="new-issue-parent"
              aria-label="新しいIssueのParent"
              className="text-input"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">Parentなし</option>
              {issues
                .filter((issue) => issue.deletedAt === null && issue.archivedAt === null)
                .map((issue) => (
                  <option value={issue.id} key={issue.id}>
                    {issue.identifier} · {issue.title}
                  </option>
                ))}
            </select>
            <div className="composer-hint">
              <span>Enterで作成</span>
              <span>Shift + Enterで改行</span>
              <kbd>Esc</kbd>
            </div>
            <div className="modal-actions">
              <button className="button ghost" onClick={onClose}>
                キャンセル
              </button>
              <button
                className="button primary"
                disabled={busy || !title.trim()}
                onClick={onSubmit}
              >
                {busy ? "作成中…" : "Issueを作成"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CommandPalette({
  onClose,
  onCreate,
  onNavigate,
  onSearch,
  selectedIssue,
  onOpenSelected,
  onArchiveSelected,
  onClearSelection,
  modifierLabel,
}: {
  onClose: () => void;
  onCreate: () => void;
  onNavigate: (section: Section) => void;
  onSearch: (value: string) => void;
  selectedIssue?: Issue;
  onOpenSelected: () => void;
  onArchiveSelected: () => void;
  onClearSelection: () => void;
  modifierLabel: "⌘" | "Ctrl";
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = [
    { label: "新しいIssueを作成", hint: "C", action: onCreate },
    ...(
      ["home", "issues", "cycles", "projects", "search", "inbox", "views", "settings"] as Section[]
    ).map((item) => ({
      label: sectionLabels[item],
      hint: sectionIcons[item],
      action: () => onNavigate(item),
    })),
    ...(query.trim()
      ? [{ label: `検索「${query.trim()}」`, hint: "Enter", action: () => onSearch(query.trim()) }]
      : []),
    ...(selectedIssue
      ? [
          { label: "選択中Issueを開く", hint: "↵", action: onOpenSelected },
          { label: "選択中Issueをアーカイブ", hint: "Archive", action: onArchiveSelected },
          { label: "選択解除", hint: "Esc", action: onClearSelection },
        ]
      : []),
  ];
  const filtered = commands.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    setActiveIndex((current) => Math.min(Math.max(current, 0), Math.max(filtered.length - 1, 0)));
  }, [query, filtered.length]);
  useEffect(() => inputRef.current?.focus(), []);

  function activate(index: number) {
    const command = filtered[index];
    if (!command) return;
    command.action();
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-palette">
        <h2 id="command-palette-title" className="visually-hidden">
          コマンドパレット
        </h2>
        <div className="command-input">
          <span>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="コマンドやページを検索…"
            role="combobox"
            aria-controls="command-palette-options"
            aria-expanded="true"
            aria-activedescendant={
              filtered[activeIndex] ? `command-option-${activeIndex}` : undefined
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => nextCommandIndex(filtered.length, current, 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => nextCommandIndex(filtered.length, current, -1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                activate(activeIndex);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <div className="command-list" id="command-palette-options" role="listbox">
          {filtered.map((command, index) => (
            <button
              key={command.label}
              id={`command-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activate(index)}
            >
              <span>{command.label}</span>
              <kbd>{command.hint}</kbd>
            </button>
          ))}
          {filtered.length === 0 && <p className="command-empty">コマンドが見つかりません。</p>}
        </div>
        <div className="command-footer">
          <span>↑↓ 移動</span>
          <span>Enter 決定</span>
          <span>Esc 閉じる</span>
        </div>
        <span className="visually-hidden">修飾キー: {modifierLabel}</span>
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [
      ...panel.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ),
    ];
    (focusable()[0] ?? panel).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel generic-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generic-modal-title"
        tabIndex={-1}
      >
        <div className="modal-title">
          <h2 id="generic-modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function EmptyState({
  title,
  action,
  onAction,
}: {
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">◌</span>
      <strong>{title}</strong>
      <p>まだ表示するデータがありません。</p>
      <button className="text-button" onClick={onAction}>
        {action} →
      </button>
    </div>
  );
}
