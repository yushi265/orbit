import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPanel, ViewsView } from "./OrbitApp";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";
import type { SavedViewViewModel } from "../shared/view-models";

vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router")),
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
  useRouter: () => ({ navigate: vi.fn() }),
}));

// --- minimal CSS model: base rules and @media blocks, enough to resolve declarations ---------

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
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (
    selector.replace(/\[[^\]]*\]|[.#:][\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []
  ).length;
  return ids * 10000 + classes * 100 + types;
}

/** Declarations that apply (selector order, then specificity) in the given media condition. */
function baseRulesFor(property: string, filter: (rule: CssRule) => boolean) {
  return rules.filter((rule) => rule.media === "" && rule.decl.has(property) && filter(rule));
}
function mediaRules(media: string, selector: string, property: string) {
  return rules.filter(
    (rule) => rule.media === media && rule.selector === selector && rule.decl.has(property),
  );
}
const lastValue = (list: CssRule[], property: string) =>
  list
    .sort((a, b) => a.order - b.order)
    .at(-1)
    ?.decl.get(property);

// --- jsdom harness ---------------------------------------------------------------------------

let dom: JSDOM;
let root: Root;
let client: QueryClient;
let onClose: ReturnType<typeof vi.fn>;
let onArchive: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><button id='opener'>開く</button><div id='root'></div>", {
    url: "https://orbit.example/issues",
  });
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
  (dom.window.document.getElementById("opener") as HTMLButtonElement).focus();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onClose = vi.fn();
  onArchive = vi.fn(async () => undefined);
  fetchMock = vi.fn(async (path: string) => ({
    ok: true,
    status: 200,
    json: async () => (path === "/api/v1/issues/issue-1" ? reviewDetail() : {}),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  dom.window.close();
  vi.unstubAllGlobals();
});

const doc = () => dom.window.document;
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
          onArchive,
          onClose,
        }),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("AC-1 Issue詳細の初期フォーカス", () => {
  it("[代表値] 開いた直後のFocusはdialog自身で、タイトルにも他の操作要素にも当たらない", async () => {
    await renderDetail();
    const dialog = doc().querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    expect(doc().activeElement).toBe(dialog);
    expect(doc().activeElement?.id).not.toBe("issue-detail-title");
    expect(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]).not.toContain(doc().activeElement?.tagName);
  });

  it("[状態遷移] dialog自身にFocusがある状態のShift+Tabは最後の操作要素へ巡回する", async () => {
    await renderDetail();
    const dialog = doc().querySelector('[role="dialog"]') as HTMLElement;
    const items = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]",
      ),
    ];
    await act(async () => {
      dialog.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(doc().activeElement).toBe(items.at(-1));
  });
});

describe("AC-2 Issue詳細のカラム構成", () => {
  it("[代表値] 本文が先でプロパティ群は後続のasideに入り（DOM順=PCの視覚順）、本文側には入らない", async () => {
    await renderDetail();
    const grid = doc().querySelector(".detail-grid") as HTMLElement;
    const main = grid.children[0] as HTMLElement;
    const side = grid.children[1] as HTMLElement;
    expect(side.tagName).toBe("ASIDE");
    expect(main.classList.contains("detail-main")).toBe(true);
    for (const selector of [
      ".detail-properties",
      ".detail-priority-select",
      ".detail-status-select",
      ".detail-property-editor",
      ".detail-label-editor",
      ".issue-parent-editor",
    ]) {
      expect(side.querySelector(selector), selector).not.toBeNull();
      expect(main.querySelector(selector), `main ${selector}`).toBeNull();
    }
  });

  it("[代表値] 本文は 説明 → 作業メモ → Sub-issue → 関連Issue → 変更履歴 の順で、変更履歴は最後のsection", async () => {
    await renderDetail();
    const main = doc().querySelector(".detail-grid > .detail-main") as HTMLElement;
    const order = [
      "#issue-description",
      ".note-compose",
      ".issue-hierarchy",
      ".relation-compose",
      ".detail-activity",
    ].map((selector) => main.querySelector(selector));
    order.forEach((element, index) => {
      expect(element, String(index)).not.toBeNull();
      if (index > 0) {
        expect(
          order[index - 1]!.compareDocumentPosition(element!) &
            dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });
    const last = main.lastElementChild as HTMLElement;
    expect(last.tagName).toBe("SECTION");
    expect(last.classList.contains("detail-activity")).toBe(true);
    expect(last.classList.contains("detail-section")).toBe(true);
    expect(doc().querySelector("aside.detail-activity")).toBeNull();
    expect(last.querySelector(".activity-list")).not.toBeNull();
  });

  it("[境界値] 変更履歴は左ボーダー・左パディングを持たず、768px以上で右カラムにaside・左に本文を置く", () => {
    for (const rule of rules.filter((item) => item.selector === ".detail-activity")) {
      expect(rule.decl.get("border-left") ?? "0").toMatch(/^(0|none)/);
      expect(rule.decl.get("padding-left") ?? "0").toMatch(/^0/);
    }
    // PC は DOM 順どおり（main=1列目 / side=2列目）。視覚順を入れ替える指定を持たない。
    for (const rule of rules.filter((item) => /\.detail-(side|main|grid)\b/.test(item.selector))) {
      if (rule.media.includes("min-width")) {
        for (const property of ["grid-column", "grid-row", "order"])
          expect(rule.decl.has(property), `${rule.selector} ${property}`).toBe(false);
      }
    }
    for (const rule of rules.filter((item) => item.selector.includes(".detail-main")))
      expect(rule.decl.has("order")).toBe(false);
  });

  it("[境界値] 右カラムの入力は幅いっぱいに縦積みされ、スマホは1カラムのまま", () => {
    expect(
      lastValue(
        baseRulesFor("flex-direction", (r) => r.selector === ".detail-side .detail-properties"),
        "flex-direction",
      ),
    ).toBe("column");
    expect(
      lastValue(
        baseRulesFor("min-width", (r) => r.selector === ".detail-side"),
        "min-width",
      ),
    ).toBe("0");
    // スマホは縦1カラムのまま、sideを視覚上先頭（プロパティ → 本文）に出す。
    const mobile = "(max-width: 767px)";
    expect(lastValue(mediaRules(mobile, ".detail-grid", "display"), "display")).toBe("flex");
    expect(lastValue(mediaRules(mobile, ".detail-grid", "flex-direction"), "flex-direction")).toBe(
      "column",
    );
    expect(lastValue(mediaRules(mobile, ".detail-grid", "gap"), "gap")).toBe("0");
    expect(lastValue(mediaRules(mobile, ".detail-grid > .detail-side", "order"), "order")).toBe(
      "-1",
    );
  });
});

describe("AC-3 アクションの固定フッター", () => {
  it("[代表値] .detail-panelの最後の子はfooter.detail-footで、その中にアクション行（ステータス・アーカイブ・ゴミ箱へ）があり、閉じるボタンは無い", async () => {
    await renderDetail();
    const panel = doc().querySelector(".detail-panel") as HTMLElement;
    const foot = panel.lastElementChild as HTMLElement;
    expect(foot.tagName).toBe("FOOTER");
    expect(foot.classList.contains("detail-foot")).toBe(true);
    expect(panel.querySelectorAll("footer")).toHaveLength(1);
    const actions = foot.querySelector(":scope > .detail-actions") as HTMLElement;
    expect(actions).not.toBeNull();
    expect(actions.querySelector(".detail-save-status")?.getAttribute("aria-live")).toBe("polite");
    const labels = [...actions.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["アーカイブ", "ゴミ箱へ"]);
    const allButtons = [...panel.querySelectorAll("button")].map((button) => button.textContent);
    expect(allButtons).not.toContain("閉じる");
    expect(doc().querySelector('[aria-label="Issue詳細を閉じる"]')).not.toBeNull();
    expect(foot.querySelector(".detail-live-error")).toBeNull();
  });

  it("[状態遷移] 失敗時のエラー帯(role=alert)はfooter内でアクション行の直前に積まれる", async () => {
    onArchive.mockRejectedValueOnce(new Error("boom"));
    await renderDetail();
    const archive = [...doc().querySelectorAll(".detail-actions button")].find(
      (button) => button.textContent === "アーカイブ",
    ) as HTMLButtonElement;
    await act(async () => archive.click());
    const foot = doc().querySelector(".detail-panel")!.lastElementChild as HTMLElement;
    const alert = foot.querySelector(".detail-live-error") as HTMLElement;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.nextElementSibling).toBe(foot.querySelector(".detail-actions"));
    expect(doc().querySelectorAll(".detail-panel > .detail-live-error")).toHaveLength(0);
  });

  it("[代表値] アーカイブはonArchiveを呼び閉じる", async () => {
    await renderDetail();
    const archive = [...doc().querySelectorAll(".detail-actions button")].find(
      (button) => button.textContent === "アーカイブ",
    ) as HTMLButtonElement;
    await act(async () => archive.click());
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("[代表値] ゴミ箱へは確認後にtrashを要求して閉じる", async () => {
    vi.stubGlobal("confirm", () => true);
    (dom.window as unknown as { confirm: () => boolean }).confirm = () => true;
    await renderDetail();
    const trash = [...doc().querySelectorAll(".detail-actions button")].find(
      (button) => button.textContent === "ゴミ箱へ",
    ) as HTMLButtonElement;
    await act(async () => trash.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain(
      "/api/v1/issues/issue-1?action=trash",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("[境界値] footer.detail-footのstickyは全幅で効き、パネル幅いっぱい・不透明背景。エラー帯は固定オフセットを持たない", () => {
    const base = (property: string) =>
      lastValue(
        baseRulesFor(property, (r) => r.selector === ".detail-foot"),
        property,
      );
    expect(base("position")).toBe("sticky");
    expect(base("bottom")).toBe("0");
    expect(base("margin")).toMatch(/-24px/);
    expect(base("border-top")).toMatch(/^1px solid/);
    expect(base("background")).toContain("var(--orbit-surface, #fff)");
    // popups (calendar 80 / select listbox 110) stay above the footer
    expect(Number(base("z-index"))).toBeGreaterThan(0);
    expect(Number(base("z-index"))).toBeLessThan(80);
    expect(
      lastValue(
        baseRulesFor("display", (r) => r.selector === ".detail-foot:empty"),
        "display",
      ),
    ).toBe("none");
    expect(
      lastValue(
        baseRulesFor("position", (r) => r.selector === ".detail-foot > .detail-live-error"),
        "position",
      ),
    ).toBe("static");
    expect(rules.filter((r) => r.selector === ".detail-panel > .detail-live-error")).toEqual([]);
    expect(styles).not.toMatch(/bottom: (calc\()?72px/);
    expect(
      lastValue(
        baseRulesFor("position", (r) => r.selector === ".detail-actions"),
        "position",
      ),
    ).toBeUndefined();
  });

  it("[境界値] スマホのフッターはゴミ箱へ/ステータス/アーカイブが1行に収まる（ステータスは縮む）", () => {
    const mobile = "(max-width: 767px)";
    expect(lastValue(mediaRules(mobile, ".detail-save-status", "flex"), "flex")).toBe("1 1 0");
    expect(lastValue(mediaRules(mobile, ".detail-save-status", "min-width"), "min-width")).toBe(
      "0",
    );
    expect(lastValue(mediaRules(mobile, ".detail-actions .button.danger", "order"), "order")).toBe(
      "-1",
    );
  });

  it("[境界値] パネルの下パディングはフッター側へ移り、スマホはsafe-areaをフッターに含める", () => {
    expect(
      lastValue(
        baseRulesFor("padding", (r) => r.selector === ".detail-panel"),
        "padding",
      ),
    ).toBe("0 24px 0");
    const mobile = "(max-width: 767px)";
    expect(lastValue(mediaRules(mobile, ".detail-panel", "padding"), "padding")).toBe("0 15px 0");
    expect(
      lastValue(
        mediaRules(mobile, ".issue-detail-backdrop .detail-panel", "padding-bottom"),
        "padding-bottom",
      ),
    ).toBe("0");
    expect(lastValue(mediaRules(mobile, ".detail-actions", "padding"), "padding")).toContain(
      "env(safe-area-inset-bottom)",
    );
  });
});

describe("AC-4 Views画面", () => {
  const query = {
    mode: "list" as const,
    filter: {},
    group: undefined,
    layout: {},
    showEmptyGroups: true,
    order: "updated",
    limit: 7,
  };
  const view = {
    id: "view-1",
    userId: "owner",
    name: "今週やること",
    query,
    layout: query.layout,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as SavedViewViewModel;
  async function renderViews() {
    await act(async () =>
      root.render(
        createElement(ViewsView, {
          views: [view],
          data: reviewBootstrap([reviewIssue("a")]),
          selectedViewId: view.id,
          onSelectView: vi.fn(),
          onOpenIssue: vi.fn(),
          onRefresh: vi.fn(),
          now: Date.UTC(2026, 9, 3),
        }),
      ),
    );
  }

  it("[代表値] DOM順は 見出し → View一覧 → inspector → 結果、View一覧はdetail-card", async () => {
    await renderViews();
    const list = doc().querySelector(".view-list") as HTMLElement;
    const inspector = doc().querySelector(".view-inspector") as HTMLElement;
    const results = doc().querySelector(".view-results") as HTMLElement;
    const heading = doc().querySelector(".page-heading") as HTMLElement;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(heading, list)).toBe(true);
    expect(follows(list, inspector)).toBe(true);
    expect(follows(inspector, results)).toBe(true);
    expect(list.classList.contains("detail-card")).toBe(true);
    expect(results.getAttribute("aria-label")).toBe("今週やることのIssue");
  });

  it("[境界値] 3つのカードは同じ850px幅で、結果カードはinspectorと同じ18px 20pxのパディング・スマホは18px", () => {
    const base = (selector: string, property: string) =>
      lastValue(
        baseRulesFor(property, (r) => r.selector === selector),
        property,
      );
    for (const selector of [".view-list", ".view-inspector", ".view-results"])
      expect(base(selector, "max-width"), selector).toBe("850px");
    expect(base(".view-results", "padding")).toBe("18px 20px");
    expect(base(".view-inspector", "padding")).toBe("18px 20px");
    expect(lastValue(mediaRules("(max-width: 767px)", ".view-results", "padding"), "padding")).toBe(
      "18px",
    );
  });

  it("[境界値] 結果の見出しは16px・sans、行タイトルは13〜14px", () => {
    const base = (selector: string, property: string) =>
      lastValue(
        baseRulesFor(property, (r) => r.selector === selector),
        property,
      );
    expect(base(".view-results h2", "font-size")).toBe("16px");
    expect(base(".view-results h2", "font-family")).toContain("ui-sans-serif");
    expect(["13px", "14px"]).toContain(base(".saved-view-issue-main strong", "font-size"));
    expect(base(".view-result-group h3", "margin")).toBeDefined();
  });

  it("[代表値] 空状態の文言は結果カード内に収まる", async () => {
    await act(async () =>
      root.render(
        createElement(ViewsView, {
          views: [view],
          data: reviewBootstrap([]),
          selectedViewId: view.id,
          onSelectView: vi.fn(),
          onOpenIssue: vi.fn(),
          onRefresh: vi.fn(),
          now: Date.UTC(2026, 9, 3),
        }),
      ),
    );
    expect(doc().querySelector(".view-results [role='status']")?.textContent).toContain(
      "条件に一致するIssueはありません",
    );
  });
});

describe("AC-5 設定のカラーテーマswatch", () => {
  it("[境界値] setting-row配下の.color-theme-controlのdisplayはflex系に解決され、丸が横に並ぶ", () => {
    const host = new JSDOM(
      '<div class="setting-row"><div></div><span class="color-theme-control"><span class="color-theme-swatch"></span><select></select></span></div>',
    );
    const control = host.window.document.querySelector(".color-theme-control")!;
    const applicable = rules
      .filter((rule) => rule.media === "" && rule.decl.has("display"))
      .filter((rule) => {
        try {
          return control.matches(rule.selector);
        } catch {
          return false;
        }
      })
      .sort((a, b) => specificity(a.selector) - specificity(b.selector) || a.order - b.order);
    const winner = applicable.at(-1)!;
    expect(winner.decl.get("display")).toMatch(/flex/);
    const flexRules = rules.filter(
      (rule) => rule.media === "" && rule.selector.includes(".color-theme-control"),
    );
    expect(flexRules.map((rule) => rule.decl.get("align-items"))).toContain("center");
    expect(flexRules.map((rule) => rule.decl.get("gap"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^[78]px$/)]),
    );
    expect(styles).not.toMatch(/\.color-theme-control[^}]*!important/);
  });
});
