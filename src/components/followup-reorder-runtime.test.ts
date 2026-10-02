import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));
let dom: JSDOM;
let root: Root;
let data: ReturnType<typeof reviewBootstrap>;
let posts: Array<{ body: Record<string, unknown>; resolve: (value: Response) => void }>;
let unexpected: string[];
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/issues?order=manual",
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
  data = reviewBootstrap([
    reviewIssue("one", { identifier: "TASK-1", position: 0 }),
    reviewIssue("two", { identifier: "TASK-2", position: 1 }),
  ]);
  queryClient.setQueryData(["bootstrap"], data);
  posts = [];
  unexpected = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET") return Promise.resolve(response(data));
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(response({ run: null }));
      if (path === "/api/v1/issues/reorder" && method === "POST")
        return new Promise<Response>((resolve) =>
          posts.push({ body: JSON.parse(init.body as string), resolve }),
        );
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
async function render(order: "manual" | "updated_desc" = "manual") {
  await act(async () =>
    root.render(
      createElement(OrbitApp, {
        initialSection: "issues",
        issueSearch: { order, completed: true },
      }),
    ),
  );
  await settle();
}
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
function handle(id: string) {
  return dom.window.document.querySelector(
    `button.drag-handle[aria-label="TASK-${id}の並び替え"]`,
  ) as HTMLButtonElement;
}
function nativeDisabledBlur(target: HTMLButtonElement) {
  // JSDOM refuses blur() while disabled. Temporarily enable only to inject the
  // BODY Focus that Chromium produces when the pending handle becomes disabled.
  const disabled = target.disabled;
  target.disabled = false;
  target.blur();
  target.disabled = disabled;
}
function key(target: HTMLElement, direction = "ArrowUp", altKey = true) {
  const event = new dom.window.KeyboardEvent("keydown", {
    key: direction,
    altKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}
describe("Issue keyboard reorder admission", () => {
  it("[payload/409] Alt+Arrowは同じreorderを送り、pending/selection/競合Retryを維持する", async () => {
    await render();
    expect(handle("2")).not.toBeNull();
    const selected = dom.window.document.querySelector(
      'input[aria-label="TASK-1を選択"]',
    ) as HTMLInputElement;
    await act(async () => selected.click());
    const globalKey = vi.fn();
    dom.window.addEventListener("keydown", globalKey);
    let event!: KeyboardEvent;
    await act(async () => {
      handle("2").focus();
      event = key(handle("2"));
    });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(globalKey).not.toHaveBeenCalled();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      issueId: "two",
      version: 1,
      beforeIssueId: "one",
      idempotencyKey: expect.any(String),
    });
    expect(handle("2").disabled).toBe(true);
    // JSDOM retains Focus on disabled controls. Inject Chromium's native blur.
    await act(async () => nativeDisabledBlur(handle("2")));
    expect(dom.window.document.activeElement?.tagName).toBe("BODY");
    await act(async () => key(handle("2")));
    expect(posts).toHaveLength(1);
    data = { ...data, issues: [data.issues[0], { ...data.issues[1], version: 2 }] };
    await act(async () =>
      posts[0].resolve(
        response({ error: { code: "ISSUE_VERSION_CONFLICT", message: "順序競合" } }, 409),
      ),
    );
    await settle();
    expect(dom.window.document.body.textContent).toContain("順序競合");
    expect(dom.window.document.activeElement?.getAttribute("aria-label")).toBe("TASK-2の並び替え");
    expect(selected.checked).toBe(true);
    const retry = [...dom.window.document.querySelectorAll(".toast button")].find(
      (button) => button.textContent === "再試行",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toMatchObject({ issueId: "two", version: 2, beforeIssueId: "one" });
    expect(posts[1].body.idempotencyKey).not.toBe(posts[0].body.idempotencyKey);
    const moved = { ...data.issues[1], position: -1, version: 3 };
    data = { ...data, issues: [data.issues[0], moved] };
    await act(async () => posts[1].resolve(response({ issue: moved })));
    await settle();
    expect(
      [...dom.window.document.querySelectorAll(".issue-row .issue-id")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["TASK-2", "TASK-1"]);
    expect(selected.checked).toBe(true);
  });
  it("[成功/Nativeblur故障注入] pendingでBODYになっても新順序の元handleへpreventScrollで戻す", async () => {
    await render();
    const origin = handle("2");
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, "focus");
    await act(async () => {
      origin.focus();
      key(origin);
    });
    await settle();
    expect(origin.disabled).toBe(true);
    await act(async () => nativeDisabledBlur(origin));
    expect(dom.window.document.activeElement?.tagName).toBe("BODY");
    const moved = { ...data.issues[1], position: -1, version: 2 };
    data = { ...data, issues: [data.issues[0], moved] };
    await act(async () => posts[0].resolve(response({ issue: moved })));
    await settle();
    expect(handle("2")).toBe(origin); // React's stable Issue key preserves this node.
    expect(origin.disabled).toBe(false);
    expect(dom.window.document.activeElement?.getAttribute("aria-label")).toBe("TASK-2の並び替え");
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });
  it.each([false, true])(
    "[non-steal] 別inputへ移った後は成功後もFocusを奪わない bodyへblur=%s",
    async (blurOther) => {
      await render("updated_desc");
      await render("manual");
      const origin = handle("2");
      await act(async () => {
        origin.focus();
        key(origin);
      });
      await settle();
      await act(async () => nativeDisabledBlur(origin));
      const other = dom.window.document.querySelector(
        'input[aria-label="TASK-1のDue date"]',
      ) as HTMLInputElement;
      await act(async () => other.focus());
      if (blurOther) await act(async () => other.blur());
      const moved = { ...data.issues[1], position: -1, version: 2 };
      data = { ...data, issues: [data.issues[0], moved] };
      await act(async () => posts[0].resolve(response({ issue: moved })));
      await settle();
      if (blurOther) expect(dom.window.document.activeElement?.tagName).toBe("BODY");
      else expect(dom.window.document.activeElement).toBe(other);
    },
  );
  it("[Noop→DnD/pointer] 境界Alt矢印の後もDnD完了でFocusを奪わない", async () => {
    await render();
    const origin = handle("2");
    const target = handle("1").closest(".issue-row")!;
    const transfer = { effectAllowed: "", setData: vi.fn() };
    const start = new dom.window.Event("dragstart", { bubbles: true });
    Object.defineProperty(start, "dataTransfer", { value: transfer });
    await act(async () => {
      origin.focus();
      key(origin, "ArrowDown"); // Last-row boundary: no Keyboard request.
    });
    expect(posts).toHaveLength(0);
    await act(async () => origin.dispatchEvent(start));
    await act(async () =>
      target.dispatchEvent(new dom.window.Event("dragover", { bubbles: true, cancelable: true })),
    );
    await act(async () =>
      target.dispatchEvent(new dom.window.Event("drop", { bubbles: true, cancelable: true })),
    );
    await settle();
    expect(posts).toHaveLength(1);
    await act(async () => nativeDisabledBlur(origin));
    const moved = { ...data.issues[1], position: -1, version: 2 };
    data = { ...data, issues: [data.issues[0], moved] };
    await act(async () => posts[0].resolve(response({ issue: moved })));
    await settle();
    expect(dom.window.document.activeElement?.tagName).toBe("BODY");
  });
  it("[boundary] 先頭Up/末尾Down/修飾なしはrequestを作らずDnDを維持する", async () => {
    await render();
    expect(handle("1")).not.toBeNull();
    await act(async () => handle("2").focus());
    const listeners = vi.spyOn(dom.window.document, "addEventListener");
    await act(async () => {
      key(handle("1"));
      key(handle("2"), "ArrowDown");
      key(handle("2"), "ArrowUp", false);
    });
    expect(posts).toHaveLength(0);
    expect(
      listeners.mock.calls.filter(([type]) => type === "focusin" || type === "dragstart"),
    ).toHaveLength(0);
    expect(handle("1").closest(".issue-row")?.getAttribute("draggable")).toBe("true");
    expect(dom.window.document.querySelectorAll(".reorder-button")).toHaveLength(0);
  });
});
