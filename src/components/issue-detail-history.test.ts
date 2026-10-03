import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

import { IssueDetailPanel } from "./OrbitApp";

const issue = {
  id: "issue-detail-history",
  userId: "owner",
  number: 1,
  identifier: "TASK-1",
  title: "繰越Issue",
  description: "",
  statusId: "state-1",
  priority: "no_priority" as const,
  estimate: null,
  dueAt: null,
  projectId: null,
  cycleId: "cycle-2",
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
  cycleHistory: [
    {
      id: "history-detail-ui",
      issue: { id: issue.id, identifier: issue.identifier, title: issue.title },
      fromCycle: { id: "cycle-1", number: 1, name: "Cycle 1" },
      toCycle: { id: "cycle-2", number: 2, name: "Cycle 2" },
      movedAt: 1_700_000_000_000,
    },
  ],
  carryoverCount: 1,
};

function renderPanel() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
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
  const root = createRoot(dom.window.document.getElementById("root")!);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  return { dom, root, queryClient, onClose };
}

function panelElement(onClose: () => void) {
  return createElement(IssueDetailPanel, {
    issueId: issue.id,
    fallbackIssue: issue,
    knownIssues: [issue],
    projects: [],
    onUpdate: () => undefined,
    pending: false,
    workflowStates: [],
    onArchive: async () => undefined,
    onClose,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Issue Detail cycle history integration", () => {
  it("[状態遷移] loading中は既存loading表示を維持する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    vi.stubGlobal("fetch", () => new Promise(() => undefined));

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });

    expect(dom.window.document.body.textContent).toContain("詳細を読み込んでいます…");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系/状態遷移] error時のRetry後にCycle履歴を表示し、close導線を維持する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: "INTERNAL_ERROR", message: "一時的な障害です。", requestId: "req-1" },
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(dom.window.document.body.textContent).toContain("Issue詳細を読み込めません");
    const retry = [...dom.window.document.querySelectorAll("button")].find(
      (button) => button.textContent === "再試行 →",
    );
    expect(retry).not.toBeUndefined();
    await act(async () => {
      retry?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(dom.window.document.body.textContent).toContain("繰越 1回");

    const closeButton = dom.window.document.querySelector(
      '[aria-label="Issue詳細を閉じる"]',
    ) as HTMLButtonElement | null;
    closeButton?.click();
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("[異常系] Issue Detailの404はNot found導線を表示する", async () => {
    const { dom, root, queryClient, onClose } = renderPanel();
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: "RESOURCE_NOT_FOUND", message: "見つかりません", requestId: "req-2" },
        }),
      }),
    );

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, panelElement(onClose)),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(dom.window.document.body.textContent).toContain("Issueが見つかりません");
    expect(dom.window.document.body.textContent).toContain("Issuesへ戻る →");

    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
