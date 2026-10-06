import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPanel } from "./OrbitApp";
import { reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router")),
  Link: ({ children }: { children?: unknown }) => createElement("a", null, children as never),
  useRouter: () => ({ navigate: vi.fn() }),
}));

// --- minimal CSS model: cascade by !important, specificity, order -------------------------------

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
type CssRule = { selector: string; decl: Map<string, string>; media: string; order: number };

function parseCss(source: string): CssRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssRule[] = [];
  let order = 0;
  function block(text: string, media: string) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth += 1;
        if (text[j] === "}") depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@media")) {
        block(body, head.slice(6).replace(/\s+/g, " ").trim());
      } else if (!head.startsWith("@")) {
        const decl = new Map<string, string>();
        for (const part of body.split(";")) {
          const k = part.indexOf(":");
          if (k > 0) decl.set(part.slice(0, k).trim(), part.slice(k + 1).trim());
        }
        for (const selector of head.split(",")) {
          out.push({ selector: selector.replace(/\s+/g, " ").trim(), decl, media, order: order++ });
        }
      }
      i = j;
    }
  }
  block(css, "");
  return out;
}
const rules = parseCss(styles);

function specificity(selector: string): number {
  const probe = selector;
  const ids = (probe.match(/#[\w-]+/g) ?? []).length;
  const classes = (probe.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (
    probe.replace(/\[[^\]]*\]|[.#:][\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []
  ).length;
  return ids * 10000 + classes * 100 + types;
}

const PC = "";
const MOBILE = "(max-width: 767px)";

/** Resolved declaration for an element: !important, then specificity, then source order. */
function resolveDecl(el: Element, property: string, viewport: "pc" | "mobile"): string | undefined {
  const applicable = rules
    .filter((rule) => rule.decl.has(property))
    .filter((rule) => rule.media === PC || (viewport === "mobile" && rule.media === MOBILE))
    .filter((rule) => {
      try {
        return el.matches(rule.selector);
      } catch {
        return false;
      }
    })
    .map((rule) => {
      const value = rule.decl.get(property)!;
      return { rule, value, important: /!important/.test(value) };
    })
    .sort(
      (a, b) =>
        Number(a.important) - Number(b.important) ||
        specificity(a.rule.selector) - specificity(b.rule.selector) ||
        a.rule.order - b.rule.order,
    );
  return applicable.at(-1)?.value.replace(/\s*!important/, "");
}

// --- jsdom harness -----------------------------------------------------------------------------

let dom: JSDOM;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/issues" });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(name, value);
  for (const [method, target] of [
    ["attachEvent", "addEventListener"],
    ["detachEvent", "removeEventListener"],
  ] as const)
    Object.defineProperty(dom.window.HTMLElement.prototype, method, {
      value: function (this: HTMLElement, name: string, handler: EventListener) {
        this[target](name.replace(/^on/, ""), handler);
      },
    });
  root = createRoot(dom.window.document.getElementById("root")!);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => ({
      ok: true,
      status: 200,
      json: async () => (path === "/api/v1/issues/issue-1" ? reviewDetail() : {}),
    })),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  dom.window.close();
  vi.unstubAllGlobals();
});

async function renderDetail() {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(IssueDetailPanel, {
          issueId: "issue-1",
          fallbackIssue: reviewIssue(),
          knownIssues: [reviewIssue()],
          projects: [],
          workflowStates: [],
          pending: false,
          onUpdate: () => undefined,
          onArchive: async () => undefined,
          onClose: () => undefined,
        }),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

function controls() {
  const panel = dom.window.document.querySelector(".detail-panel")!;
  return [...panel.querySelectorAll("select, input[type='date']")];
}
const label = (el: Element) => `${el.tagName.toLowerCase()}.${el.className}`;

describe("FIX-detail-select-size Issue詳細モーダルのコントロール寸法", () => {
  it("[代表値] 対象はselect7個とDue dateの計8個がモーダル内に描画される", async () => {
    await renderDetail();
    const all = controls();
    expect(all.filter((el) => el.tagName === "SELECT")).toHaveLength(7);
    expect(all.filter((el) => el.tagName === "INPUT")).toHaveLength(1);
  });

  it("[同値分割] PC: 全8コントロールが height 36px / font-size 12px / radius 7px / 左右padding同一(Dueの右は除く)", async () => {
    await renderDetail();
    for (const el of controls()) {
      const name = label(el);
      expect(resolveDecl(el, "height", "pc"), `${name} height`).toBe("36px");
      expect(resolveDecl(el, "min-height", "pc"), `${name} min-height`).toBe("36px");
      expect(resolveDecl(el, "font-size", "pc"), `${name} font-size`).toBe("12px");
      expect(resolveDecl(el, "border-radius", "pc"), `${name} radius`).toBe("7px");
      expect(resolveDecl(el, "box-sizing", "pc") ?? "border-box", `${name} box`).toBe("border-box");
      if (el.tagName === "SELECT") {
        expect(resolveDecl(el, "padding-left", "pc"), `${name} pl`).toBe("10px");
        expect(resolveDecl(el, "padding-right", "pc"), `${name} pr`).toBe("10px");
      } else {
        expect(resolveDecl(el, "padding-left", "pc")).toBe("10px");
      }
    }
  });

  it("[同値分割] モバイル: 全8コントロールが height 44px / font-size 16px", async () => {
    await renderDetail();
    for (const el of controls()) {
      const name = label(el);
      expect(resolveDecl(el, "height", "mobile"), `${name} height`).toBe("44px");
      expect(resolveDecl(el, "min-height", "mobile"), `${name} min-height`).toBe("44px");
      expect(resolveDecl(el, "font-size", "mobile"), `${name} font-size`).toBe("16px");
    }
  });

  it("[代表値] Due dateの右paddingはカレンダーアイコン分38pxが残る", async () => {
    await renderDetail();
    const date = dom.window.document.querySelector(".detail-panel input[type='date']")!;
    expect(resolveDecl(date, "padding-right", "pc")).toBe("38px");
    expect(resolveDecl(date, "padding-right", "mobile")).toBe("38px");
  });

  it("[代表値] Issue一覧の .priority-cell select は巻き込まれない(従来のpadding/radius/font-size)", () => {
    const list = new dom.window.DOMParser().parseFromString(
      "<div class='priority-cell'><select></select></div>",
      "text/html",
    );
    const select = list.querySelector(".priority-cell select")!;
    expect(resolveDecl(select, "height", "pc")).toBeUndefined();
    expect(resolveDecl(select, "padding", "pc")).toBe("4px 18px 4px 7px");
    expect(resolveDecl(select, "border-radius", "pc")).toBe("6px");
    expect(resolveDecl(select, "font-size", "pc")).toBe("10px");
  });

  it("[代表値] モーダル外の .filter-select と一覧のDue dateは巻き込まれない(従来のheight/radius/font-size)", () => {
    const list = new dom.window.DOMParser().parseFromString(
      "<select class='filter-select'></select><div class='due-cell'><input type='date'></div>",
      "text/html",
    );
    const filter = list.querySelector(".filter-select")!;
    expect(resolveDecl(filter, "height", "pc")).toBeUndefined();
    expect(resolveDecl(filter, "border-radius", "pc")).toBe("8px");
    expect(resolveDecl(filter, "font-size", "pc")).toBe("11px");
    const due = list.querySelector(".due-cell input")!;
    expect(resolveDecl(due, "height", "pc")).toBeUndefined();
    expect(resolveDecl(due, "min-height", "pc")).toBe("36px");
    expect(resolveDecl(due, "font-size", "pc")).toBe("11px");
  });

  it("[代表値] 寸法統一ルールは寸法系プロパティだけを持ち、配色・幅には触れない", () => {
    const allowed = new Set([
      "box-sizing",
      "height",
      "min-height",
      "padding-block",
      "padding-left",
      "padding-right",
      "border-radius",
      "font-size",
    ]);
    const sizing = rules.filter((rule) =>
      [".detail-panel select", '.detail-panel input[type="date"]'].includes(rule.selector),
    );
    expect(sizing.length).toBeGreaterThan(0);
    for (const rule of sizing) {
      for (const property of rule.decl.keys()) {
        expect(allowed.has(property), `${rule.selector} { ${property} }`).toBe(true);
      }
    }
  });
});
