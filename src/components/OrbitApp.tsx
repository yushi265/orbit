import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "../shared/view-models";
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
type Props = { initialSection?: Section; issueId?: string };

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

function formatRange(start: number, end: number): string {
  return `${formatDate(start)} — ${formatDate(end)}`;
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
  const [selected, setSelected] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [priorityFilter, setPriorityFilter] = useState<Issue["priority"] | "all">("all");
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [remoteSearch, setRemoteSearch] = useState<Issue[]>([]);
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [run, setRun] = useState<PublicRunSummary | null>(null);
  const [runBusy, setRunBusy] = useState(false);
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
  const notifications = data?.notifications ?? [];
  const workflowStates = data?.workflowStates ?? [];
  const activeCycle = cycles.find((cycle) => cycle.status === "active");
  const unread = notifications.filter((notification) => !notification.readAt).length;
  const visibleIssues = useMemo(
    () =>
      issues.filter((issue) => {
        const matchesText =
          !filterText.trim() ||
          `${issue.identifier} ${issue.title} ${issue.description}`
            .toLocaleLowerCase()
            .includes(filterText.toLocaleLowerCase());
        const matchesPriority = priorityFilter === "all" || issue.priority === priorityFilter;
        return matchesText && matchesPriority;
      }),
    [issues, filterText, priorityFilter],
  );

  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js?v=2", { updateViaCache: "none" })
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
  }, [composerOpen, props.issueId, router]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
  const showToast = (kind: "success" | "error", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3500);
  };

  const createIssue = useMutation({
    mutationFn: () =>
      apiPost<{ issue: Issue }>("/api/v1/issues", {
        idempotencyKey: idempotencyKey(),
        title: newTitle.trim(),
        projectId: activeCycle ? null : null,
        cycleId: activeCycle?.id ?? null,
      }),
    onSuccess: ({ issue }) => {
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current ? { ...current, issues: [issue, ...current.issues] } : current,
      );
      setNewTitle("");
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
      if (previous)
        queryClient.setQueryData<BootstrapPayload>(["bootstrap"], {
          ...previous,
          issues: previous.issues.map((item) =>
            item.id === issue.id ? { ...item, ...patch } : item,
          ),
        });
      return { previous };
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
      showToast("success", "変更を保存しました");
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["bootstrap"], context.previous);
      showToast(
        "error",
        error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT"
          ? "他の場所で更新されています。最新の内容を確認してください。"
          : error instanceof ApiError
            ? error.message
            : "保存に失敗しました。",
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
              viewMode={viewMode}
              setViewMode={setViewMode}
              selected={selected}
              setSelected={setSelected}
              pendingIssueId={pendingIssueId}
              onUpdate={(issue, patch) => updateIssue.mutate({ issue, patch })}
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
              onClose={(cycle) =>
                apiPost(`/api/v1/cycles/${cycle.id}`, {})
                  .then(() => {
                    showToast("success", "Cycleを完了しました");
                    refresh();
                  })
                  .catch((error) =>
                    showToast(
                      "error",
                      error instanceof ApiError ? error.message : "Cycleの更新に失敗しました",
                    ),
                  )
              }
            />
          )}
          {section === "projects" && (
            <ProjectsView
              projects={projects}
              issues={issues}
              workflowStates={workflowStates}
              onCreate={() => setProjectComposerOpen(true)}
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
          {section === "inbox" && <InboxView notifications={notifications} />}
          {section === "views" && <ViewsView views={data.views} />}
          {section === "settings" && (
            <SettingsView
              preferences={data.preferences}
              run={activeRun}
              runBusy={runBusy}
              onRun={runMaintenance}
              onResume={resumeMaintenance}
              onTheme={(theme) =>
                apiPatch("/api/v1/preferences", { idempotencyKey: idempotencyKey(), theme })
                  .then(refresh)
                  .catch(() => showToast("error", "テーマの変更に失敗しました"))
              }
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
            issueId={props.issueId}
            fallbackIssue={issues.find((item) => item.id === props.issueId)}
            knownIssues={issues}
            workflowStates={workflowStates}
            onClose={closeIssueDetail}
          />
        ) : (
          <IssueComposer
            title={newTitle}
            setTitle={setNewTitle}
            onClose={() => {
              setComposerOpen(false);
              setNewTitle("");
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
  const completed = cycleIssues.filter(
    (item) =>
      data.workflowStates.find((state) => state.id === item.statusId)?.category === "completed",
  ).length;
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
              <h2>{cycle?.name ?? "Active Cycleなし"}</h2>
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
                    width: `${cycleIssues.length ? Math.round((completed / cycleIssues.length) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="cycle-stats">
                <div>
                  <strong>
                    {completed}
                    <small> / {cycleIssues.length}</small>
                  </strong>
                  <span>完了したIssue</span>
                </div>
                <div>
                  <strong>
                    {cycleIssues.reduce((sum, item) => sum + (item.estimate ?? 0), 0)}
                  </strong>
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
  viewMode,
  setViewMode,
  selected,
  setSelected,
  pendingIssueId,
  onUpdate,
  onCreate,
  onOpenIssue,
}: {
  issues: Issue[];
  workflowStates: WorkflowState[];
  filterText: string;
  setFilterText: (value: string) => void;
  priorityFilter: Issue["priority"] | "all";
  setPriorityFilter: (value: Issue["priority"] | "all") => void;
  viewMode: "list" | "board";
  setViewMode: (value: "list" | "board") => void;
  selected: string[];
  setSelected: (value: string[]) => void;
  pendingIssueId: string | null;
  onUpdate: (issue: Issue, patch: Partial<Issue>) => void;
  onCreate: () => void;
  onOpenIssue: (issue: Issue, trigger?: HTMLButtonElement) => void;
}) {
  const grouped = workflowStates
    .map((state) => ({ state, issues: issues.filter((issue) => issue.statusId === state.id) }))
    .filter((group) => group.issues.length > 0);
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
        <div className="bulk-bar">
          <strong>{selected.length}件選択中</strong>
          <button onClick={() => setSelected([])}>選択解除</button>
          <span>一括操作は次のボルトで有効化されます</span>
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
                  onClick={(trigger) => onOpenIssue(issue, trigger)}
                />
              ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <EmptyState
              title="Issueはまだありません"
              action="最初のIssueを作成"
              onAction={onCreate}
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
                onChange={(event) =>
                  setSelected(event.target.checked ? issues.map((issue) => issue.id) : [])
                }
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
              pending={pendingIssueId === issue.id}
              onSelect={(checked) =>
                setSelected(
                  checked ? [...selected, issue.id] : selected.filter((id) => id !== issue.id),
                )
              }
              onClick={(trigger) => onOpenIssue(issue, trigger)}
              onUpdate={onUpdate}
            />
          ))}
          {issues.length === 0 && (
            <EmptyState
              title="条件に一致するIssueはありません"
              action="フィルターを解除"
              onAction={() => {
                setFilterText("");
                setPriorityFilter("all");
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
  onSelect,
  onClick,
  onUpdate,
}: {
  issue: Issue;
  state?: WorkflowState;
  workflowStates?: WorkflowState[];
  compact?: boolean;
  selected?: boolean;
  pending?: boolean;
  onSelect?: (checked: boolean) => void;
  onClick?: (trigger: HTMLButtonElement) => void;
  onUpdate?: (issue: Issue, patch: Partial<Issue>) => void;
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
      </button>
      <span className="status-cell">
        <span className="status-dot" style={{ background: state?.color }} />
        <select
          aria-label={`${issue.identifier}のStatus`}
          value={issue.statusId}
          onChange={(event) => onUpdate?.(issue, { statusId: event.target.value })}
        >
          {(workflowStates.length ? workflowStates : state ? [state] : []).map((status) => (
            <option value={status.id} key={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </span>
      <span className={`priority-badge ${priorityTone[issue.priority]}`}>
        {priorityLabel[issue.priority]}
      </span>
      <span className="project-cell">{issue.projectId ? "◈ Project" : "—"}</span>
      <span className="due-cell">{formatDate(issue.dueAt)}</span>
    </div>
  );
}

function IssueCard({
  issue,
  state: _state,
  onClick,
}: {
  issue: Issue;
  state: WorkflowState;
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
      </div>
    </button>
  );
}

function CyclesView({
  cycles,
  issues,
  onClose,
}: {
  cycles: Cycle[];
  issues: Issue[];
  onClose: (cycle: Cycle) => void;
}) {
  const current = cycles.find((cycle) => cycle.status === "active");
  const cycleIssues = current ? issues.filter((issue) => issue.cycleId === current.id) : [];
  const prioritized = cycleIssues.filter((issue) => issue.priority !== "no_priority").length;
  const progress = Math.min(100, Math.round((prioritized / Math.max(1, cycleIssues.length)) * 100));
  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">PLANNING / CYCLES</span>
          <h1>Cycles</h1>
          <p className="subheading">短い期間に、集中する仕事を選びます。</p>
        </div>
        <button
          className="button secondary"
          onClick={() => current && onClose(current)}
          disabled={!current}
        >
          Cycleを完了
        </button>
      </div>
      <div className="cycle-tabs">
        <button className="selected">Current</button>
        <button>Upcoming</button>
        <button>Past</button>
      </div>
      {current ? (
        <section className="detail-card cycle-detail">
          <div className="detail-card-head">
            <div>
              <span className="eyebrow coral">ACTIVE CYCLE · #{current.number}</span>
              <h2>{current.name}</h2>
              <p>{formatRange(current.startsAt, current.endsAt)}</p>
            </div>
            <span className="large-orbit">◒</span>
          </div>
          <div className="detail-progress">
            <div className="progress-line">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-caption">
              <strong>{cycleIssues.length} Issues</strong>
              <span>{prioritized} with priority</span>
            </div>
          </div>
          <div className="cycle-list">
            {cycleIssues.map((issue) => (
              <div className="mini-issue" key={issue.id}>
                <span className={`priority-dot ${priorityTone[issue.priority]}`} />
                <span className="issue-id">{issue.identifier}</span>
                <strong>{issue.title}</strong>
                <span className="mini-points">
                  {issue.estimate ? `${issue.estimate} pts` : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="Active Cycleはありません"
          action="Upcomingを確認"
          onAction={() => undefined}
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
          <div className="timeline-row" key={cycle.id}>
            <span className={`timeline-dot ${cycle.status}`} />
            <div>
              <strong>{cycle.name}</strong>
              <span>{formatRange(cycle.startsAt, cycle.endsAt)}</span>
            </div>
            <span className={`status-pill ${cycle.status}`}>{cycle.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsView({
  projects,
  issues,
  workflowStates,
  onCreate,
}: {
  projects: Project[];
  issues: Issue[];
  workflowStates: WorkflowState[];
  onCreate: () => void;
}) {
  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">DELIVERY / PROJECTS</span>
          <h1>Projects</h1>
          <p className="subheading">成果物単位で、進捗とIssueを束ねます。</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          ＋ 新しいProject
        </button>
      </div>
      <div className="project-grid">
        {projects.map((project) => {
          const projectIssues = issues.filter((issue) => issue.projectId === project.id);
          const done = projectIssues.filter(
            (issue) =>
              workflowStates.find((state) => state.id === issue.statusId)?.category === "completed",
          ).length;
          return (
            <article className="project-card" key={project.id}>
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
                      width: `${projectIssues.length ? Math.round((done / projectIssues.length) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span>
                  {projectIssues.length} Issues · {formatDate(project.targetAt)}まで
                </span>
              </div>
            </article>
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

function InboxView({ notifications }: { notifications: BootstrapPayload["notifications"] }) {
  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">UPDATES</span>
          <h1>Inbox</h1>
          <p className="subheading">あなたのワークスペースの変化。</p>
        </div>
        <button className="button ghost">すべて既読</button>
      </div>
      <div className="inbox-list">
        {notifications.map((notification) => (
          <div
            className={`notification-row ${notification.readAt ? "read" : ""}`}
            key={notification.id}
          >
            <span className="notification-icon">{notification.type === "overdue" ? "!" : "✦"}</span>
            <div>
              <strong>{notification.title}</strong>
              <p>{notification.body}</p>
              <span>{formatDate(notification.createdAt)}</span>
            </div>
            <button className="more">•••</button>
          </div>
        ))}
        {notifications.length === 0 && (
          <EmptyState
            title="新しい通知はありません"
            action="Issueを見る"
            onAction={() => undefined}
          />
        )}
      </div>
    </div>
  );
}

function ViewsView({ views }: { views: SavedView[] }) {
  return (
    <div className="page">
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">SAVED VIEWS</span>
          <h1>Views</h1>
          <p className="subheading">よく使う見え方を保存しておきます。</p>
        </div>
        <button className="button secondary">＋ Viewを保存</button>
      </div>
      <div className="view-list">
        {views.map((view) => (
          <div className="saved-view-row" key={view.id}>
            <span className="view-icon">▤</span>
            <div>
              <strong>{view.name}</strong>
              <span>
                {view.query.mode} · {view.query.order}
              </span>
            </div>
            <span className="more">•••</span>
          </div>
        ))}
        {views.length === 0 && (
          <EmptyState
            title="Saved Viewはまだありません"
            action="Issuesで条件を作る"
            onAction={() => undefined}
          />
        )}
      </div>
    </div>
  );
}

function SettingsView({
  preferences,
  run,
  runBusy,
  onRun,
  onResume,
  onTheme,
}: {
  preferences: BootstrapPayload["preferences"];
  run: PublicRunSummary | null;
  runBusy: boolean;
  onRun: () => void;
  onResume: () => void;
  onTheme: (theme: "light" | "dark" | "system") => void;
}) {
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
              value={preferences.theme}
              onChange={(event) => onTheme(event.target.value as "light" | "dark" | "system")}
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
  workflowStates,
  onClose,
}: {
  issueId: string;
  fallbackIssue?: Issue;
  knownIssues: Issue[];
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

  useEffect(() => {
    if (issue) setDescription(issue.description);
    if (issue) setTitleDraft(issue.title);
  }, [issue?.id, issue?.description, issue?.title]);

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
      queryClient.setQueryData<IssueDetailViewModel>(["issue-detail", issueId], (current) =>
        current ? { ...current, issue: result.issue } : current,
      );
      queryClient.setQueryData<BootstrapPayload>(["bootstrap"], (current) =>
        current
          ? {
              ...current,
              issues: current.issues.map((item) =>
                item.id === result.issue.id ? result.issue : item,
              ),
            }
          : current,
      );
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
      className="modal-backdrop"
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
            <input
              id="issue-detail-title"
              className="detail-title-input"
              aria-label="Issueタイトル"
              value={titleDraft}
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
                <span className={`priority-badge ${priorityTone[issue.priority]}`}>
                  {priorityLabel[issue.priority]}
                </span>
                <span className="status-pill active">Version {issue.version}</span>
                <span className="status-pill">
                  {workflowStates.find((state) => state.id === issue.statusId)?.name ?? "Status"}
                </span>
                <span className="detail-date">更新 {formatDate(issue.updatedAt)}</span>
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
          </div>
        )}
      </div>
    </div>
  );
}

function IssueComposer({
  title,
  setTitle,
  existingIssue,
  onClose,
  onSubmit,
  busy,
}: {
  title: string;
  setTitle: (value: string) => void;
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
