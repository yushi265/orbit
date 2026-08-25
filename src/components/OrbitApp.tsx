import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BootstrapViewModel as BootstrapPayload,
  CycleViewModel as Cycle,
  IssueViewModel as Issue,
  ProjectViewModel as Project,
  PublicRunViewModel as PublicRunSummary,
  SavedViewViewModel as SavedView,
  WorkflowStateViewModel as WorkflowState,
  IssueDetailViewModel,
  IssueNoteViewModel,
  IssueRelationTypeViewModel,
  LabelViewModel as Label,
} from "../shared/view-models";
import { calculateCycleMetrics, cycleTabForStatus, type CycleTab } from "../shared/cycle-workspace";
import { NO_PROJECT_OPTION, projectIdFromSelection } from "./issue-project";
import { filterCompletedIssues, issueSortOptions, type IssueSort, sortIssues } from "./issue-list";
import { priorityFromSelection } from "./issue-priority";
import { issueDetailPath, projectDetailPath } from "./navigation";
import { resolveTheme } from "./theme";
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
type IssueMutationRetry = { issue: Issue; patch: Partial<Issue> };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>;
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [priorityFilter, setPriorityFilter] = useState<Issue["priority"] | "all">("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [showCompleted, setShowCompleted] = useState(true);
  const [issueSort, setIssueSort] = useState<IssueSort>("updated_desc");
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

  function rememberIssueFocus(issueId: string) {
    issueTriggerIdRef.current = issueId;
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
  const data = bootstrap.data;
  const issues = data?.issues ?? [];
  const projects = data?.projects ?? [];
  const cycles = data?.cycles ?? [];
  const labels = data?.labels ?? [];
  const notifications = data?.notifications ?? [];
  const workflowStates = data?.workflowStates ?? [];
  const activeCycle = cycles.find((cycle) => cycle.status === "active");
  const unread = notifications.filter((notification) => !notification.readAt).length;
  const visibleIssues = useMemo(() => {
    const filtered = issues.filter((issue) => {
      const matchesText =
        !filterText.trim() ||
        `${issue.identifier} ${issue.title} ${issue.description}`
          .toLocaleLowerCase()
          .includes(filterText.toLocaleLowerCase());
      const matchesPriority = priorityFilter === "all" || issue.priority === priorityFilter;
      const matchesLabel = labelFilter === "all" || issue.labelIds.includes(labelFilter);
      return matchesText && matchesPriority && matchesLabel;
    });
    return sortIssues(filterCompletedIssues(filtered, workflowStates, showCompleted), issueSort);
  }, [issues, filterText, priorityFilter, labelFilter, workflowStates, showCompleted, issueSort]);

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
    if (!data || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = resolveTheme(data.preferences.theme, media.matches);
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", resolved === "dark" ? "#11151d" : "#ff725e");
    };
    applyTheme();
    if (data.preferences.theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [data?.preferences.theme]);

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
    if (current && ["running", "pending"].includes(current.status)) setRun(current);
  }, [data?.background.run]);

  useEffect(() => {
    if (!composerOpen && !props.issueId) restoreIssueFocus();
  }, [composerOpen, props.issueId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key === "Escape") {
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
      if (editing) return;
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        setComposerOpen(true);
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if (event.key.toLowerCase() === "b")
        setViewMode((mode) => (mode === "list" ? "board" : "list"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bulkBusy, composerOpen, props.issueId, router]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
  const showToast = (kind: "success" | "error", text: string, action?: ToastAction) => {
    setToast({ kind, text, action });
    window.setTimeout(() => setToast(null), 3500);
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
      setComposerOpen(false);
      showToast("success", `${issue.identifier} を作成しました`);
    },
    onError: (error) =>
      showToast("error", error instanceof ApiError ? error.message : "Issueの作成に失敗しました。"),
  });

  const updateIssue = useMutation({
    mutationFn: ({ issue, patch }: { issue: Issue; patch: Partial<Issue> }) =>
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
    onSuccess: ({ issue }) => {
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current
          ? {
              ...current,
              issues: current.issues.map((item) => (item.id === issue.id ? issue : item)),
            }
          : current,
      );
      queryClient.setQueryData<IssueDetailViewModel>(["issue-detail", issue.id], (current) =>
        current ? { ...current, issue } : current,
      );
      showToast("success", "変更を保存しました");
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
      const retry = { issue: retryIssue, patch: variables.patch } satisfies IssueMutationRetry;
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
            setToast(null);
            updateIssue.mutate(retry);
          },
        },
      );
    },
    onSettled: () => setPendingIssueId(null),
  });

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

  function executeSearch(value: string) {
    setSearchText(value);
    if (searchTimer.current !== undefined) window.clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setRemoteSearch([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void apiGet<{ items: Issue[] }>(`/api/v1/search?q=${encodeURIComponent(value)}`)
        .then((result) => setRemoteSearch(result.items))
        .catch((error) =>
          showToast("error", error instanceof ApiError ? error.message : "検索に失敗しました"),
        );
    }, 300);
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
              <kbd>⌘ K</kbd>
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
              cycles={cycles}
              labels={labels}
              viewMode={viewMode}
              setViewMode={setViewMode}
              selected={selected}
              setSelected={setSelected}
              pendingIssueId={pendingIssueId}
              onUpdate={(issue, patch) => updateIssue.mutate({ issue, patch })}
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
              onOpen={(issue) => {
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
              labels={labels}
              onRefresh={refresh}
              run={activeRun}
              runBusy={runBusy}
              onRun={runMaintenance}
              onResume={resumeMaintenance}
              onTheme={(theme) =>
                apiPatch("/api/v1/preferences", { idempotencyKey: idempotencyKey(), theme })
                  .then(refresh)
                  .catch(() => showToast("error", "テーマの変更に失敗しました"))
              }
              canInstallPwa={installPrompt !== null}
              onInstallPwa={() => void installPwa()}
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
            onClose={() => {
              setComposerOpen(false);
              setNewTitle("");
              setNewProjectId("");
              setNewPriority("no_priority");
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
        />
      )}
      {shortcutsOpen && (
        <Modal title="キーボードショートカット" onClose={() => setShortcutsOpen(false)}>
          <div className="shortcut-list">
            {[
              ["C", "Issueを作成"],
              ["⌘ K", "コマンドメニュー"],
              ["B", "List / Board切替"],
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
                <div>
                  <strong>{cycleMetrics.estimateTotal}</strong>
                  <span>Scope points</span>
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

function IssuesView({
  issues,
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
  cycles,
  labels,
  viewMode,
  setViewMode,
  selected,
  setSelected,
  pendingIssueId,
  onUpdate,
  onBulk,
  bulkBusy,
  resetBulkMutation,
  onCreate,
  onOpenIssue,
}: {
  issues: Issue[];
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
  cycles: Cycle[];
  labels: Label[];
  viewMode: "list" | "board";
  setViewMode: (value: "list" | "board") => void;
  selected: string[];
  setSelected: (value: string[]) => void;
  pendingIssueId: string | null;
  onUpdate: (issue: Issue, patch: Partial<Issue>) => void;
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
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Issueを検索…"
          />
          <kbd>⌘ F</kbd>
        </div>
        <select
          className="filter-select"
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
        <div className="issue-table">
          <div className="table-header">
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
              onUpdate={onUpdate}
              labels={labels}
              projects={projects}
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
  projects = [],
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
  projects?: Project[];
}) {
  return (
    <div className={`issue-row ${compact ? "compact" : ""} ${pending ? "pending" : ""}`}>
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
        <select
          aria-label={`${issue.identifier}のStatus`}
          value={issue.statusId}
          disabled={pending}
          onChange={(event) => onUpdate?.(issue, { statusId: event.target.value })}
        >
          {(workflowStates.length ? workflowStates : state ? [state] : []).map((status) => (
            <option value={status.id} key={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </span>
      <span className="priority-cell">
        {onUpdate && !compact ? (
          <select
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
        ) : (
          <span className={`priority-badge ${priorityTone[issue.priority]}`}>
            {priorityLabel[issue.priority]}
          </span>
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
      <span className="due-cell">{formatDate(issue.dueAt)}</span>
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
        <span className="card-meta">
          {issue.estimate ? `${issue.estimate} pts` : "No estimate"}
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
            <div>
              <strong>{metrics.estimateTotal}</strong>
              <span>Estimate</span>
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
                <span className="mini-points">
                  {issue.estimate ? `${issue.estimate} pts` : "—"}
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
            <div>
              <strong>{projectMetrics.estimateTotal}</strong>
              <span>Estimate</span>
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

function SearchView({
  query,
  onQuery,
  results,
  onOpen,
}: {
  query: string;
  onQuery: (value: string) => void;
  results: Issue[];
  onOpen: (issue: Issue) => void;
}) {
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
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="何を探していますか？"
        />
        <kbd>⌘ F</kbd>
      </div>
      {query && (
        <div className="search-results">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RESULTS</span>
              <h2>{results.length}件のIssue</h2>
            </div>
          </div>
          {results.map((issue) => (
            <button className="search-result" key={issue.id} onClick={() => onOpen(issue)}>
              <span className="issue-id">{issue.identifier}</span>
              <strong>{issue.title}</strong>
              <span>{issue.description || "説明なし"}</span>
              <span>→</span>
            </button>
          ))}
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
    setOrderDraft(view.query.order);
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
                ["estimate", "Estimate"],
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
            Order: {selectedView.query.order} · Limit: {String(selectedView.query.limit ?? "—")}
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

function SettingsView({
  preferences,
  labels,
  onRefresh,
  run,
  runBusy,
  onRun,
  onResume,
  onTheme,
  canInstallPwa,
  onInstallPwa,
}: {
  preferences: BootstrapPayload["preferences"];
  labels: BootstrapPayload["labels"];
  onRefresh: () => Promise<unknown> | void;
  run: PublicRunSummary | null;
  runBusy: boolean;
  onRun: () => void;
  onResume: () => void;
  onTheme: (theme: "light" | "dark" | "system") => void;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
}) {
  const [themeDraft, setThemeDraft] = useState(preferences.theme);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("#E05252");
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const labelMutationKeyRef = useRef<string | null>(null);
  const labelDeleteRetryRef = useRef<BootstrapPayload["labels"][number] | null>(null);
  const [labelErrorAction, setLabelErrorAction] = useState<"save" | "delete" | null>(null);

  useEffect(() => setThemeDraft(preferences.theme), [preferences.theme]);

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
          </div>
          <div className="setting-row">
            <div>
              <strong>Theme</strong>
              <span>ライト・ダーク・システム</span>
            </div>
            <select
              value={themeDraft}
              onChange={(event) => {
                const nextTheme = event.target.value as "light" | "dark" | "system";
                setThemeDraft(nextTheme);
                onTheme(nextTheme);
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Language</strong>
              <span>表示言語</span>
            </div>
            <span className="setting-value">
              {preferences.locale === "ja" ? "日本語" : "English"}
            </span>
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
                  ? run.status === "running"
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
        <section className="settings-card">
          <div className="settings-card-title">
            <span className="settings-icon purple">⌁</span>
            <div>
              <h2>Cycle defaults</h2>
              <p>計画のリズムを設定</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>Timezone</strong>
              <span>Cycle境界と日付表示</span>
            </div>
            <span className="setting-value">{preferences.timezone}</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>Estimate</strong>
              <span>Scope計算にpointを使う</span>
            </div>
            <span className={`toggle ${preferences.estimateEnabled ? "on" : ""}`}>
              <span />
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

function RunOverlay({
  run,
  busy,
  onResume,
}: {
  run: PublicRunSummary;
  busy: boolean;
  onResume: () => void;
}) {
  const blocking = ["pending", "running"].includes(run.status);
  return (
    <div className={`run-overlay ${blocking ? "blocking" : ""}`} role="status">
      <div className="run-overlay-card">
        <div className="run-spinner">
          {blocking ? "◌" : run.status === "failed" || run.status === "paused" ? "!" : "✓"}
        </div>
        <span className="eyebrow coral">BACKGROUND RUN</span>
        <h2>
          {run.status === "running"
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
  onClose,
}: {
  issueId: string;
  fallbackIssue?: Issue;
  knownIssues: Issue[];
  projects: Project[];
  onUpdate: (issue: Issue, patch: Partial<Issue>) => void;
  pending: boolean;
  workflowStates: WorkflowState[];
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
      queryClient.removeQueries({ queryKey: ["issue-detail", issue.id] });
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Issueの削除に失敗しました。");
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

function IssueComposer({
  title,
  setTitle,
  projects,
  projectId,
  setProjectId,
  priority,
  setPriority,
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
  existingIssue?: Issue;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="composer modal-panel">
        <div className="composer-top">
          <span className="eyebrow">{existingIssue ? existingIssue.identifier : "NEW ISSUE"}</span>
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
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (title.trim()) onSubmit();
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

function CommandPalette({
  onClose,
  onCreate,
  onNavigate,
  onSearch,
}: {
  onClose: () => void;
  onCreate: () => void;
  onNavigate: (section: Section) => void;
  onSearch: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const commands = [
    { label: "新しいIssueを作成", hint: "C", action: onCreate },
    ...(["issues", "cycles", "projects", "search", "inbox", "settings"] as Section[]).map(
      (item) => ({
        label: sectionLabels[item],
        hint: sectionIcons[item],
        action: () => onNavigate(item),
      }),
    ),
  ];
  const filtered = commands.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-palette">
        <div className="command-input">
          <span>⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="コマンドやページを検索…"
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) onSearch(query);
            }}
          />
        </div>
        <div className="command-list">
          {filtered.map((command) => (
            <button key={command.label} onClick={command.action}>
              <span>{command.label}</span>
              <kbd>{command.hint}</kbd>
            </button>
          ))}
        </div>
        <div className="command-footer">
          <span>↑↓ 移動</span>
          <span>Enter 決定</span>
          <span>Esc 閉じる</span>
        </div>
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
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-panel generic-modal">
        <div className="modal-title">
          <h2>{title}</h2>
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
