import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { reviewBootstrap, reviewIssue, reviewDetail } from "./review-ui.test-fixtures";

const navigate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate }),
}));

let dom: JSDOM;
let root: Root;
let requests: Array<{ path: string; init: RequestInit }>;
let searchResponses: Record<string, ReturnType<typeof deferred<Response>>>;
let projectResponses: Array<ReturnType<typeof deferred<Response>>>;
let unexpected: string[];
let serverIssue = reviewIssue();
let issueResponses: Array<ReturnType<typeof deferred<Response>>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.focus();
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  input.dispatchEvent(
    Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
      propertyName: "value",
    }),
  );
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
async function render(section: "search" | "projects" | "issues" = "search", issueId?: string) {
  await act(async () => root.render(createElement(OrbitApp, { initialSection: section, issueId })));
  await advance(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/search" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
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
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
  queryClient.clear();
  queryClient.setQueryData(["bootstrap"], reviewBootstrap());
  navigate.mockClear();
  requests = [];
  searchResponses = {};
  projectResponses = [];
  unexpected = [];
  serverIssue = reviewIssue();
  issueResponses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      requests.push({ path, init });
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET")
        return Promise.resolve(json(reviewBootstrap()));
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(json({ run: null }));
      if (path === "/api/v1/recent" && method === "GET")
        return Promise.resolve(json({ issueViews: [], searches: [] }));
      if (path === "/api/v1/recent-searches" && method === "POST") return Promise.resolve(json({}));
      if (path === "/api/v1/issues/issue-1" && method === "GET")
        return Promise.resolve(json(reviewDetail(serverIssue)));
      if (path === "/api/v1/issues/issue-1" && method === "PATCH") {
        const pending = deferred<Response>();
        issueResponses.push(pending);
        return pending.promise;
      }
      if (path.startsWith("/api/v1/search?") && method === "GET") {
        const q = new URL(path, "https://orbit.example").searchParams.get("q")!;
        return (searchResponses[q] = deferred<Response>()).promise;
      }
      if (path === "/api/v1/projects" && method === "POST") {
        const pending = deferred<Response>();
        projectResponses.push(pending);
        return pending.promise;
      }
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error(`Unexpected API request: ${method} ${path}`));
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});
async function search(value: string) {
  await act(async () =>
    setValue(dom.window.document.querySelector("#global-search-input") as HTMLInputElement, value),
  );
  await advance(300);
}

describe("review search request ordering", () => {
  it("[通信順逆転] 古い成功応答は新しい検索結果を上書きしない", async () => {
    await render();
    await search("old");
    await search("new");
    await act(async () =>
      searchResponses.new.resolve(json({ items: [reviewIssue("new-result")] })),
    );
    expect(dom.window.document.body.textContent).toContain("new-result");
    await act(async () =>
      searchResponses.old.resolve(json({ items: [reviewIssue("old-result")] })),
    );
    expect(dom.window.document.body.textContent).toContain("new-result");
    expect(dom.window.document.body.textContent).not.toContain("old-result");
  });
  it("[通信順逆転] 古い失敗応答は新しい検索結果へエラーを表示しない", async () => {
    await render();
    await search("old");
    await search("new");
    await act(async () =>
      searchResponses.new.resolve(json({ items: [reviewIssue("new-result")] })),
    );
    await act(async () =>
      searchResponses.old.resolve(
        json({ error: { code: "INTERNAL_ERROR", message: "古い検索の失敗" } }, 500),
      ),
    );
    expect(dom.window.document.body.textContent).toContain("new-result");
    expect(dom.window.document.body.textContent).not.toContain("古い検索の失敗");
  });
  it("[状態遷移] 空検索後に旧応答が到着しても結果を再表示しない", async () => {
    await render();
    await search("old");
    await search("");
    await act(async () =>
      searchResponses.old.resolve(json({ items: [reviewIssue("old-result")] })),
    );
    expect(dom.window.document.body.textContent).not.toContain("old-result");
    expect(requests.filter(({ path }) => path === "/api/v1/recent-searches")).toHaveLength(0);
  });
  it("[ライフサイクル] unmount後の旧応答は検索履歴も書かない", async () => {
    await render();
    await search("old");
    await act(async () => root.unmount());
    await act(async () =>
      searchResponses.old.resolve(json({ items: [reviewIssue("old-result")] })),
    );
    expect(requests.filter(({ path }) => path === "/api/v1/recent-searches")).toHaveLength(0);
  });
});

async function openProjectComposer() {
  await render("projects");
  const open = [...dom.window.document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("新しいProject"),
  )!;
  await act(async () => open.click());
  const name = dom.window.document.querySelector("#project-name") as HTMLInputElement;
  await act(async () => setValue(name, "New Project"));
  return {
    name,
    submit: [...dom.window.document.querySelectorAll(".modal-actions button")].find(
      (button) => button.textContent === "作成する",
    )!,
  };
}

describe("review Project creation admission", () => {
  it("[同時操作] 連打と保存中Enterを1回だけ送信し、pending中は作成を無効にする", async () => {
    const { name, submit } = await openProjectComposer();
    await act(async () => {
      submit.click();
      submit.click();
      name.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(projectResponses).toHaveLength(1);
    expect(submit.disabled).toBe(true);
    await act(async () =>
      projectResponses[0].resolve(json({ project: reviewBootstrap().projects[0] })),
    );
    expect(dom.window.document.querySelector("#project-name")).toBeNull();
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "[IME] 確定Enter%sではProjectを作成しない",
    async (ime) => {
      const { name } = await openProjectComposer();
      await act(async () =>
        name.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...ime }),
        ),
      );
      expect(projectResponses).toHaveLength(0);
      expect(dom.window.document.querySelector("#project-name")).not.toBeNull();
    },
  );
  it("[失敗/再試行] 失敗後は同じpayloadとidempotency keyで再試行できる", async () => {
    const { submit } = await openProjectComposer();
    await act(async () => submit.click());
    await act(async () =>
      projectResponses[0].resolve(
        json({ error: { code: "INTERNAL_ERROR", message: "作成できませんでした" } }, 500),
      ),
    );
    expect(dom.window.document.body.textContent).toContain("作成できませんでした");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(projectResponses).toHaveLength(2);
    const posts = requests.filter(
      ({ path, init }) => path === "/api/v1/projects" && init.method === "POST",
    );
    expect(JSON.parse(posts[1].init.body as string)).toEqual(
      JSON.parse(posts[0].init.body as string),
    );
    await act(async () =>
      projectResponses[1].resolve(json({ project: reviewBootstrap().projects[0] })),
    );
    expect(dom.window.document.querySelector("#project-name")).toBeNull();
  });
});

describe("review Detail Escape save boundary", () => {
  it("[Window Escape経路] Windowへ直接届くEscapeもDetailを一度だけ閉じる", async () => {
    queryClient.setQueryData(["issue-detail", "issue-1"], reviewDetail());
    await render("issues", "issue-1");
    expect(dom.window.document.activeElement).toBe(
      dom.window.document.querySelector('[role="dialog"]'),
    );
    await act(async () =>
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/issues", search: { completed: true }, resetScroll: false }),
    );
    expect(dom.window.document.querySelector(".issue-detail-backdrop")).toBeNull();
    expect(dom.window.document.querySelector("[inert]")).toBeNull();
  });
  it.each([200, 500])(
    "[実App/保存待機] Escapeはflushを待ち、HTTP=%i後に成功だけ閉じる",
    async (status) => {
      queryClient.setQueryData(["issue-detail", "issue-1"], reviewDetail());
      await render("issues", "issue-1");
      const title = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
      expect(dom.window.document.activeElement).toBe(
        dom.window.document.querySelector('[role="dialog"]'),
      );
      await act(async () => {
        setValue(title, "Escape保存draft");
        dom.window.document.body.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        title.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(issueResponses).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(dom.window.document.querySelector(".issue-detail-backdrop")).not.toBeNull();
      await act(async () => {
        serverIssue = { ...serverIssue, title: "Escape保存draft", version: 2 };
        issueResponses[0].resolve(
          status === 200
            ? json({ issue: serverIssue })
            : json({ error: { code: "INTERNAL_ERROR", message: "保存できませんでした" } }, status),
        );
      });
      if (status === 200) {
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith(
          expect.objectContaining({
            to: "/issues",
            search: { completed: true },
            resetScroll: false,
          }),
        );
        expect(dom.window.document.querySelector(".issue-detail-backdrop")).toBeNull();
      } else {
        expect(navigate).not.toHaveBeenCalled();
        expect(dom.window.document.querySelector(".issue-detail-backdrop")).not.toBeNull();
        expect(dom.window.document.body.textContent).toContain("保存できませんでした");
        expect(dom.window.document.body.textContent).toContain("説明を再試行");
      }
    },
  );
});
