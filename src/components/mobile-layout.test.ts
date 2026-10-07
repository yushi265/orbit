import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPanel, OrbitApp } from "./OrbitApp";
import { queryClient } from "../lib/query";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn().mockResolvedValue(undefined) }),
}));

const rules = parseStyleRules();
const MOBILE = "(max-width: 767px)";
const issue = reviewIssue("issue-1", { title: "layout" });

let dom: JSDOM;
let root: Root;
const doc = () => dom.window.document as unknown as Document;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.addEventListener(name.replace(/^on/, ""), handler);
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value: function (this: HTMLElement, name: string, handler: EventListener) {
      this.removeEventListener(name.replace(/^on/, ""), handler);
    },
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(doc().getElementById("root")!);
  queryClient.clear();
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/v1/bootstrap") return json(reviewBootstrap([issue]));
      if (path === "/api/v1/background-runs/current") return json({ run: null });
      if (path === "/api/v1/issues/issue-1") return json(reviewDetail(issue));
      throw new Error(`Unexpected API request: ${path}`);
    }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  dom.window.close();
  vi.unstubAllGlobals();
});

async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderApp() {
  await act(async () => root.render(createElement(OrbitApp, { initialSection: "home" })));
  await settled();
  await settled();
}

describe("mobile issue detail layout", () => {
  it("lets the issue detail title wrap without clipping", async () => {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(IssueDetailPanel, {
            issueId: issue.id,
            fallbackIssue: issue,
            knownIssues: [issue],
            projects: [],
            onUpdate: () => undefined,
            pending: false,
            workflowStates: [],
            onArchive: async () => undefined,
            onClose: () => undefined,
          }),
        ),
      ),
    );
    await settled();

    const title = doc().querySelector<HTMLTextAreaElement>("#issue-detail-title")!;
    expect(title).not.toBeNull();
    expect(title.tagName).toBe("TEXTAREA");
    expect(title.rows).toBe(1);
    expect(doc().querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe(
      "issue-detail-title",
    );
    // DOM 上のクラスに、折り返し・リサイズ無効の宣言が当たっている。
    expect(title.classList.contains("detail-title-input")).toBe(true);
    const styles = declarationsFor(rules, ".detail-title-input");
    expect(styles.get("overflow-wrap")).toBe("anywhere");
    expect(styles.get("resize")).toBe("none");
  });

  it("exposes Cycles in the mobile Menu sheet within a five-column bottom nav", async () => {
    await renderApp();
    expect(doc().querySelector(".mobile-nav")?.children).toHaveLength(5);
    expect(doc().querySelector(".mobile-menu-sheet")).toBeNull();

    await act(async () => doc().querySelector<HTMLButtonElement>(".mobile-menu-tab")!.click());
    const sheet = doc().querySelector('.mobile-menu-sheet[role="dialog"]')!;
    expect(sheet).not.toBeNull();
    expect(
      [...sheet.querySelectorAll(".nav-item")].map(
        (item) => item.querySelector("span:nth-child(2)")?.textContent,
      ),
    ).toContain("Cycles");

    expect(declarationsFor(rules, ".mobile-nav", MOBILE).get("grid-template-columns")).toBe(
      "repeat(5, 1fr)",
    );
    const everyMobileNavColumns = rules
      .filter((rule) => rule.selectors.includes(".mobile-nav"))
      .map((rule) => rule.declarations.get("grid-template-columns"));
    expect(everyMobileNavColumns).not.toContain("repeat(7, 1fr)");
  });

  it("[代表値/AC-8] filter sheet controls are mobile-only and desktop keeps the toolbar layout", () => {
    for (const selector of [
      ".filter-sheet-button",
      ".filter-field-label",
      ".filter-sheet-title",
      ".filter-sheet-done",
    ])
      expect(declarationsFor(rules, selector).get("display")).toBe("none");
    for (const selector of [".filter-fields-wrap", ".filter-fields", ".filter-field"])
      expect(declarationsFor(rules, selector).get("display")).toBe("contents");

    expect(declarationsFor(rules, ".filter-sheet-button", MOBILE).get("display")).toBe(
      "inline-flex",
    );
    expect(
      declarationsFor(rules, ".filter-fields.open .filter-field-label", MOBILE).get("display"),
    ).toBe("block");
    const sheet = declarationsFor(rules, ".filter-fields.open", MOBILE);
    expect(sheet.get("max-height")).toBe("80dvh");
    expect(sheet.get("padding")).toBe("18px 18px 0");
    expect(
      declarationsFor(rules, ".filter-fields.open .filter-sheet-done", MOBILE).get(
        "padding-bottom",
      ),
    ).toBe("env(safe-area-inset-bottom)");
    expect(
      declarationsFor(rules, ".filter-fields.open .filter-select", MOBILE).get("font-size"),
    ).toBe("16px");
  });

  it("[代表値] Menu sheet items keep one color in every state, the Done button is sticky, and the sheet respects the safe area", () => {
    expect(declarationsFor(rules, ".mobile-menu-sheet .nav-item:hover").get("color")).toBe(
      "var(--orbit-muted)",
    );
    for (const selector of [
      ".mobile-menu-sheet .nav-item.active",
      ".mobile-menu-sheet .nav-item.active:hover",
    ])
      expect(declarationsFor(rules, selector).get("color")).toMatch(/^var\(--orbit-accent-strong/);
    expect(declarationsFor(rules, ".mobile-menu-sheet").get("padding")).toBe(
      "10px 12px max(12px, env(safe-area-inset-bottom))",
    );
    const done = declarationsFor(rules, ".filter-fields.open .filter-sheet-done", MOBILE);
    expect(done.get("position")).toBe("sticky");
    expect(done.get("bottom")).toBe("0");
    expect(done.get("min-height")).toContain("env(safe-area-inset-bottom)");
  });

  it("[代表値] horizontal safe-area insets are applied to the shell, nav, toast, menu sheet and filter sheet", () => {
    const shell = declarationsFor(rules, ".app-shell");
    expect(shell.get("min-height")).toBe("100vh");
    expect(shell.get("display")).toBe("flex");
    expect(shell.get("background")).toBe("#f7f8fa");
    expect(shell.get("padding-left")).toBe("env(safe-area-inset-left)");
    expect(shell.get("padding-right")).toBe("env(safe-area-inset-right)");

    // shorthandの直後にlonghandで上書きする順序までセレクタ単位で固定する。
    const nav = rules.find(
      (rule) =>
        rule.media === MOBILE &&
        rule.selectors.includes(".mobile-nav") &&
        rule.declarations.has("padding"),
    )!;
    expect([...nav.declarations.keys()].filter((p) => p.startsWith("padding"))).toEqual([
      "padding",
      "padding-left",
      "padding-right",
    ]);
    expect(nav.declarations.get("padding")).toBe("7px 10px max(7px, env(safe-area-inset-bottom))");
    expect(nav.declarations.get("padding-left")).toBe("max(10px, env(safe-area-inset-left))");
    expect(nav.declarations.get("padding-right")).toBe("max(10px, env(safe-area-inset-right))");

    const toast = declarationsFor(rules, ".toast");
    expect(toast.get("right")).toBe("calc(24px + env(safe-area-inset-right))");
    expect(toast.get("bottom")).toBe("24px");
    const mobileToast = declarationsFor(rules, ".toast", MOBILE);
    expect(mobileToast.get("right")).toBe("max(14px, env(safe-area-inset-right))");
    expect(mobileToast.get("bottom")).toBe("calc(82px + env(safe-area-inset-bottom))");
    expect(mobileToast.get("left")).toBe("max(14px, env(safe-area-inset-left))");

    const menu = declarationsFor(rules, ".mobile-menu-sheet");
    expect(menu.get("padding-left")).toBe("max(12px, env(safe-area-inset-left))");
    expect(menu.get("padding-right")).toBe("max(12px, env(safe-area-inset-right))");

    const filter = declarationsFor(rules, ".filter-fields.open", MOBILE);
    expect(filter.get("padding")).toBe("18px 18px 0");
    expect(filter.get("padding-left")).toBe("max(18px, env(safe-area-inset-left))");
    expect(filter.get("padding-right")).toBe("max(18px, env(safe-area-inset-right))");
  });

  it("[同値分割] existing safe-area declarations remain", () => {
    expect(declarationsFor(rules, ".content-area", MOBILE).get("padding")).toBe(
      "28px 17px calc(94px + env(safe-area-inset-bottom))",
    );
    expect(declarationsFor(rules, ".mobile-nav", MOBILE).get("height")).toBe(
      "calc(70px + env(safe-area-inset-bottom))",
    );
    expect(declarationsFor(rules, ".modal-backdrop").get("padding")).toBe(
      "calc(var(--modal-gutter) + env(safe-area-inset-top)) calc(var(--modal-gutter) + env(safe-area-inset-right)) calc(var(--modal-gutter) + env(safe-area-inset-bottom)) calc(var(--modal-gutter) + env(safe-area-inset-left))",
    );
    for (const selector of [".issue-detail-backdrop", ".issue-composer-backdrop"])
      expect(declarationsFor(rules, selector, MOBILE).get("padding")).toBe(
        "0 env(safe-area-inset-right) 0 env(safe-area-inset-left)",
      );
    const done = declarationsFor(rules, ".filter-fields.open .filter-sheet-done", MOBILE);
    expect(done.get("min-height")).toBe("calc(48px + env(safe-area-inset-bottom))");
    expect(done.get("padding-bottom")).toBe("env(safe-area-inset-bottom)");
  });
});
