import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { declarationsFor, parseStyleRules, type StyleRule } from "./css-rules.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

// --- CSS: media × selector × property（parseStyleRules / declarationsFor）-------------------

const MOBILE = "(max-width: 767px)";
// ソース順を後勝ち判定（cascade）に使うため、rule に順序を付ける。
type OrderedRule = StyleRule & { order: number };
const allRules: OrderedRule[] = parseStyleRules().map((rule, order) => ({ ...rule, order }));

const mobileRules = allRules.filter((rule) => rule.media === MOBILE);
// トップレベル + 767px 以下にも適用される max-width 系 media。
// min-width を含む条件（767px 以下には適用されない）と reduced-motion は除く。
const baseRules = allRules.filter((rule) => {
  const media = rule.media;
  if (media === null) return true;
  if (media === MOBILE) return false;
  return !/min-width/.test(media) && !media.includes("prefers-reduced-motion");
});

const stripImportant = (value: string | undefined) => value?.replace(/\s*!important$/i, "").trim();
const isImportant = (value: string | undefined) => /!important$/i.test(value ?? "");

function px(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
  if (!match || (match[2] === undefined && Number(match[1]) !== 0)) return null;
  return Number(match[1]);
}

/** mobile ブロック内で selector（完全一致）に最後に宣言された property の値。 */
function mobileValue(selector: string, property: string): string | undefined {
  return stripImportant(declarationsFor(allRules, selector, MOBILE).get(property));
}

function mobilePx(selector: string, property: string): number {
  const value = px(mobileValue(selector, property));
  return value ?? Number.NaN;
}

// --- AC3 の例外リスト（短く・理由付き）--------------------------------------------------------

// sidebar は mobile で display:none（下のテストが機械検証する）。
const SIDEBAR_ONLY = [
  ".brand-version",
  ".workspace-avatar",
  ".user-card strong",
  ".user-card span",
] as const;

// font-size:0 でヘッダの "PRIORITY" 文字を畳み、アイコンのみの列にしている（視覚的に非表示）。
const COLLAPSED_HEADER_LABEL = [
  ".issue-table:not(.manual-order) .table-header .priority-cell",
  ".issue-table.manual-order .table-header .priority-cell",
] as const;

// font-size を宣言しているが、AC1 の `input, select, textarea, .orbit-select-trigger`
// 16px フロアで mobile では上書きされる要素。要素名で判定できないクラスのみ列挙する。
const CONTROL_CLASSES = [
  ".filter-select",
  ".text-input",
  ".detail-priority-select",
  ".detail-status-select",
  ".detail-textarea",
] as const;

function isFormControlSelector(selector: string): boolean {
  const last = selector.split(/[\s>+~]+/).at(-1) ?? "";
  if (/^(input|select|textarea)(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*$/.test(last)) return true;
  if (last.startsWith(".orbit-select-trigger")) return true;
  return CONTROL_CLASSES.some((name) => last === name);
}

function isHiddenOnMobile(selector: string): boolean {
  return mobileValue(selector, "display") === "none";
}

// --- DOM: Issue 一覧を OrbitApp 経由で描画する -------------------------------------------------

let dom: JSDOM;
let app: RenderedApp | undefined;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://orbit.example/" });
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
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/v1/bootstrap") return json(reviewBootstrap([reviewIssue("issue-1")]));
      if (path === "/api/v1/background-runs/current") return json({ run: null });
      throw new Error(`Unexpected API request: ${path}`);
    }),
  );
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.unstubAllGlobals();
});

describe("mobile readability baseline (<=767px)", () => {
  it("[境界値] mobileの入力欄は16px以上でiOSズームを防ぐ", () => {
    const floor = mobileRules.find(
      (rule) => rule.selectors.includes("input") && rule.selectors.includes("select"),
    );
    expect(floor).toBeDefined();
    expect(floor?.selectors).toEqual(
      expect.arrayContaining(["input", "select", "textarea", ".orbit-select-trigger"]),
    );
    const fontSize = floor?.declarations.get("font-size");
    expect(px(stripImportant(fontSize))).toBeGreaterThanOrEqual(16);
    // クラスセレクタの小さい font-size（例: .inline-search input 12px）に勝つための最終フロア。
    expect(isImportant(fontSize)).toBe(true);
  });

  it("[境界値] 16px入力でも期限入力が切れないよう幅を広げる", () => {
    const width = mobilePx(".due-cell .orbit-date-picker", "width");
    // 16px の日付文字(約100px) + 左右padding + カレンダーボタン用の右38px
    expect(width).toBeGreaterThanOrEqual(160);
  });

  it.each([
    [".icon-button"],
    [".search-trigger"],
    [".avatar"],
    [".view-toggle"],
    [".priority-control"],
    [".issue-table .check-cell"],
  ])("[境界値] mobileの %s は44x44px以上のタップ領域を持つ", (selector) => {
    expect(mobilePx(selector, "min-width")).toBeGreaterThanOrEqual(44);
    expect(mobilePx(selector, "min-height")).toBeGreaterThanOrEqual(44);
  });

  it.each([
    [".issue-table .status-cell select"],
    [".text-button"],
    [".detail-label-empty .text-button"],
    [".detail-actions .button"],
  ])("[境界値] mobileの %s は高さ44px以上", (selector) => {
    expect(mobilePx(selector, "min-height")).toBeGreaterThanOrEqual(44);
  });

  it("[境界値] mobileのIssue行はタップ領域を確保しつつ本文列を最大化する", () => {
    // grid 列幅（44px 以上）は responsive-layout.test.ts で固定している
    expect(mobilePx(".issue-table .issue-row", "padding-left")).toBe(0);
  });

  it("[代表値] 行チェックボックスはlabelでタップ領域を広げる", async () => {
    app = await renderApp({
      url: "/issues",
      container: dom.window.document.getElementById("root")!,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const checkCells = [...dom.window.document.querySelectorAll(".check-cell")];
    // ヘッダ（全選択）と Issue 行（選択）の 2 つが label で、チェックボックスを内包する。
    expect(checkCells.map((cell) => [cell.tagName, cell.getAttribute("role")])).toEqual([
      ["LABEL", "columnheader"],
      ["LABEL", "cell"],
    ]);
    expect(
      checkCells.map((cell) =>
        cell.querySelector('input[type="checkbox"]')?.getAttribute("aria-label"),
      ),
    ).toEqual(["全選択", "TASK-issue-1を選択"]);
  });

  it("[同値分割] mobileで12px未満のfont-sizeを宣言しない（例外は非表示化のみ）", () => {
    const offenders = mobileRules.flatMap((rule) => {
      const size = px(stripImportant(rule.declarations.get("font-size")));
      if (size === null || size >= 12) return [];
      return rule.selectors
        .filter((selector) => !(COLLAPSED_HEADER_LABEL as readonly string[]).includes(selector))
        .map((selector) => `${selector}: ${size}px`);
    });
    expect(offenders).toEqual([]);
  });

  it("[同値分割] 例外リストの前提（sidebar非表示・ヘッダ文字の畳み込み）が成立している", () => {
    expect(mobileValue(".sidebar", "display")).toBe("none");
    for (const selector of COLLAPSED_HEADER_LABEL) {
      expect(mobilePx(selector, "font-size")).toBe(0);
    }
  });

  it("[同値分割] desktopで12px未満の全セレクタが、mobileで12px以上へ上書きされるか例外に該当する", () => {
    const smallBaseRules = baseRules.filter(
      (rule) => (px(stripImportant(rule.declarations.get("font-size"))) ?? 12) < 12,
    );
    // パース失敗で列挙が空になり、無条件に pass するのを防ぐ
    expect(smallBaseRules.length).toBeGreaterThan(50);
    const uncovered: string[] = [];
    for (const rule of baseRules) {
      const declaration = rule.declarations.get("font-size");
      const size = px(stripImportant(declaration));
      if (size === null || size >= 12) continue;
      for (const selector of rule.selectors) {
        if ((SIDEBAR_ONLY as readonly string[]).includes(selector)) continue;
        if (isHiddenOnMobile(selector)) continue;
        if (isFormControlSelector(selector)) continue;
        const overrides = mobileRules.filter((other) => {
          const otherDeclaration = other.declarations.get("font-size");
          const otherSize = px(stripImportant(otherDeclaration));
          return (
            other.selectors.includes(selector) &&
            other.order > rule.order && // 後勝ちのcascadeで負けないよう base より後ろに置く
            otherSize !== null &&
            otherSize >= 12 &&
            (!isImportant(declaration) || isImportant(otherDeclaration))
          );
        });
        if (overrides.length === 0) uncovered.push(`${selector} (${size}px)`);
      }
    }
    expect([...new Set(uncovered)]).toEqual([]);
  });

  it.each([
    [".issue-main strong"],
    [".issue-card strong"],
    [".notification-copy strong"],
    [".search-result strong"],
    [".home-issue-main strong"],
    [".home-project-copy strong"],
    [".mini-issue strong"],
    [".timeline-row strong"],
    [".saved-view-row strong"],
    [".saved-view-select strong"],
    [".relation-target strong"],
    [".trash-row strong"],
    [".cycle-history-route strong"],
    [".description-preview"],
    [".note-body"],
    [".detail-actions .button"],
  ])("[境界値] mobileの主要テキスト %s は14px以上", (selector) => {
    expect(mobilePx(selector, "font-size")).toBeGreaterThanOrEqual(14);
  });

  it("[代表値] キーボードショートカットのヒントはmobileで非表示（検索トリガーのkbd規則を拡張）", () => {
    expect(mobileValue("kbd", "display")).toBe("none");
    expect(mobileValue(".search-trigger kbd", "display")).toBeUndefined();
    // ショートカット一覧モーダルのキー表示は内容そのものなので残し、12px以上にする。
    expect(mobileValue(".shortcut-row kbd", "display")).not.toBe("none");
    expect(mobilePx(".shortcut-row kbd", "font-size")).toBeGreaterThanOrEqual(12);
  });

  it("[代表値] 詳細アクションは破壊的操作を左端へ分離し、他の操作を右に残す", () => {
    expect(mobileValue(".detail-actions .button.danger", "order")).toBe("-1");
    expect(mobileValue(".detail-actions .button.danger", "margin-right")).toBe("auto");
    expect(mobileValue(".detail-actions", "justify-content")).toBe("flex-end");
    expect(mobileValue(".detail-actions", "flex-wrap")).toBe("wrap");
    expect(mobilePx(".detail-actions .button", "font-size")).toBe(14);
  });

  it("[代表値] 設定行のselectは行幅の55%までに収まり、ラベルを潰さない", () => {
    // Timezone の select は最長 option（419 件）の内容幅 295px になり、flex item の
    // min-width:auto で縮まずカードからはみ出していた。max-width が自動最小幅も抑える。
    expect(mobileValue(".setting-row > select", "max-width")).toBe("55%");
  });

  it("[境界値] 詳細アクションは保存状態をボタン間で縮ませて1行にし、2ボタンが320pxに収まる", () => {
    expect(mobileValue(".detail-save-status", "flex")).toBe("1 1 0");
    expect(mobileValue(".detail-save-status", "min-width")).toBe("0");
    expect(mobileValue(".detail-save-status", "margin-right")).toBe("0");
    expect(mobileValue(".detail-save-status:empty", "display")).toBe("none");
    // 320px - 左右padding 30px = 290px。ボタン最小幅の合計 + gap が収まること。
    const labelEm: Record<string, number> = {
      アーカイブ: 5,
      ゴミ箱へ: 4,
    };
    const padding =
      px(mobileValue(".detail-actions .button", "padding")?.split(" ")[1]) ?? Number.NaN;
    const fontSize = mobilePx(".detail-actions .button", "font-size");
    const gap = 8;
    const total =
      Object.values(labelEm).reduce((sum, chars) => sum + chars * fontSize + padding * 2, 0) +
      gap * (Object.keys(labelEm).length - 1);
    expect(total).toBeLessThanOrEqual(320 - 30);
  });
});
