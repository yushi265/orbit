import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { reviewBootstrap } from "./review-ui.test-fixtures";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    onClick,
    ...props
  }: {
    children?: ReactNode;
    to?: string;
    onClick?: (event: { preventDefault: () => void; defaultPrevented: boolean }) => void;
    [key: string]: unknown;
  }) =>
    createElement(
      "a",
      {
        ...props,
        href: to,
        onClick: (event: { preventDefault: () => void; defaultPrevented: boolean }) => {
          onClick?.(event);
          if (!event.defaultPrevented) navigate({ to });
          event.preventDefault();
        },
      },
      children,
    ),
  useRouter: () => ({ navigate }),
}));

let dom: JSDOM;
let root: Root;
let data: ReturnType<typeof reviewBootstrap>;
let posts: Array<Record<string, unknown>>;
let unexpected: string[];
let bootstrapGets: number;
let reorderResponder: (body: Record<string, unknown>) => Promise<Response>;

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function projectsOf(ids: string[]) {
  const base = reviewBootstrap().projects[0];
  return ids.map((id, position) => ({ ...base, id, name: `Project ${id}`, position }));
}
function buildData(ids: string[]) {
  return { ...reviewBootstrap(), projects: projectsOf(ids) };
}
beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockReset();
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
  root = createRoot(dom.window.document.getElementById("root")!);
  queryClient.clear();
  data = buildData(["A", "B", "C"]);
  queryClient.setQueryData(["bootstrap"], data);
  posts = [];
  unexpected = [];
  bootstrapGets = 0;
  reorderResponder = () => Promise.resolve(response({ project: data.projects[0] }));
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET") {
        bootstrapGets += 1;
        return Promise.resolve(response(data));
      }
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(response({ run: null }));
      if (path === "/api/v1/projects/reorder" && method === "POST") {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        posts.push(body);
        return reorderResponder(body);
      }
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error("Unexpected request"));
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
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
async function render() {
  await act(async () => root.render(createElement(OrbitApp, { initialSection: "projects" })));
  await settle();
}
const doc = () => dom.window.document;
function button(name: string) {
  return doc().querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
}
function order() {
  return [...doc().querySelectorAll(".project-card-item")].map((el) =>
    el.getAttribute("data-project-id"),
  );
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}
function serverProjects(ids: string[]) {
  data = buildData(ids);
}
function setProjects(ids: string[]) {
  data = buildData(ids);
  queryClient.setQueryData(["bootstrap"], data);
}
function errorResponse(status: number, code: string, message: string) {
  return response({ error: { code, message, details: {}, requestId: "r" } }, status);
}

describe("Projects一覧の並べ替えボタン", () => {
  it("[代表値] 各カードに名前つきボタンが2つあり、先頭の上へと末尾の下へだけ無効。Linkの子孫ではない", async () => {
    await render();
    expect(order()).toEqual(["A", "B", "C"]);
    for (const id of ["A", "B", "C"]) {
      expect(button(`Project ${id}を上へ移動`)).toBeTruthy();
      expect(button(`Project ${id}を下へ移動`)).toBeTruthy();
    }
    const disabled = [...doc().querySelectorAll("button.project-order-button:disabled")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(disabled).toEqual(["Project Aを上へ移動", "Project Cを下へ移動"]);
    const first = doc().querySelector(".project-card-item")!;
    expect(first.querySelector("a.project-card")).toBeTruthy();
    expect(first.querySelector("a.project-card")?.getAttribute("data-project-id")).toBe("A");
    expect(first.querySelector(".project-order-actions")).toBeTruthy();
    for (const b of doc().querySelectorAll("button.project-order-button")) {
      expect(b.closest("a")).toBeNull();
      expect(b.getAttribute("type")).toBe("button");
    }
  });

  it("[境界値] 1件のとき両方無効。0件のときボタンが無く空表示", async () => {
    setProjects(["A"]);
    await render();
    expect(button("Project Aを上へ移動").disabled).toBe(true);
    expect(button("Project Aを下へ移動").disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(doc().getElementById("root")!);
    setProjects([]);
    await render();
    expect(doc().querySelectorAll("button.project-order-button")).toHaveLength(0);
    expect(doc().body.textContent).toContain("Projectはまだありません");
  });

  it("[代表値] 2件目の上へで先頭の前へ送信され、再取得後に新しい順で表示される（AC-8）", async () => {
    await render();
    reorderResponder = () => {
      serverProjects(["B", "A", "C"]);
      return Promise.resolve(response({ project: data.projects[0] }));
    };
    const getsBefore = bootstrapGets;
    await click(button("Project Bを上へ移動"));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ projectId: "B", beforeProjectId: "A" });
    expect(bootstrapGets).toBeGreaterThan(getsBefore);
    expect(typeof posts[0].idempotencyKey).toBe("string");
    expect(order()).toEqual(["B", "A", "C"]);
  });

  it("[代表値] 1件目の下へはbeforeProjectIdが3件目、2件目の下へはnull", async () => {
    await render();
    await click(button("Project Aを下へ移動"));
    expect(posts[0]).toMatchObject({ projectId: "A", beforeProjectId: "C" });
    await click(button("Project Bを下へ移動"));
    expect(posts[1]).toMatchObject({ projectId: "B", beforeProjectId: null });
  });

  it("[状態遷移] 応答待ちは全ボタンが無効で連打してもAPIは1回。成功後に解除される", async () => {
    await render();
    let resolveReorder: (value: Response) => void = () => undefined;
    reorderResponder = () =>
      new Promise<Response>((resolveFn) => {
        resolveReorder = resolveFn;
      });
    await click(button("Project Bを上へ移動"));
    const buttons = [
      ...doc().querySelectorAll("button.project-order-button"),
    ] as HTMLButtonElement[];
    expect(buttons).toHaveLength(6);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    await click(button("Project Bを上へ移動"));
    await click(button("Project Cを上へ移動"));
    expect(posts).toHaveLength(1);
    await act(async () => {
      serverProjects(["B", "A", "C"]);
      resolveReorder(response({ project: data.projects[0] }));
    });
    await settle();
    expect(button("Project Aを上へ移動").disabled).toBe(false);
    expect(button("Project Bを上へ移動").disabled).toBe(true);
  });

  it.each([
    [423, "LOCKED", "メンテナンス中です"],
    [404, "NOT_FOUND", "Projectが見つかりません"],
  ])(
    "[同値分割] APIが%iを返すとエラートーストを出し順番はそのまま、ボタンは再び押せる（AC-9）",
    async (status, code, message) => {
      await render();
      reorderResponder = () => Promise.resolve(errorResponse(status, code, message));
      await click(button("Project Bを上へ移動"));
      expect(doc().querySelector(".toast.error")?.textContent).toContain(message);
      expect(order()).toEqual(["A", "B", "C"]);
      expect(button("Project Bを上へ移動").disabled).toBe(false);
      expect(doc().activeElement).toBe(button("Project Bを上へ移動"));
    },
  );

  it("[同値分割] 通信エラーでは既定のメッセージが出る", async () => {
    await render();
    reorderResponder = () => Promise.reject(new Error("network"));
    await click(button("Project Bを上へ移動"));
    expect(doc().querySelector(".toast.error")?.textContent).toContain(
      "Projectの並べ替えに失敗しました",
    );
    expect(order()).toEqual(["A", "B", "C"]);
    expect(button("Project Bを上へ移動").disabled).toBe(false);
  });

  it("[代表値] ボタンでは遷移せず、カード本体を押すと従来どおり遷移する（AC-10）", async () => {
    await render();
    await click(button("Project Bを下へ移動"));
    expect(navigate).not.toHaveBeenCalled();
    await click(doc().querySelector('a.project-card[data-project-id="B"]')!);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("[状態遷移] 先頭へ着いたら同じカードの下へへ、途中の移動では押したボタンへフォーカスが残る", async () => {
    setProjects(["A", "B", "C", "D"]);
    await render();
    reorderResponder = () => {
      serverProjects(["A", "C", "B", "D"]);
      return Promise.resolve(response({ project: data.projects[0] }));
    };
    await click(button("Project Cを上へ移動"));
    expect(order()).toEqual(["A", "C", "B", "D"]);
    expect(doc().activeElement).toBe(button("Project Cを上へ移動"));
    reorderResponder = () => {
      serverProjects(["C", "A", "B", "D"]);
      return Promise.resolve(response({ project: data.projects[0] }));
    };
    await click(button("Project Cを上へ移動"));
    expect(order()).toEqual(["C", "A", "B", "D"]);
    expect(button("Project Cを上へ移動").disabled).toBe(true);
    expect(doc().activeElement).toBe(button("Project Cを下へ移動"));
  });
});

describe("Project並べ替えのCSS", () => {
  const rules = parseStyleRules();
  it("[代表値] 規則があり、〜767pxでボタンが44px以上", () => {
    expect(declarationsFor(rules, ".project-card-item").size).toBeGreaterThan(0);
    expect(declarationsFor(rules, ".project-order-actions").size).toBeGreaterThan(0);
    expect(declarationsFor(rules, ".project-order-button").size).toBeGreaterThan(0);
    const mobile = declarationsFor(rules, ".project-order-button", "(max-width: 767px)");
    expect(mobile.get("width")).toBe("44px");
    expect(mobile.get("height")).toBe("44px");
  });
});
