import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, IssueComposer, IssueDetailPanel, RunOverlay } from "./OrbitApp";
import { reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router")),
  useRouter: () => ({ navigate: vi.fn() }),
}));
let dom: JSDOM;
let root: Root;
let opener: HTMLButtonElement;
let onClose: ReturnType<typeof vi.fn>;
let client: QueryClient;
let unexpectedRequests: string[];
beforeEach(() => {
  dom = new JSDOM("<!doctype html><button id='opener'>開く</button><div id='root'></div>", {
    url: "https://orbit.example/issues",
  });
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
  root = createRoot(dom.window.document.getElementById("root")!);
  opener = dom.window.document.getElementById("opener") as HTMLButtonElement;
  opener.focus();
  onClose = vi.fn();
  unexpectedRequests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  dom.window.close();
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
});
function key(target: Element, key: string, shiftKey = false) {
  target.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
  );
}
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
function composer() {
  return createElement(IssueComposer, {
    title: "Draft",
    setTitle: () => undefined,
    projects: [],
    projectId: "",
    setProjectId: () => undefined,
    priority: "no_priority",
    setPriority: () => undefined,
    dueAt: null,
    setDueAt: () => undefined,
    parentId: "",
    setParentId: () => undefined,
    issues: [],
    onClose,
    onSubmit: () => undefined,
    busy: false,
  });
}
function command() {
  return createElement(CommandPalette, {
    onClose,
    onCreate: () => undefined,
    onNavigate: () => undefined,
    onSearch: () => undefined,
    onOpenSelected: () => undefined,
    onArchiveSelected: () => undefined,
    onClearSelection: () => undefined,
    modifierLabel: "Ctrl",
  });
}
function detail(withFallback = true) {
  return createElement(
    QueryClientProvider,
    { client },
    createElement(IssueDetailPanel, {
      issueId: "issue-1",
      fallbackIssue: withFallback ? reviewIssue() : undefined,
      knownIssues: [reviewIssue()],
      projects: [],
      workflowStates: [],
      pending: false,
      onUpdate: () => undefined,
      onArchive: async () => undefined,
      onClose,
    }),
  );
}

describe("review Dialog boundaries", () => {
  it.each(["Composer", "Command", "Detail"])(
    "[Focus巡回] %sの初期Focus・Tab巡回・背景inert・復帰",
    async (kind) => {
      if (kind === "Detail")
        vi.stubGlobal(
          "fetch",
          vi.fn(async (path: string, init: RequestInit = {}) => {
            const method = init.method ?? "GET";
            if (path !== "/api/v1/issues/issue-1" || method !== "GET") {
              unexpectedRequests.push(`${method} ${path}`);
              throw new Error(`Unexpected API request: ${method} ${path}`);
            }
            return { ok: true, status: 200, json: async () => reviewDetail() };
          }),
        );
      await render(kind === "Composer" ? composer() : kind === "Command" ? command() : detail());
      const dialog = dom.window.document.querySelector('[role="dialog"]') as HTMLElement;
      const initial = dialog.querySelector(
        kind === "Composer" ? "textarea" : kind === "Command" ? "input" : "#issue-detail-title",
      );
      expect(dom.window.document.activeElement).toBe(initial);
      expect(opener.hasAttribute("inert")).toBe(true);
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]",
        ),
      ];
      const first = controls[0];
      const last = controls[controls.length - 1];
      await act(async () => {
        last.focus();
        key(last, "Tab");
      });
      expect(dom.window.document.activeElement).toBe(first);
      await act(async () => key(first, "Tab", true));
      expect(dom.window.document.activeElement).toBe(last);
      await act(async () => key(last, "Escape"));
      expect(onClose).toHaveBeenCalledTimes(1);
      await render(null);
      expect(opener.hasAttribute("inert")).toBe(false);
      expect(dom.window.document.activeElement).toBe(opener);
    },
  );
  it("locks background scrolling until the last stacked dialog closes and restores styles", async () => {
    const body = dom.window.document.body;
    const html = dom.window.document.documentElement;
    body.style.overflow = "auto";
    body.style.position = "relative";
    html.style.overflow = "scroll";
    await render(createElement("div", null, composer(), command()));
    expect(body.style.overflow).toBe("hidden");
    expect(body.style.position).toBe("fixed");
    expect(html.style.overflow).toBe("hidden");
    await render(createElement("div", null, composer()));
    expect(body.style.overflow).toBe("hidden");
    await render(null);
    expect(body.style.overflow).toBe("auto");
    expect(body.style.position).toBe("relative");
    expect(html.style.overflow).toBe("scroll");
  });

  it("restores the original scroll position and inline style priority after closing", async () => {
    const body = dom.window.document.body;
    body.style.setProperty("top", "12px", "important");
    body.style.width = "95%";
    Object.defineProperties(dom.window, {
      scrollX: { configurable: true, value: 5 },
      scrollY: { configurable: true, value: 420 },
    });
    const scrollTo = vi.spyOn(dom.window, "scrollTo").mockImplementation(() => undefined);
    await render(createElement("div", null, composer(), command()));
    expect(body.style.top).toBe("-420px");
    expect(body.style.left).toBe("-5px");
    await render(createElement("div", null, composer()));
    expect(scrollTo).not.toHaveBeenCalled();
    await render(null);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(5, 420);
    expect(body.style.top).toBe("12px");
    expect(body.style.getPropertyPriority("top")).toBe("important");
    expect(body.style.width).toBe("95%");
    expect(body.style.left).toBe("");
    expect(dom.window.document.activeElement).toBe(opener);
  });

  it("preserves desktop content width when hiding the scrollbar", async () => {
    Object.defineProperty(dom.window.document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 1024 });
    dom.window.document.body.style.paddingRight = "7px";
    await render(composer());
    expect(dom.window.document.body.style.paddingRight).toBe("31px");
    await render(null);
    expect(dom.window.document.body.style.paddingRight).toBe("7px");
  });

  it("tracks the visible viewport while a keyboard shrinks or shifts it and detaches on close", async () => {
    const viewport = Object.assign(new dom.window.EventTarget(), { height: 844, offsetTop: 0 });
    Object.defineProperty(dom.window, "visualViewport", { configurable: true, value: viewport });
    const remove = vi.spyOn(viewport, "removeEventListener");
    await render(composer());
    const dialog = dom.window.document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.style.getPropertyValue("--dialog-viewport-height")).toBe("844px");
    viewport.height = 390;
    viewport.offsetTop = 48;
    viewport.dispatchEvent(new dom.window.Event("resize"));
    expect(dialog.style.getPropertyValue("--dialog-viewport-height")).toBe("390px");
    expect(dialog.style.getPropertyValue("--dialog-viewport-top")).toBe("48px");
    viewport.offsetTop = 60;
    viewport.dispatchEvent(new dom.window.Event("scroll"));
    expect(dialog.style.getPropertyValue("--dialog-viewport-top")).toBe("60px");
    await render(null);
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    viewport.dispatchEvent(new dom.window.Event("resize"));
    expect(dialog.style.getPropertyValue("--dialog-viewport-height")).toBe("");
    expect(dialog.style.getPropertyValue("--dialog-viewport-top")).toBe("");
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "keeps the dialog open during IME Escape: %j",
    async (ime) => {
      await render(composer());
      const input = dom.window.document.querySelector("textarea")!;
      await act(async () =>
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
            ...ime,
          }),
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => key(input, "Escape"));
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("places the composer caret at the end once and preserves later selection", async () => {
    await render(composer());
    const input = dom.window.document.querySelector("textarea")!;
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
    input.setSelectionRange(1, 3);
    await render(composer());
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(3);
  });

  it.each(["untouched", "pointer", "composition", "keyboard", "input"])(
    "positions an asynchronously loaded title only when untouched: %s",
    async (interaction) => {
      let resolveDetail!: (value: unknown) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise((resolve) => {
              resolveDetail = resolve;
            }),
        ),
      );
      await render(detail(false));
      const input = dom.window.document.querySelector("#issue-detail-title") as HTMLTextAreaElement;
      expect(dom.window.document.activeElement).toBe(input);
      const select = vi.spyOn(input, "setSelectionRange");
      if (interaction !== "untouched") {
        input.dispatchEvent(
          new dom.window.Event(
            (
              {
                pointer: "pointerdown",
                composition: "compositionstart",
                keyboard: "keydown",
                input: "input",
              } as Record<string, string>
            )[interaction],
            {
              bubbles: true,
            },
          ),
        );
      }
      await act(async () => {
        resolveDetail({ ok: true, status: 200, json: async () => reviewDetail() });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(input.value).toBe(reviewIssue().title);
      expect(select).toHaveBeenCalledTimes(interaction === "untouched" ? 1 : 0);
      if (interaction === "untouched") {
        expect(input.selectionStart).toBe(input.value.length);
        expect(input.selectionEnd).toBe(input.value.length);
      } else {
        // React updates the controlled value itself; the caret helper must not intervene.
        await act(async () => client.setQueryData(["issue-detail", "issue-1"], reviewDetail()));
        expect(select).not.toHaveBeenCalled();
      }
      input.setSelectionRange(1, 3);
      await render(detail(false));
      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(3);
    },
  );

  it("[Escape境界] 背景へ向いたEscapeも最前面Dialogのcloseだけへ渡す", async () => {
    await render(composer());
    await act(async () => key(dom.window.document.body, "Escape"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("[Run重なり] 実行中Runを最前面に保ち、解除後はComposerへFocusを戻す", async () => {
    const run = {
      run_id: "run-dialog",
      kind: "maintenance" as const,
      status: "running" as const,
      progress: {
        current_step: "purge" as const,
        step_index: 1,
        step_count: 3 as const,
        cursor: null,
        processed: 0,
        total: null,
        percent: 30,
      },
      error: null,
      requested_at: 1,
      started_at: 1,
      heartbeat_at: 1,
      finished_at: null,
      resume_count: 0,
    };
    await render(
      createElement(
        "div",
        null,
        composer(),
        createElement(RunOverlay, { run, busy: true, onResume: () => undefined }),
      ),
    );
    const composeDialog = dom.window.document.querySelector(
      '[aria-labelledby="issue-composer-title"]',
    ) as HTMLElement;
    const runDialog = dom.window.document.querySelector(".run-overlay") as HTMLElement;
    expect(composeDialog.hasAttribute("inert")).toBe(true);
    expect(dom.window.document.activeElement).toBe(runDialog);
    await act(async () => key(runDialog, "Escape"));
    expect(onClose).not.toHaveBeenCalled();
    await render(createElement("div", null, composer()));
    expect(opener.hasAttribute("inert")).toBe(true);
    expect(composeDialog.hasAttribute("inert")).toBe(false);
    expect(composeDialog.contains(dom.window.document.activeElement)).toBe(true);
  });
  it("[重なり] Command解除後も下のComposerのinert/trapを維持する", async () => {
    await render(createElement("div", null, composer(), command()));
    const dialogs = [...dom.window.document.querySelectorAll('[role="dialog"]')];
    expect(dialogs[0].hasAttribute("inert")).toBe(true);
    expect(dom.window.document.activeElement).toBe(dialogs[1].querySelector("input"));
    await render(createElement("div", null, composer()));
    expect(opener.hasAttribute("inert")).toBe(true);
    expect(dialogs[0].hasAttribute("inert")).toBe(false);
    expect(dialogs[0].contains(dom.window.document.activeElement)).toBe(true);
  });
});
