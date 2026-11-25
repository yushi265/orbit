import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

let dom: JSDOM;
let app: RenderedApp | undefined;
let data: ReturnType<typeof reviewBootstrap>;
let actions: Array<{ path: string; key: string | null }>;
let unexpected: string[];
let actionResponder: (path: string) => Promise<Response>;

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function errorResponse(status: number, code: string, message: string) {
  return response({ error: { code, message, details: {}, requestId: "r" } }, status);
}
// A（通常）・B（アーカイブ済み）・C（通常）。AにIssueが2件（1件はゴミ箱）、Cに1件。
function buildData(archived: string[] = ["B"]) {
  const base = reviewBootstrap().projects[0];
  const projects = ["A", "B", "C"].map((id, position) => ({
    ...base,
    id,
    name: `Project ${id}`,
    position,
    archivedAt: archived.includes(id) ? 10 : null,
  }));
  const issues = [
    reviewIssue("issue-a1", { projectId: "A" }),
    reviewIssue("issue-a2", { projectId: "A", number: 2, deletedAt: 5 }),
    reviewIssue("issue-a3", { projectId: "A", number: 3 }),
    reviewIssue("issue-b1", { projectId: "B", number: 4 }),
  ];
  return { ...reviewBootstrap(issues), projects };
}

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/projects",
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
    value: function (this: HTMLElement, name: string, listener: EventListener) {
      this.addEventListener(name.replace(/^on/, ""), listener);
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    value: function (this: HTMLElement, name: string, listener: EventListener) {
      this.removeEventListener(name.replace(/^on/, ""), listener);
    },
  });
  data = buildData();
  actions = [];
  unexpected = [];
  actionResponder = () => Promise.resolve(response({ project: data.projects[0] }));
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET") return Promise.resolve(response(data));
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(response({ run: null }));
      if (path.startsWith("/api/v1/projects/") && path.includes("?action=") && method === "POST") {
        actions.push({ path, key: new Headers(init.headers).get("Idempotency-Key") });
        return actionResponder(path);
      }
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error("Unexpected request"));
    }),
  );
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});

async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
async function render(url = "/projects") {
  app = await renderApp({ url, container: dom.window.document.getElementById("root")! });
  await settle();
}
const doc = () => dom.window.document;
function buttonByText(text: string) {
  return [...doc().querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}
const pathname = () => app!.router.state.location.pathname;

describe("Projects一覧のアーカイブ済み（AC-6）", () => {
  it("[代表値] アーカイブ済みは折りたたみの中にまとまり、並べ替えボタンを持たず印を出す", async () => {
    await render();
    const section = doc().querySelector("details.project-archived-section") as HTMLDetailsElement;
    expect(section).toBeTruthy();
    expect(section.open).toBe(false);
    expect(section.querySelector("summary")?.textContent).toContain("アーカイブ済み（1）");
    const archivedCard = section.querySelector('a.project-card[data-project-id="B"]');
    expect(archivedCard).toBeTruthy();
    expect(archivedCard?.getAttribute("href")).toBe("/projects/B");
    expect(section.querySelector(".project-archived-badge")?.textContent).toBe("アーカイブ済み");
    expect(section.querySelectorAll("button.project-order-button")).toHaveLength(0);
    const activeIds = [...doc().querySelectorAll(".project-grid > .project-card-item")]
      .filter((element) => !element.closest("details"))
      .map((element) => element.getAttribute("data-project-id"));
    expect(activeIds).toEqual(["A", "C"]);
    expect(
      (doc().querySelector('button[aria-label="Project Cを下へ移動"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("[境界値] 全件アーカイブ済みなら空表示を出さず、折りたたみだけを出す", async () => {
    data = buildData(["A", "B", "C"]);
    await render();
    expect(doc().body.textContent).not.toContain("Projectはまだありません");
    expect(doc().querySelector("details.project-archived-section summary")?.textContent).toContain(
      "アーカイブ済み（3）",
    );
  });

  it("[境界値] アーカイブ済みが0件なら折りたたみを出さない", async () => {
    data = buildData([]);
    await render();
    expect(doc().querySelector("details.project-archived-section")).toBeNull();
  });
});

describe("Project詳細のアーカイブ・元に戻す（AC-7）", () => {
  it("[状態遷移] 未アーカイブ → アーカイブでaction=archiveを呼び、再取得後に元に戻すが出る", async () => {
    await render("/projects/A");
    expect(doc().querySelector(".project-archived-notice")).toBeNull();
    actionResponder = () => {
      data = buildData(["A", "B"]);
      return Promise.resolve(response({ project: data.projects[0] }));
    };
    await click(buttonByText("アーカイブ")!);
    expect(actions).toHaveLength(1);
    expect(actions[0].path).toBe("/api/v1/projects/A?action=archive");
    expect(actions[0].key).toBeTruthy();
    expect(doc().querySelector(".project-archived-notice")?.textContent).toContain(
      "このProjectはアーカイブ済みです",
    );
    expect(buttonByText("アーカイブ")).toBeUndefined();
    expect(buttonByText("元に戻す")).toBeTruthy();
  });

  it("[状態遷移] アーカイブ済み → 元に戻すでaction=restoreを呼ぶ", async () => {
    await render("/projects/B");
    actionResponder = () => {
      data = buildData([]);
      return Promise.resolve(response({ project: data.projects[1] }));
    };
    await click(buttonByText("元に戻す")!);
    expect(actions.map((item) => item.path)).toEqual(["/api/v1/projects/B?action=restore"]);
    expect(doc().querySelector(".project-archived-notice")).toBeNull();
    expect(buttonByText("アーカイブ")).toBeTruthy();
  });

  it("[代表値] 失敗するとエラーを表示し、表示とボタンは元のまま", async () => {
    await render("/projects/A");
    actionResponder = () =>
      Promise.resolve(errorResponse(423, "OPERATION_IN_PROGRESS", "処理中です。"));
    await click(buttonByText("アーカイブ")!);
    expect(doc().querySelector(".detail-live-error")?.textContent).toContain("処理中です。");
    expect(buttonByText("アーカイブ")?.disabled).toBe(false);
    expect(doc().querySelector(".project-archived-notice")).toBeNull();
  });
});

describe("Project詳細の削除（AC-8）", () => {
  it("[状態遷移] 確認ダイアログ → キャンセルでは何もしない → 削除するでaction=deleteを呼び一覧へ戻る", async () => {
    await render("/projects/A");
    await click(buttonByText("削除")!);
    const dialog = doc().querySelector('[role="dialog"]')!;
    expect(doc().activeElement?.textContent?.trim()).toBe("キャンセル");
    expect(dialog.textContent).toContain("Projectを削除しますか？");
    expect(dialog.textContent).toContain("Project A");
    expect(dialog.textContent).toContain("Issue 2件");
    expect(dialog.textContent).toContain("元に戻せません");
    await click(buttonByText("キャンセル")!);
    expect(doc().querySelector('[role="dialog"]')).toBeNull();
    expect(actions).toHaveLength(0);

    await click(buttonByText("削除")!);
    actionResponder = () => {
      data = { ...buildData(), projects: buildData().projects.filter((p) => p.id !== "A") };
      return Promise.resolve(response({ project: { id: "A" } }));
    };
    await click(buttonByText("削除する")!);
    expect(actions.map((item) => item.path)).toEqual(["/api/v1/projects/A?action=delete"]);
    expect(pathname()).toBe("/projects");
    expect(doc().querySelector('a.project-card[data-project-id="A"]')).toBeNull();
  });

  it("[代表値] Escで閉じ、削除APIは呼ばない", async () => {
    await render("/projects/A");
    await click(buttonByText("削除")!);
    await act(async () => {
      doc().activeElement!.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
    expect(doc().querySelector('[role="dialog"]')).toBeNull();
    expect(actions).toHaveLength(0);
  });

  it("[代表値] 失敗するとダイアログ内にエラーを出し、閉じない", async () => {
    await render("/projects/A");
    await click(buttonByText("削除")!);
    actionResponder = () =>
      Promise.resolve(errorResponse(404, "RESOURCE_NOT_FOUND", "対象が見つかりません。"));
    await click(buttonByText("削除する")!);
    const dialog = doc().querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain(
      "対象が見つかりません。",
    );
    expect(pathname()).toBe("/projects/A");
    expect(buttonByText("削除する")?.disabled).toBe(false);
  });
});
