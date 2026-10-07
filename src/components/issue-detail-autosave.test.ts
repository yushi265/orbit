import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  IssueViewModel as Issue,
  ProjectViewModel as Project,
  WorkflowStateViewModel as WorkflowState,
} from "../shared/view-models";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useRouter: () => ({ navigate: navigateMock }) };
});

import { IssueDetailPanel } from "./OrbitApp";

const issue = {
  id: "issue-autosave",
  userId: "owner",
  number: 1,
  identifier: "TASK-1",
  title: "初期タイトル",
  description: "初期説明",
  statusId: "state-1",
  priority: "no_priority" as const,
  estimate: null,
  dueAt: null,
  projectId: null,
  cycleId: null,
  parentId: null,
  labelIds: [],
  position: 0,
  version: 1,
  archivedAt: null,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

const detail = {
  issue,
  parent: null,
  children: [],
  childProgress: { total: 0, completed: 0, canceled: 0, progressPercent: 0 },
  notes: [],
  relations: [],
  activity: [],
  cycleHistory: [],
  carryoverCount: 0,
};

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message, fieldErrors } }),
  };
}

function renderPanel() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/issues/issue-autosave",
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value: function (this: HTMLElement, eventName: string, handler: EventListener) {
      this.addEventListener(eventName.replace(/^on/, ""), handler);
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value: function (this: HTMLElement, eventName: string, handler: EventListener) {
      this.removeEventListener(eventName.replace(/^on/, ""), handler);
    },
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  return { dom, root, queryClient, onClose };
}

function panelElement(
  onClose: () => void,
  pending = false,
  options: {
    onArchive?: () => Promise<void>;
    onUpdate?: (issue: Issue, patch: Partial<Issue>) => void;
    projects?: Project[];
    workflowStates?: WorkflowState[];
  } = {},
) {
  return createElement(IssueDetailPanel, {
    issueId: issue.id,
    fallbackIssue: issue,
    knownIssues: [issue],
    projects: options.projects ?? [],
    onUpdate: options.onUpdate ?? (() => undefined),
    pending,
    workflowStates: options.workflowStates ?? [],
    onArchive: options.onArchive ?? (async () => undefined),
    onClose,
  });
}

function setTextareaValue(dom: JSDOM, textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(
    Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
      propertyName: "value",
    }),
  );
}

async function waitForState(assertion: () => void) {
  await act(async () => {
    await vi.waitFor(assertion, { interval: 1, timeout: 1000 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  navigateMock.mockReset();
});

describe("Issue detail autosave", () => {
  it("[状態遷移] タイトルを編集してフォーカスを外すと自動保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = { ...issue, title: "更新タイトル", version: 2, updatedAt: 2 };
    const updatedDetail = { ...detail, issue: updatedIssue };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse(updatedDetail));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    queryClient.setQueryData(["bootstrap"], { issues: [issue] });

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      outside.focus();
    });

    await waitForState(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([path, init]) =>
            String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
        ),
      ).toHaveLength(1);
    });
    const patchCalls = fetchMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toMatchObject({
      version: 1,
      patch: {
        title: "更新タイトル",
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "初期説明" }] }],
        },
      },
    });
    expect(title.value).toBe("更新タイトル");
    expect(dom.window.document.querySelector(".detail-save-status")?.textContent).toContain(
      "自動保存済み",
    );
    expect(
      dom.window.document.querySelector(".detail-save-status")?.getAttribute("aria-live"),
    ).toBe("polite");
    expect(
      queryClient.getQueryData<{ issues: (typeof issue)[] }>(["bootstrap"])?.issues[0],
    ).toMatchObject({
      title: "更新タイトル",
      description: "初期説明",
      version: 2,
      updatedAt: 2,
    });
    expect(
      queryClient.getQueryData<typeof detail>(["issue-detail", issue.id])?.issue,
    ).toMatchObject({
      title: "更新タイトル",
      version: 2,
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] タイトルとDescription間の移動では重複保存せず、外側で1回保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = {
      ...issue,
      title: "更新タイトル",
      description: "更新説明",
      version: 2,
      updatedAt: 2,
    };
    const updatedDetail = { ...detail, issue: updatedIssue };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse(updatedDetail));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      description.focus();
      setTextareaValue(dom, description, "更新説明");
      outside.focus();
    });

    await waitForState(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([path, init]) =>
            String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
        ),
      ).toHaveLength(1);
    });
    const patchCalls = fetchMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toMatchObject({
      version: 1,
      patch: {
        title: "更新タイトル",
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "更新説明" }] }],
        },
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] Descriptionからタイトルへ移動して外側で自動保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = {
      ...issue,
      title: "更新タイトル",
      description: "更新説明",
      version: 2,
      updatedAt: 2,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    await act(async () => {
      description.focus();
      setTextareaValue(dom, description, "更新説明");
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      outside.focus();
    });

    await waitForState(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([path, init]) =>
            String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
        ),
      ).toHaveLength(1);
    });
    const patchCalls = fetchMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toMatchObject({
      version: 1,
      patch: {
        title: "更新タイトル",
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "更新説明" }] }],
        },
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[代表値] 変更がないblurでは保存せず、説明とProjectの手動保存ボタンを表示しない", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(detail));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      title.focus();
      description.focus();
      outside.focus();
    });

    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      [...dom.window.document.querySelectorAll("button")].map((button) => button.textContent),
    ).not.toContain("説明を保存");
    expect(dom.window.document.body.textContent).not.toContain("Projectを保存");
    expect(dom.window.document.body.textContent).toContain("メモを追加");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] Archiveは自動保存完了後に実行する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const onArchive = vi.fn().mockResolvedValue(undefined);
    const updatedIssue = { ...issue, title: "Archive前に保存", version: 2, updatedAt: 2 };
    let resolvePatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const patchResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => patchResponse)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          panelElement(onClose, false, { onArchive }),
        ),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const archive = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "アーカイブ",
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "Archive前に保存");
      archive.click();
    });

    expect(onArchive).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    resolvePatch(jsonResponse({ issue: updatedIssue }));
    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onArchive).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] Trashは自動保存完了後に実行する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = { ...issue, title: "Trash前に保存", version: 2, updatedAt: 2 };
    let resolvePatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const patchResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => patchResponse)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(dom.window, "confirm", {
      configurable: true,
      value: vi.fn(() => true),
    });

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const trash = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "ゴミ箱へ",
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "Trash前に保存");
      trash.click();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          String(path).includes(`/api/v1/issues/${issue.id}?action=trash`) &&
          init?.method === "POST",
      ),
    ).toBe(false);
    resolvePatch(jsonResponse({ issue: updatedIssue }));
    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          String(path).includes(`/api/v1/issues/${issue.id}?action=trash`) &&
          init?.method === "POST",
      ),
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("[代表値] ゴミ箱へ移すと bootstrap と detail キャッシュから消え、一覧キャッシュを invalidate する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const other = { ...issue, id: "issue-other" };
    queryClient.setQueryData(["bootstrap"], { issues: [issue, other] });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    // 詳細パネルは描画されたままなので detail のクエリは再生成される。削除したことは removeQueries で確認する。
    const remove = vi.spyOn(queryClient, "removeQueries");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(dom.window, "confirm", {
      configurable: true,
      value: vi.fn(() => true),
    });
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () =>
      (
        [...dom.window.document.querySelectorAll("button")].find(
          (button) => button.textContent === "ゴミ箱へ",
        ) as HTMLButtonElement
      ).click(),
    );
    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());
    expect(
      queryClient.getQueryData<{ issues: Issue[] }>(["bootstrap"])?.issues.map((item) => item.id),
    ).toEqual(["issue-other"]);
    expect(remove).toHaveBeenCalledWith({ queryKey: ["issue-detail", issue.id] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["issues"] });
    await act(async () => root.unmount());
  });

  it("[状態遷移] Project保存はDescriptionの自動保存完了後に実行する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const project: Project = {
      id: "project-autosave",
      userId: "owner",
      name: "自動保存Project",
      statusId: "state-1",
      priority: "no_priority",
      color: "#ff725e",
      icon: "◈",
      description: "",
      startAt: null,
      targetAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
      position: 0,
    };
    const descriptionUpdatedIssue = {
      ...issue,
      title: "更新タイトル",
      version: 2,
      updatedAt: 2,
    };
    const projectUpdatedIssue = {
      ...descriptionUpdatedIssue,
      projectId: project.id,
      version: 3,
      updatedAt: 3,
    };
    let resolveDescriptionPatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const descriptionPatchResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveDescriptionPatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => descriptionPatchResponse)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: descriptionUpdatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ issue: projectUpdatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: projectUpdatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          panelElement(onClose, false, { projects: [project] }),
        ),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const projectSelect = dom.window.document.querySelector("#issue-project") as HTMLSelectElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      projectSelect.value = project.id;
      projectSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });

    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    resolveDescriptionPatch(jsonResponse({ issue: descriptionUpdatedIssue }));
    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2),
    );
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toMatchObject({
      version: 2,
      patch: { projectId: project.id },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] Issue切替はDescriptionの自動保存完了後に実行する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const parent = {
      id: "parent-autosave",
      identifier: "TASK-0",
      title: "親Issue",
      statusId: "state-1",
    };
    const detailWithParent = { ...detail, parent, children: [] };
    const updatedIssue = { ...issue, title: "切替前に保存", version: 2, updatedAt: 2 };
    let resolvePatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const patchResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detailWithParent))
      .mockImplementationOnce(() => patchResponse)
      .mockResolvedValueOnce(jsonResponse({ ...detailWithParent, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    await waitForState(() => {
      expect(
        [...dom.window.document.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("親Issue"),
        ),
      ).toBeDefined();
    });
    const parentButton = [...dom.window.document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("親Issue"),
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "切替前に保存");
      parentButton.click();
    });

    expect(navigateMock).not.toHaveBeenCalled();
    resolvePatch(jsonResponse({ issue: updatedIssue }));
    await waitForState(() => expect(navigateMock).toHaveBeenCalledOnce());
    expect(navigateMock).toHaveBeenCalledWith({ to: "/issues/parent-autosave" });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 保存中の追加入力を最新versionで続けて保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const firstUpdatedIssue = { ...issue, title: "先行タイトル", version: 2, updatedAt: 2 };
    const secondUpdatedIssue = {
      ...firstUpdatedIssue,
      description: "後続説明",
      version: 3,
      updatedAt: 3,
    };
    let resolveFirstPatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const firstPatch = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveFirstPatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => firstPatch)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: firstUpdatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ issue: secondUpdatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: secondUpdatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "先行タイトル");
      outside.focus();
    });
    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    await act(async () => {
      description.focus();
      setTextareaValue(dom, description, "後続説明");
      outside.focus();
    });

    expect(
      fetchMock.mock.calls.filter(
        ([path, init]) =>
          String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
      ),
    ).toHaveLength(1);

    resolveFirstPatch(jsonResponse({ issue: firstUpdatedIssue }));
    await waitForState(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
    });

    const patchCalls = fetchMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(2);
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toMatchObject({
      version: 2,
      patch: {
        title: "先行タイトル",
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "後続説明" }] }],
        },
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 保存中にblurせず追加したdraftも続けて保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const firstUpdatedIssue = { ...issue, title: "先行タイトル", version: 2, updatedAt: 2 };
    const secondUpdatedIssue = {
      ...firstUpdatedIssue,
      description: "後続説明",
      version: 3,
      updatedAt: 3,
    };
    let resolveFirstPatch!: (response: ReturnType<typeof jsonResponse>) => void;
    let resolveSecondPatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const firstPatch = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveFirstPatch = resolve;
    });
    const secondPatch = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveSecondPatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => firstPatch)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: firstUpdatedIssue }))
      .mockImplementationOnce(() => secondPatch)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: secondUpdatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "先行タイトル");
      outside.focus();
    });
    await waitForState(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    });
    await act(async () => {
      description.focus();
      setTextareaValue(dom, description, "後続説明");
      await Promise.resolve();
    });
    await waitForState(() =>
      expect(dom.window.document.querySelector(".detail-save-status")?.textContent).toContain(
        "自動保存中…",
      ),
    );

    resolveFirstPatch(jsonResponse({ issue: firstUpdatedIssue }));
    await waitForState(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
    });
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toMatchObject({
      version: 2,
      patch: {
        title: "先行タイトル",
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "後続説明" }] }],
        },
      },
    });
    resolveSecondPatch(jsonResponse({ issue: secondUpdatedIssue }));
    await waitForState(() => expect(fetchMock.mock.calls.length).toBe(5));

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 保存中の追加draftを保存し終えてから閉じる", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const firstUpdatedIssue = { ...issue, title: "先行タイトル", version: 2, updatedAt: 2 };
    const secondUpdatedIssue = {
      ...firstUpdatedIssue,
      description: "後続説明",
      version: 3,
      updatedAt: 3,
    };
    let resolveFirstPatch!: (response: ReturnType<typeof jsonResponse>) => void;
    let resolveSecondPatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const firstPatch = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveFirstPatch = resolve;
    });
    const secondPatch = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveSecondPatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => firstPatch)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: firstUpdatedIssue }))
      .mockImplementationOnce(() => secondPatch)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: secondUpdatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    const close = dom.window.document.querySelector(
      '[aria-label="Issue詳細を閉じる"]',
    ) as HTMLButtonElement;

    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "先行タイトル");
      outside.focus();
    });
    await waitForState(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    });
    await act(async () => {
      description.focus();
      setTextareaValue(dom, description, "後続説明");
      close.click();
    });
    expect(onClose).not.toHaveBeenCalled();

    resolveFirstPatch(jsonResponse({ issue: firstUpdatedIssue }));
    await waitForState(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
    });
    expect(onClose).not.toHaveBeenCalled();

    resolveSecondPatch(jsonResponse({ issue: secondUpdatedIssue }));
    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(2);
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toMatchObject({
      version: 2,
      patch: {
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "後続説明" }] }],
        },
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 保存中にdraftを元の値へ戻した場合も後続保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const firstUpdatedIssue = { ...issue, title: "先行タイトル", version: 2, updatedAt: 2 };
    const secondUpdatedIssue = { ...issue, version: 3, updatedAt: 3 };
    let resolveFirstPatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const firstPatch = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveFirstPatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => firstPatch)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: firstUpdatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ issue: secondUpdatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: secondUpdatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "先行タイトル");
      outside.focus();
    });
    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "初期タイトル");
      outside.focus();
    });

    resolveFirstPatch(jsonResponse({ issue: firstUpdatedIssue }));
    await waitForState(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
    });

    const patchCalls = fetchMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(2);
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toMatchObject({
      version: 2,
      patch: { title: "初期タイトル" },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 別属性更新後は最新versionで自動保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const latestIssue = { ...issue, statusId: "state-2", version: 2, updatedAt: 2 };
    const updatedIssue = { ...latestIssue, title: "更新タイトル", version: 3, updatedAt: 3 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      queryClient.setQueryData(["issue-detail", issue.id], { ...detail, issue: latestIssue });
      await Promise.resolve();
    });

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      outside.focus();
    });

    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    const patchCall = fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({ version: 2 });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 親のIssue更新中は自動保存を待機し、完了後に保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const parentUpdatedIssue = {
      ...issue,
      statusId: "state-2",
      version: 2,
      updatedAt: 2,
    };
    const autosavedIssue = {
      ...parentUpdatedIssue,
      title: "更新タイトル",
      version: 3,
      updatedAt: 3,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: autosavedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: autosavedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    let completeParentMutation!: () => void;
    const workflowStates = [
      {
        id: "state-1",
        userId: "owner",
        name: "Todo",
        category: "unstarted" as const,
        color: "#888888",
        position: 0,
        isDefault: true,
      },
      {
        id: "state-2",
        userId: "owner",
        name: "Done",
        category: "completed" as const,
        color: "#44aa66",
        position: 1,
        isDefault: false,
      },
    ] satisfies WorkflowState[];
    const onUpdate = vi.fn((currentIssue: Issue, patch: Partial<Issue>) => {
      expect(currentIssue.version).toBe(1);
      expect(patch).toMatchObject({ statusId: "state-2" });
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          panelElement(onClose, true, { onUpdate, workflowStates }),
        ),
      );
      completeParentMutation = () => {
        queryClient.setQueryData(["issue-detail", issue.id], {
          ...detail,
          issue: parentUpdatedIssue,
        });
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            panelElement(onClose, false, { onUpdate, workflowStates }),
          ),
        );
      };
    });

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          panelElement(onClose, false, { onUpdate, workflowStates }),
        ),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const status = dom.window.document.querySelector(
      '[aria-label="IssueのStatus"]',
    ) as HTMLSelectElement;
    await act(async () => {
      status.value = "state-2";
      status.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await waitForState(() => expect(onUpdate).toHaveBeenCalledOnce());

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      outside.focus();
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);

    await act(async () => {
      completeParentMutation();
    });

    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toMatchObject({
      version: 2,
      patch: { title: "更新タイトル" },
    });
    await waitForState(() => expect(dom.window.document.body.textContent).toContain("Version 3"));

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] blurと親mutationが続く場合は親mutationを優先してから保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = { ...issue, title: "更新タイトル", version: 2, updatedAt: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose, false)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      outside.focus();
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose, true)),
      );
    });
    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0),
    );

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose, false)),
      );
    });
    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 親mutation待機中に閉じた場合は自動保存完了後に閉じる", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = { ...issue, title: "更新タイトル", version: 2, updatedAt: 2 };
    let resolvePatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const patchResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => patchResponse)
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose, true)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const close = dom.window.document.querySelector(
      '[aria-label="Issue詳細を閉じる"]',
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "更新タイトル");
      close.click();
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose, false)),
      );
    });
    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    expect(onClose).not.toHaveBeenCalled();
    resolvePatch(jsonResponse({ issue: updatedIssue }));
    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 別mutation中に閉じた場合も自動保存完了後に閉じる", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const note = {
      id: "note-autosave",
      userId: "owner",
      issueId: issue.id,
      body: "既存メモ",
      createdAt: 1,
      editedAt: null,
      deletedAt: null,
    };
    const detailWithNote = { ...detail, notes: [note] };
    const updatedIssue = { ...issue, title: "別mutation後", version: 2, updatedAt: 2 };
    let resolveNote!: (response: ReturnType<typeof jsonResponse>) => void;
    let resolvePatch!: (response: ReturnType<typeof jsonResponse>) => void;
    const noteResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveNote = resolve;
    });
    const patchResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detailWithNote))
      .mockImplementationOnce(() => noteResponse)
      .mockResolvedValueOnce(jsonResponse(detailWithNote))
      .mockImplementationOnce(() => patchResponse)
      .mockResolvedValueOnce(jsonResponse({ ...detailWithNote, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const noteBody = dom.window.document.querySelector(
      '[aria-label="新しい作業メモ"]',
    ) as HTMLTextAreaElement;
    const addNote = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "メモを追加",
    ) as HTMLButtonElement;
    await act(async () => {
      noteBody.focus();
      setTextareaValue(dom, noteBody, "追加メモ");
      noteBody.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await waitForState(() => expect(addNote.disabled).toBe(false));
    await act(async () => {
      addNote.click();
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const close = dom.window.document.querySelector(
      '[aria-label="Issue詳細を閉じる"]',
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "別mutation後");
      close.click();
    });
    expect(onClose).not.toHaveBeenCalled();

    resolveNote(jsonResponse({ note }));
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    resolvePatch(jsonResponse({ issue: updatedIssue }));
    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移/失敗系] 自動保存失敗時は値を戻し、再試行でdraftを保存する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = { ...issue, description: "再試行後の説明", version: 2, updatedAt: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR", "一時的な障害です。"))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      description.focus();
      setTextareaValue(dom, description, "再試行後の説明");
      outside.focus();
    });

    await waitForState(() => expect(description.value).toBe("初期説明"));
    expect(dom.window.document.body.textContent).toContain("一時的な障害です。");
    const retry = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "説明を再試行",
    );
    expect(retry).not.toBeUndefined();

    await act(async () => {
      retry?.click();
    });

    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2),
    );
    const patchCalls = fetchMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith(`/api/v1/issues/${issue.id}`) && init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(2);
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toMatchObject({
      version: 1,
      patch: {
        descriptionJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "再試行後の説明" }] }],
        },
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移/失敗系] 編集中に閉じる操作をして保存に失敗した場合は再試行を表示する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR", "保存できませんでした。"));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const close = dom.window.document.querySelector(
      '[aria-label="Issue詳細を閉じる"]',
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "保存対象");
      close.click();
    });

    await waitForState(() =>
      expect(dom.window.document.body.textContent).toContain("保存できませんでした。"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(dom.window.document.body.textContent).toContain("保存できませんでした。");
    expect(dom.window.document.body.textContent).toContain("説明を再試行");

    await act(async () => {
      close.click();
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移/失敗系] Escapeで閉じる場合も保存失敗時はパネルを維持する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR", "Escape保存失敗です。"));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "Escape保存対象");
      title.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    await waitForState(() =>
      expect(dom.window.document.body.textContent).toContain("Escape保存失敗です。"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector("#issue-detail-title")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] Escapeで閉じる場合は自動保存完了後に閉じる", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = { ...issue, title: "Escape後に保存", version: 2, updatedAt: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "Escape後に保存");
      title.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移] 編集中に閉じる操作をして保存に成功した場合は閉じる", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const updatedIssue = { ...issue, title: "保存済みタイトル", version: 2, updatedAt: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ issue: updatedIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: updatedIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const close = dom.window.document.querySelector(
      '[aria-label="Issue詳細を閉じる"]',
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "保存済みタイトル");
      close.click();
    });

    await waitForState(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("[境界値/失敗系] 400バリデーション時は入力値とfield errorを保持する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(
        errorResponse(400, "VALIDATION_ERROR", "入力を確認してください。", {
          title: ["タイトルは必須です。"],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "");
      outside.focus();
    });

    await waitForState(() => expect(title.value).toBe(""));
    expect(dom.window.document.body.textContent).toContain("タイトルは必須です。");
    expect(dom.window.document.body.textContent).not.toContain("説明を再試行");

    await act(async () => {
      root.unmount();
    });
  });

  it("[状態遷移/失敗系] Runtime lock中は自動保存をrollbackして再試行を表示する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    let resolveSave!: (response: ReturnType<typeof errorResponse>) => void;
    const saveResponse = new Promise<ReturnType<typeof errorResponse>>((resolve) => {
      resolveSave = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(() => saveResponse);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await vi.waitFor(
      async () => {
        await act(async () => {
          // Allow Query's scheduled notification to commit before editing the fallback.
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryState(["issue-detail", issue.id])?.status).toBe("success");
        expect(dom.window.document.querySelector(".detail-skeleton")).toBeNull();
      },
      { interval: 1, timeout: 1000 },
    );

    const description = dom.window.document.querySelector(
      "#issue-description",
    ) as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);
    await act(async () => {
      description.focus();
      setTextareaValue(dom, description, "ロック中の変更");
      outside.focus();
    });

    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(description.value).toBe("ロック中の変更");
    await act(async () => {
      // Release HTTP completion inside act; waiting for the DOM inside one long
      // act would defer the rollback commit until that wait has already timed out.
      resolveSave(errorResponse(423, "OPERATION_IN_PROGRESS", "処理中です。"));
      await saveResponse;
    });
    expect(description.value).toBe("初期説明");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(dom.window.document.body.textContent).toContain("処理中です。");
    expect(dom.window.document.body.textContent).toContain("説明を再試行");

    await act(async () => {
      root.unmount();
    });
  });

  it("[競合/Cache同期] Autosave409の最新IssueをDetailと一覧Cacheへ反映する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const latestIssue = {
      ...issue,
      title: "別端末の最新タイトル",
      description: "別端末の説明",
      version: 2,
    };
    queryClient.setQueryData(["bootstrap"], { issues: [issue] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(errorResponse(409, "ISSUE_VERSION_CONFLICT", "競合しました。"))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: latestIssue }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const close = dom.window.document.querySelector(
      '[aria-label="Issue詳細を閉じる"]',
    ) as HTMLButtonElement;
    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "自分のdraft");
      close.click();
    });
    await waitForState(() => {
      expect(queryClient.getQueryData<{ issues: Issue[] }>(["bootstrap"])?.issues[0]).toEqual(
        latestIssue,
      );
    });
    expect(queryClient.getQueryData<typeof detail>(["issue-detail", issue.id])?.issue).toEqual(
      latestIssue,
    );
    expect(title.value).toBe(latestIssue.title);
    for (const scope of ["active", "archived", "trash"] as const) {
      expect(queryClient.getQueryState(["issues", scope])).toBeUndefined();
    }
    expect(dom.window.document.body.textContent).toContain("説明を再試行");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it.each(["active", "archived", "trash"] as const)(
    "[409/Scope所属] 最新Issue=%sへ同期し他rowとCache metadataを保持する",
    async (scope) => {
      const { dom, root, queryClient, onClose } = renderPanel();
      queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 15_000 } });
      const latest = {
        ...issue,
        title: "最新ライフサイクル",
        version: 2,
        archivedAt: scope === "active" ? null : 100,
        deletedAt: scope === "trash" ? 200 : null,
      };
      const activeOther = { ...issue, id: "other-active", title: "他のActive" };
      const archivedOther = {
        ...issue,
        id: "other-archived",
        title: "他のArchived",
        archivedAt: 100,
      };
      const trashOther = { ...issue, id: "other-trash", title: "他のTrash", deletedAt: 200 };
      const original = scope === "active" ? { ...issue, archivedAt: 100 } : issue;
      const initialActive = scope === "active" ? [activeOther] : [issue, activeOther];
      queryClient.setQueryData(["bootstrap"], { issues: initialActive });
      queryClient.setQueryData(["issues", "active"], {
        items: initialActive,
        marker: "active",
      });
      queryClient.setQueryData(["issues", "archived"], {
        items: scope === "active" ? [archivedOther, original] : [archivedOther],
        marker: "archived",
      });
      queryClient.setQueryData(["issues", "trash"], { items: [trashOther], marker: "trash" });
      const fetchMock = vi.fn(async (path: string, init: RequestInit = {}) => {
        if (path !== `/api/v1/issues/${issue.id}`) throw new Error("Unexpected Issue URL");
        if (init.method === "PATCH")
          return errorResponse(409, "ISSUE_VERSION_CONFLICT", "競合しました。");
        if (init.method === undefined || init.method === "GET")
          return jsonResponse({ ...detail, issue: latest });
        throw new Error(`Unexpected method: ${init.method}`);
      });
      queryClient.setQueryData(["issue-detail", issue.id], { ...detail, issue: original });
      vi.stubGlobal("fetch", fetchMock);
      await act(async () =>
        root.render(
          createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
        ),
      );
      const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
      await act(async () => {
        title.focus();
        setTextareaValue(dom, title, "自分のdraft");
        (
          dom.window.document.querySelector('[aria-label="Issue詳細を閉じる"]') as HTMLButtonElement
        ).click();
      });
      await waitForState(() =>
        expect(
          queryClient.getQueryData<typeof detail>(["issue-detail", issue.id])?.issue.title,
        ).toBe(latest.title),
      );
      expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
        "PATCH",
        "GET",
      ]);
      expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).version).toBe(1);
      expect(queryClient.getQueryData<{ issues: Issue[] }>(["bootstrap"])?.issues).toEqual(
        scope === "active" ? [activeOther, latest] : [activeOther],
      );
      expect(queryClient.getQueryData(["issues", "active"])).toEqual({
        items: scope === "active" ? [activeOther, latest] : [activeOther],
        marker: "active",
      });
      expect(queryClient.getQueryData(["issues", "archived"])).toEqual({
        items: scope === "archived" ? [archivedOther, latest] : [archivedOther],
        marker: "archived",
      });
      expect(queryClient.getQueryData(["issues", "trash"])).toEqual({
        items: scope === "trash" ? [trashOther, latest] : [trashOther],
        marker: "trash",
      });
      await act(async () => root.unmount());
    },
  );

  it("[状態遷移/失敗系] version競合時は最新値を再取得して再試行を残す", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const latestIssue = { ...issue, title: "他の場所のタイトル", version: 2, updatedAt: 2 };
    const retryIssue = { ...latestIssue, title: "自分のタイトル", version: 3, updatedAt: 3 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(errorResponse(409, "ISSUE_VERSION_CONFLICT", "競合しました。"))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: latestIssue }))
      .mockResolvedValueOnce(jsonResponse({ issue: retryIssue }))
      .mockResolvedValueOnce(jsonResponse({ ...detail, issue: retryIssue }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await waitForState(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.append(outside);

    await act(async () => {
      title.focus();
      setTextareaValue(dom, title, "自分のタイトル");
      outside.focus();
    });

    await waitForState(() => expect(title.value).toBe("他の場所のタイトル"));
    expect(dom.window.document.body.textContent).toContain("競合しました。");
    expect(dom.window.document.body.textContent).toContain("説明を再試行");

    const retry = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "説明を再試行",
    );
    await act(async () => {
      retry?.click();
    });
    await waitForState(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2),
    );
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toMatchObject({
      version: 2,
      patch: { title: "自分のタイトル" },
    });
    await waitForState(() => expect(title.value).toBe("自分のタイトル"));

    await act(async () => {
      root.unmount();
    });
  });
});
