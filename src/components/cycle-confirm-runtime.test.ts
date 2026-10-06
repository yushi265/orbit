import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BootstrapViewModel,
  CycleViewModel,
  IssueViewModel,
  WorkflowStateViewModel,
} from "../shared/view-models";
import { CyclesView, OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { normalizeIssueSearch } from "../lib/url-state/issues";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

let dom: JSDOM;
let root: Root;
const doc = () => dom.window.document;

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.addEventListener(name.replace(/^on/, ""), handler);
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.removeEventListener(name.replace(/^on/, ""), handler);
    },
  });
  root = createRoot(doc().getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const states: WorkflowStateViewModel[] = [
  {
    id: "todo",
    userId: "owner",
    name: "Todo",
    category: "unstarted",
    color: "#888",
    position: 0,
    isDefault: true,
  },
  {
    id: "doing",
    userId: "owner",
    name: "Doing",
    category: "started",
    color: "#888",
    position: 1,
    isDefault: false,
  },
  {
    id: "done",
    userId: "owner",
    name: "Done",
    category: "completed",
    color: "#888",
    position: 2,
    isDefault: false,
  },
  {
    id: "canceled",
    userId: "owner",
    name: "Canceled",
    category: "canceled",
    color: "#888",
    position: 3,
    isDefault: false,
  },
];
function cycle(overrides: Partial<CycleViewModel>): CycleViewModel {
  return {
    id: "cycle-1",
    userId: "owner",
    number: 1,
    name: "Cycle 1",
    nameOverride: null,
    description: "",
    startsAt: Date.UTC(2026, 9, 1),
    endsAt: Date.UTC(2026, 9, 14),
    status: "active",
    completedAt: null,
    scheduleOverridden: false,
    ...overrides,
  };
}
const activeCycle = cycle({});
const upcomingCycle = cycle({
  id: "cycle-2",
  number: 2,
  name: "Cycle 2",
  startsAt: Date.UTC(2026, 9, 15),
  endsAt: Date.UTC(2026, 9, 28),
  status: "upcoming",
});
const completedCycle = cycle({
  id: "cycle-0",
  number: 0,
  name: "Cycle 0",
  startsAt: Date.UTC(2026, 8, 1),
  endsAt: Date.UTC(2026, 8, 14),
  status: "completed",
  completedAt: 1,
});
function cycleIssue(id: string, overrides: Partial<IssueViewModel> = {}): IssueViewModel {
  return reviewIssue(id, {
    cycleId: "cycle-1",
    projectId: null,
    labelIds: [],
    ...overrides,
  });
}
const buttonByText = (text: string) =>
  [...doc().querySelectorAll("button")].find((button) => button.textContent === text) as
    | HTMLButtonElement
    | undefined;
const dialog = () => doc().querySelector('[role="dialog"]') as HTMLElement | null;
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
async function pressEscape() {
  await act(async () =>
    doc().activeElement!.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
}

function renderCycles(
  props: Partial<Parameters<typeof CyclesView>[0]> & {
    cycles?: CycleViewModel[];
  } = {},
) {
  const handlers = {
    onClose: vi.fn(),
    onStart: vi.fn(async () => true),
    onOpenIssue: vi.fn(),
    onUpdateIssue: vi.fn(),
  };
  const element = createElement(CyclesView, {
    cycles: [activeCycle, upcomingCycle],
    cycleHistory: [],
    issues: [],
    workflowStates: states,
    pendingIssueId: null,
    onRefresh: () => undefined,
    onNavigateIssues: () => undefined,
    onNavigateCycles: () => undefined,
    closeBusy: false,
    startBusy: false,
    ...handlers,
    ...props,
  } as Parameters<typeof CyclesView>[0]);
  return { handlers, element };
}

describe("AC-2 Cycle confirm dialogs", () => {
  const issues = [
    cycleIssue("a", { statusId: "todo" }),
    cycleIssue("b", { statusId: "doing" }),
    cycleIssue("c", { statusId: "done" }),
    cycleIssue("d", { statusId: "canceled" }),
    cycleIssue("deleted", { statusId: "todo", deletedAt: 5 }),
  ];

  it("[デシジョンテーブル] Cycleを完了 は未完了件数つきの確認を出し、確定で onClose を 1 回呼ぶ", async () => {
    const { handlers, element } = renderCycles({ issues });
    await act(async () => root.render(element));
    await act(async () => buttonByText("Cycleを完了")!.click());
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain("未完了のIssue 2件を次のCycleへ繰り越します。");
    expect(doc().activeElement!.textContent).toBe("キャンセル");
    await act(async () =>
      [...dialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "Cycleを完了")!
        .click(),
    );
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledWith(activeCycle);
    await settle();
    expect(dialog()).toBeNull();
  });

  it("[境界値] 未完了 0 件は「0件」と表示し、完了できる", async () => {
    const { handlers, element } = renderCycles({
      issues: [cycleIssue("c", { statusId: "done" })],
    });
    await act(async () => root.render(element));
    await act(async () => buttonByText("Cycleを完了")!.click());
    expect(dialog()!.textContent).toContain("未完了のIssue 0件");
    await act(async () =>
      [...dialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "Cycleを完了")!
        .click(),
    );
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("[デシジョンテーブル] Upcoming の Cycleを開始 は期間つきの確認を出し、確定で onStart を 1 回呼ぶ", async () => {
    const { handlers, element } = renderCycles();
    await act(async () => root.render(element));
    await act(async () => buttonByText("Upcoming1")!.click());
    await act(async () => buttonByText("Cycleを開始")!.click());
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toMatch(/Cycle 2（.+ — .+）を開始します。/);
    await act(async () =>
      [...dialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "Cycleを開始")!
        .click(),
    );
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onStart).toHaveBeenCalledWith(upcomingCycle);
  });

  it("[デシジョンテーブル] 次のCycleを開始 は次 Cycle の期間つきの確認を出し、確定で onStart を 1 回呼ぶ", async () => {
    const { handlers, element } = renderCycles();
    await act(async () => root.render(element));
    await act(async () => buttonByText("次のCycleを開始")!.click());
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toMatch(/Cycle 2（.+ — .+）を開始します。/);
    await act(async () =>
      [...dialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "Cycleを開始")!
        .click(),
    );
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onStart).toHaveBeenCalledWith(upcomingCycle);
  });

  it.each([
    ["Cycleを完了", "onClose"],
    ["次のCycleを開始", "onStart"],
  ] as const)(
    "[デシジョンテーブル] %s のキャンセルと Esc は API を呼ばない",
    async (label, handler) => {
      const { handlers, element } = renderCycles({ issues });
      await act(async () => root.render(element));
      await act(async () => buttonByText(label)!.click());
      await act(async () => buttonByText("キャンセル")!.click());
      expect(dialog()).toBeNull();
      await act(async () => buttonByText(label)!.click());
      expect(dialog()).not.toBeNull();
      await pressEscape();
      expect(dialog()).toBeNull();
      expect(handlers[handler]).not.toHaveBeenCalled();
    },
  );

  it("[デシジョンテーブル] Upcoming の Cycleを開始 のキャンセルと Esc は API を呼ばない", async () => {
    const { handlers, element } = renderCycles();
    await act(async () => root.render(element));
    await act(async () => buttonByText("Upcoming1")!.click());
    await act(async () => buttonByText("Cycleを開始")!.click());
    await act(async () => buttonByText("キャンセル")!.click());
    expect(dialog()).toBeNull();
    await act(async () => buttonByText("Cycleを開始")!.click());
    expect(dialog()).not.toBeNull();
    await pressEscape();
    expect(dialog()).toBeNull();
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it("[状態遷移] 確定中は確定ボタンが disabled で二重送信せず、完了後にダイアログを閉じる", async () => {
    let resolveStart: (value: boolean) => void = () => undefined;
    const onStart = vi.fn(() => new Promise<boolean>((resolve) => (resolveStart = resolve)));
    const { element } = renderCycles({ onStart });
    await act(async () => root.render(element));
    await act(async () => buttonByText("次のCycleを開始")!.click());
    const confirm = () =>
      [...dialog()!.querySelectorAll("button")].find(
        (button) => button.textContent === "Cycleを開始",
      )!;
    await act(async () => confirm().click());
    expect(confirm().disabled).toBe(true);
    await act(async () => confirm().click());
    expect(onStart).toHaveBeenCalledTimes(1);
    await act(async () => resolveStart(false));
    expect(dialog()).toBeNull();
  });
});

describe("AC-5 open issue from Cycle screens", () => {
  const issues = [cycleIssue("a", { statusId: "todo", title: "List title" })];
  const history = [
    {
      id: "h1",
      issue: cycleIssue("carried", { title: "Carried title" }),
      fromCycle: completedCycle,
      toCycle: activeCycle,
      movedAt: 1,
    },
  ];

  it("[代表値] List のタイトルボタンで onOpenIssue が呼ばれ、Cycleから外す は詳細を開かず cycleId:null を更新する", async () => {
    const { handlers, element } = renderCycles({ issues });
    await act(async () => root.render(element));
    const title = [...doc().querySelectorAll(".cycle-issue-row button")].find(
      (button) => button.textContent === "List title",
    ) as HTMLButtonElement;
    expect(title).toBeDefined();
    await act(async () => title.click());
    expect(handlers.onOpenIssue).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenIssue.mock.calls[0][0].id).toBe("a");
    handlers.onOpenIssue.mockClear();
    await act(async () => buttonByText("Cycleから外す")!.click());
    expect(handlers.onOpenIssue).not.toHaveBeenCalled();
    expect(handlers.onUpdateIssue).toHaveBeenCalledWith(issues[0], {
      cycleId: null,
    });
  });

  it("[代表値] Board のカードのタイトルボタンで onOpenIssue が呼ばれる", async () => {
    const { handlers, element } = renderCycles({ issues });
    await act(async () => root.render(element));
    await act(async () => buttonByText("▦ Board")!.click());
    const title = [...doc().querySelectorAll(".cycle-board-card button")].find(
      (button) => button.textContent === "List title",
    ) as HTMLButtonElement;
    expect(title).toBeDefined();
    await act(async () => title.click());
    expect(handlers.onOpenIssue).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenIssue.mock.calls[0][0].id).toBe("a");
  });

  it("[代表値] 繰越一覧の行のタイトルボタンで onOpenIssue が呼ばれる", async () => {
    const { handlers, element } = renderCycles({
      cycleHistory: history as never,
    });
    await act(async () => root.render(element));
    const title = [...doc().querySelectorAll(".cycle-carryover-row button")].find(
      (button) => button.textContent === "Carried title",
    ) as HTMLButtonElement;
    expect(title).toBeDefined();
    await act(async () => title.click());
    expect(handlers.onOpenIssue.mock.calls[0][0].id).toBe("carried");
  });

  it("[代表値] タイトルは type=button の button で、行自体は click で詳細を開かない", async () => {
    const { handlers, element } = renderCycles({ issues });
    await act(async () => root.render(element));
    const title = [...doc().querySelectorAll(".cycle-issue-row button")].find(
      (button) => button.textContent === "List title",
    ) as HTMLButtonElement;
    expect(title.type).toBe("button");
    await act(async () => (doc().querySelector(".cycle-issue-row") as HTMLElement).click());
    expect(handlers.onOpenIssue).not.toHaveBeenCalled();
  });
});

// ---- OrbitApp integration (bulk / composer / detail / wiring) ----

type Call = {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
};
let calls: Call[];
let payload: BootstrapViewModel;

function makeRouter(entry: string) {
  const base = createRootRoute({ component: Outlet });
  const issues = createRoute({
    getParentRoute: () => base,
    path: "/issues",
    validateSearch: normalizeIssueSearch,
    component: () =>
      createElement(OrbitApp, {
        initialSection: "issues",
        issueSearch: issues.useSearch(),
      }),
  });
  const detail = createRoute({
    getParentRoute: () => base,
    path: "/issues/$issueId",
    validateSearch: normalizeIssueSearch,
    component: () =>
      createElement(OrbitApp, {
        initialSection: "issues",
        issueId: detail.useParams().issueId,
        issueSearch: detail.useSearch(),
      }),
  });
  const cycles = createRoute({
    getParentRoute: () => base,
    path: "/cycles",
    component: () => createElement(OrbitApp, { initialSection: "cycles" }),
  });
  const home = createRoute({
    getParentRoute: () => base,
    path: "/",
    component: () => createElement(OrbitApp, { initialSection: "home" }),
  });
  return createRouter({
    routeTree: base.addChildren([home, issues, detail, cycles]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultPendingMinMs: 0,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function renderApp(entry: string, options: { failOn?: (call: Call) => boolean } = {}) {
  queryClient.clear();
  queryClient.setQueryData(["bootstrap"], payload);
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const call: Call = {
        method,
        path,
        body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      calls.push(call);
      if (options.failOn?.(call))
        return json(
          {
            error: {
              code: "INTERNAL",
              message: "失敗しました",
              requestId: "r",
            },
          },
          500,
        );
      if (path === "/api/v1/bootstrap") return json(payload);
      if (path.startsWith("/api/v1/background-runs")) return json({ run: null });
      if (method === "GET" && path.startsWith("/api/v1/issues/")) {
        const id = path.split("/").pop()!.split("?")[0];
        const issue = payload.issues.find((item) => item.id === id) ?? payload.issues[0];
        return json(reviewDetail(issue));
      }
      if (method === "POST" && path === "/api/v1/issues")
        return json({ issue: reviewIssue("created") });
      if (method === "PATCH" && path.startsWith("/api/v1/issues/")) {
        const id = path.split("/").pop()!;
        const issue = payload.issues.find((item) => item.id === id) ?? payload.issues[0];
        return json({
          issue: { ...issue, ...(call.body?.patch as object), version: 2 },
        });
      }
      return json({});
    }),
  );
  const router = makeRouter(entry);
  await act(async () => {
    await router.load();
    root.render(createElement(RouterProvider, { router }));
  });
  await settle();
  return router;
}
const mutations = () => calls.filter((call) => call.method !== "GET");
function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLSelectElement.prototype,
    "value",
  )!.set!;
  setter.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
const selectByLabel = (label: string) =>
  doc().querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;

beforeEach(() => {
  payload = reviewBootstrap([
    reviewIssue("i1", { statusId: "todo", cycleId: null }),
    reviewIssue("i2", { statusId: "todo", cycleId: null }),
  ]);
  payload.cycles = [completedCycle, activeCycle, upcomingCycle];
  payload.labels = [
    { id: "label-1", userId: "owner", name: "Bug", color: "#888" },
    { id: "label-2", userId: "owner", name: "Feature", color: "#888" },
  ];
});

describe("AC-3 bulk Label confirm", () => {
  async function openBulk(field: string, value: string) {
    await renderApp("/issues");
    const selectAll = doc().querySelector('input[aria-label="全選択"]') as HTMLInputElement;
    await act(async () => selectAll.click());
    await act(async () => setSelect(selectByLabel("一括更新属性"), field));
    await act(async () => setSelect(selectByLabel("一括更新値"), value));
  }
  const apply = () => buttonByText("一括適用")!;
  const confirmButton = (label: string) =>
    [...dialog()!.querySelectorAll("button")].find((button) => button.textContent === label)!;

  it("[代表値] 一括更新の属性に「Label（置き換え）」の表記がある", async () => {
    await renderApp("/issues");
    await act(async () =>
      (doc().querySelector('input[aria-label="全選択"]') as HTMLInputElement).click(),
    );
    const options = [...selectByLabel("一括更新属性").options].map((option) => option.textContent);
    expect(options).toContain("Label（置き換え）");
    expect(options).not.toContain("Label");
  });

  it("[デシジョンテーブル] Label X は置き換えの確認に件数と X を出し、確定で labelIds:[X] の bulk API を呼ぶ", async () => {
    await openBulk("label", "label-2");
    await act(async () => apply().click());
    expect(mutations()).toHaveLength(0);
    expect(dialog()!.textContent).toContain(
      "選択中の2件のLabelを「Feature」に置き換えます。既存のLabelは外れます。",
    );
    expect(doc().activeElement!.textContent).toBe("キャンセル");
    await act(async () => confirmButton("置き換える").click());
    await settle();
    const bulk = mutations();
    expect(bulk).toHaveLength(1);
    expect(bulk[0].path).toBe("/api/v1/issues/bulk");
    expect(bulk[0].body).toMatchObject({
      issueIds: ["i1", "i2"],
      patch: { labelIds: ["label-2"] },
    });
    expect(dialog()).toBeNull();
  });

  it("[デシジョンテーブル] Labelなし は「すべてのLabelを外します」の確認で、確定で labelIds:[] を呼ぶ", async () => {
    await openBulk("label", "__none__");
    await act(async () => apply().click());
    expect(dialog()!.textContent).toContain("選択中の2件からすべてのLabelを外します。");
    await act(async () => confirmButton("外す").click());
    await settle();
    expect(mutations()[0].body).toMatchObject({ patch: { labelIds: [] } });
  });

  it("[デシジョンテーブル] キャンセルと Esc では bulk API を呼ばない", async () => {
    await openBulk("label", "label-1");
    await act(async () => apply().click());
    await act(async () => confirmButton("キャンセル").click());
    expect(dialog()).toBeNull();
    await act(async () => apply().click());
    await pressEscape();
    expect(dialog()).toBeNull();
    expect(mutations()).toHaveLength(0);
  });

  it("[デシジョンテーブル] Status など Label 以外は確認なしで bulk API を呼ぶ", async () => {
    await openBulk("status", "todo");
    await act(async () => apply().click());
    await settle();
    expect(dialog()).toBeNull();
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0].body).toMatchObject({ patch: { statusId: "todo" } });
  });
});

describe("AC-2 Cycle confirm in the app (failure toast)", () => {
  it("[異常系] 完了 API が失敗したらダイアログを閉じ、エラートーストを出す", async () => {
    await renderApp("/cycles", {
      failOn: (call) => call.method === "POST" && call.path === "/api/v1/cycles/cycle-1",
    });
    await act(async () => buttonByText("Cycleを完了")!.click());
    await act(async () =>
      [...dialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "Cycleを完了")!
        .click(),
    );
    await settle();
    expect(dialog()).toBeNull();
    expect(doc().querySelector('[role="alert"]')!.textContent).toContain("失敗しました");
  });

  it("[代表値] 確定で完了 API を 1 回だけ呼ぶ", async () => {
    await renderApp("/cycles");
    await act(async () => buttonByText("Cycleを完了")!.click());
    expect(mutations()).toHaveLength(0);
    await act(async () =>
      [...dialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "Cycleを完了")!
        .click(),
    );
    await settle();
    expect(mutations().filter((call) => call.path === "/api/v1/cycles/cycle-1")).toHaveLength(1);
  });
});

describe("AC-5 open issue wiring", () => {
  it("[代表値] タイトルボタンで Issue 詳細が開く（Enter 相当の click）", async () => {
    payload.issues = [
      reviewIssue("i1", {
        statusId: "todo",
        cycleId: "cycle-1",
        title: "Open me",
      }),
    ];
    await renderApp("/cycles");
    const title = [...doc().querySelectorAll(".cycle-issue-row button")].find(
      (button) => button.textContent === "Open me",
    ) as HTMLButtonElement;
    await act(async () => title.click());
    await settle();
    expect(doc().querySelector("#issue-detail-title")).not.toBeNull();
    expect(
      calls.some((call) => call.method === "GET" && call.path.includes("/api/v1/issues/i1")),
    ).toBe(true);
  });
});

describe("AC-6 Cycle select", () => {
  const composerCycle = () => selectByLabel("新しいIssueのCycle");
  const detailCycle = () => selectByLabel("IssueのCycle");
  async function openComposer() {
    await renderApp("/issues");
    await act(async () =>
      doc().body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "c", bubbles: true }),
      ),
    );
  }
  const optionTexts = (select: HTMLSelectElement) =>
    [...select.options].map((option) => option.textContent);
  async function submitWithTitle() {
    const title = doc().querySelector(
      'textarea[aria-label="新しいIssueのタイトル"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      title.focus();
      setter.call(title, "New");
      title.dispatchEvent(
        Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
          propertyName: "value",
        }),
      );
    });
    await act(async () =>
      (
        [...doc().querySelectorAll("#issue-composer-title ~ * button, .composer button")].find(
          (button) => button.textContent === "Issueを作成",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
  }

  it("[代表値] Composer の Cycle 欄の初期値は Active Cycle で、選択肢は なし / Current / Upcoming だけ", async () => {
    await openComposer();
    expect(composerCycle().value).toBe("cycle-1");
    expect(optionTexts(composerCycle())).toEqual([
      "なし",
      "Cycle 1（Current）",
      "Cycle 2（Upcoming）",
    ]);
  });

  it("[境界値] Active Cycle が無いと初期値は「なし」", async () => {
    payload.cycles = [completedCycle, upcomingCycle];
    await openComposer();
    expect(composerCycle().value).toBe("");
  });

  it("[代表値] 初期値のまま作成すると POST の cycleId は Active Cycle", async () => {
    await openComposer();
    await submitWithTitle();
    expect(mutations()[0].body).toMatchObject({ cycleId: "cycle-1" });
  });

  it("[代表値] Upcoming を選んで作成すると POST の cycleId がその Cycle", async () => {
    await openComposer();
    await act(async () => setSelect(composerCycle(), "cycle-2"));
    await submitWithTitle();
    expect(mutations()[0].body).toMatchObject({ cycleId: "cycle-2" });
  });

  it("[代表値] なし を選んで作成すると POST の cycleId は null", async () => {
    await openComposer();
    await act(async () => setSelect(composerCycle(), ""));
    await submitWithTitle();
    expect(mutations()[0].body).toMatchObject({ cycleId: null });
  });

  it("[代表値] 詳細で Cycle を変更すると PATCH に cycleId が入る", async () => {
    await renderApp("/issues/i1");
    await settle();
    expect(detailCycle().value).toBe("");
    await act(async () => setSelect(detailCycle(), "cycle-2"));
    await settle();
    const patch = mutations().find((call) => call.method === "PATCH")!;
    expect(patch.body).toMatchObject({ patch: { cycleId: "cycle-2" } });
  });

  it("[同値分割] 詳細の選択肢に Completed は出ない", async () => {
    await renderApp("/issues/i1");
    await settle();
    expect(optionTexts(detailCycle())).toEqual([
      "なし",
      "Cycle 1（Current）",
      "Cycle 2（Upcoming）",
    ]);
  });

  it("[同値分割] 現在値が Completed の Cycle のときはその 1 件だけ出る", async () => {
    payload.issues = [reviewIssue("i1", { statusId: "todo", cycleId: "cycle-0" })];
    await renderApp("/issues/i1");
    await settle();
    expect(detailCycle().value).toBe("cycle-0");
    expect(optionTexts(detailCycle())).toEqual([
      "なし",
      "Cycle 0（Completed）",
      "Cycle 1（Current）",
      "Cycle 2（Upcoming）",
    ]);
  });
});
