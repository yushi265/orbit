import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

// --- minimal CSS parser (no dependency): top-level rules + one level of @media ---------------

type MediaKind = "base" | "mobile" | "desktop-only" | "ignored";
type Declaration = { value: string; important: boolean };
type Rule = {
  selector: string; // 1 selector (selector lists are split)
  declarations: Map<string, Declaration>;
  media: MediaKind;
  order: number; // source order (cascade tie-break)
};

function classifyMedia(condition: string): MediaKind {
  const normalized = condition.replace(/\s+/g, " ").trim();
  if (/^\(max-width: ?767px\)$/.test(normalized)) return "mobile";
  if (normalized.includes("prefers-reduced-motion")) return "ignored";
  // min-width: 768px 以上を含む条件は 767px 以下の画面には適用されない。
  if (/min-width/.test(normalized)) return "desktop-only";
  // max-width: 480/1023/1199/1280px は mobile にも適用されるため base と同じ扱い。
  return "base";
}

function parseDeclarations(body: string): Map<string, Declaration> {
  const declarations = new Map<string, Declaration>();
  for (const part of body.split(";")) {
    const index = part.indexOf(":");
    if (index === -1) continue;
    const property = part.slice(0, index).trim().toLowerCase();
    let value = part.slice(index + 1).trim();
    const important = /!\s*important$/i.test(value);
    value = value.replace(/!\s*important$/i, "").trim();
    if (property) declarations.set(property, { value, important });
  }
  return declarations;
}

function parseCss(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let order = 0;

  function skipBlock(from: number): number {
    let depth = 1;
    let cursor = from;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    return cursor;
  }

  function parseBlock(from: number, media: MediaKind, nested: boolean): number {
    let cursor = from;
    let prelude = "";
    while (cursor < css.length) {
      const char = css[cursor];
      if (char === "}") return cursor + 1;
      if (char !== "{") {
        prelude += char;
        cursor += 1;
        continue;
      }
      const head = prelude.trim();
      prelude = "";
      if (head.startsWith("@media") && !nested) {
        cursor = parseBlock(cursor + 1, classifyMedia(head.slice("@media".length)), true);
      } else if (head.startsWith("@")) {
        cursor = skipBlock(cursor + 1); // @keyframes など
      } else {
        const end = css.indexOf("}", cursor);
        const declarations = parseDeclarations(css.slice(cursor + 1, end));
        for (const selector of head.split(",")) {
          rules.push({
            selector: selector.replace(/\s+/g, " ").trim(),
            declarations,
            media,
            order: order++,
          });
        }
        cursor = end + 1;
      }
    }
    return cursor;
  }

  parseBlock(0, "base", false);
  return rules;
}

const rules = parseCss(styles);
const mobileRules = rules.filter((rule) => rule.media === "mobile");

function px(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
  if (!match || (match[2] === undefined && Number(match[1]) !== 0)) return null;
  return Number(match[1]);
}

/** mobile ブロック内で selector（完全一致）に最後に宣言された property の値。 */
function mobileValue(selector: string, property: string): string | undefined {
  const matched = mobileRules
    .filter((rule) => rule.selector === selector && rule.declarations.has(property))
    .sort((a, b) => a.order - b.order);
  return matched.at(-1)?.declarations.get(property)?.value;
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

describe("mobile readability baseline (<=767px)", () => {
  it("[境界値] mobileの入力欄は16px以上でiOSズームを防ぐ", () => {
    const floor = mobileRules.find(
      (rule) =>
        rule.selector === "input" &&
        mobileRules.some(
          (other) => other.declarations === rule.declarations && other.selector === "select",
        ),
    );
    expect(floor).toBeDefined();
    const selectors = mobileRules
      .filter((rule) => rule.declarations === floor?.declarations)
      .map((rule) => rule.selector);
    expect(selectors).toEqual(
      expect.arrayContaining(["input", "select", "textarea", ".orbit-select-trigger"]),
    );
    const fontSize = floor?.declarations.get("font-size");
    expect(px(fontSize?.value)).toBeGreaterThanOrEqual(16);
    // クラスセレクタの小さい font-size（例: .inline-search input 12px）に勝つための最終フロア。
    expect(fontSize?.important).toBe(true);
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

  it("[代表値] 行チェックボックスはlabelでタップ領域を広げる", () => {
    const app = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");
    expect(app.match(/<label className="check-cell">/g)).toHaveLength(2);
    expect(app).not.toContain('<span className="check-cell">');
  });

  it("[同値分割] mobileで12px未満のfont-sizeを宣言しない（例外は非表示化のみ）", () => {
    const offenders = mobileRules.flatMap((rule) => {
      const size = px(rule.declarations.get("font-size")?.value);
      if (size === null || size >= 12) return [];
      if ((COLLAPSED_HEADER_LABEL as readonly string[]).includes(rule.selector)) return [];
      return [`${rule.selector}: ${size}px`];
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
    const baseRules = rules.filter((rule) => rule.media === "base");
    const smallBaseRules = baseRules.filter(
      (rule) => (px(rule.declarations.get("font-size")?.value) ?? 12) < 12,
    );
    // パース失敗で列挙が空になり、無条件に pass するのを防ぐ
    expect(smallBaseRules.length).toBeGreaterThan(50);
    const uncovered: string[] = [];
    for (const rule of baseRules) {
      const declaration = rule.declarations.get("font-size");
      const size = px(declaration?.value);
      if (size === null || size >= 12) continue;
      const selector = rule.selector;
      if ((SIDEBAR_ONLY as readonly string[]).includes(selector)) continue;
      if (isHiddenOnMobile(selector)) continue;
      if (isFormControlSelector(selector)) continue;
      const overrides = mobileRules.filter(
        (other) =>
          other.selector === selector &&
          other.order > rule.order && // 後勝ちのcascadeで負けないよう base より後ろに置く
          px(other.declarations.get("font-size")?.value) !== null &&
          (px(other.declarations.get("font-size")?.value) ?? 0) >= 12 &&
          (!declaration?.important || other.declarations.get("font-size")?.important),
      );
      if (overrides.length === 0) uncovered.push(`${selector} (${size}px)`);
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

  it("[境界値] 詳細アクションは保存状態を別行にし、3ボタンが320pxに収まる", () => {
    expect(mobileValue(".detail-save-status", "flex")).toBe("0 0 100%");
    expect(mobileValue(".detail-save-status", "margin-right")).toBe("0");
    expect(mobileValue(".detail-save-status:empty", "display")).toBe("none");
    // 320px - 左右padding 30px = 290px。ボタン最小幅の合計 + gap が収まること。
    const labelEm: Record<string, number> = {
      閉じる: 3,
      アーカイブ: 5,
      ゴミ箱へ: 4,
    };
    const padding =
      px(mobileValue(".detail-actions .button", "padding")?.split(" ")[1]) ?? Number.NaN;
    const fontSize = mobilePx(".detail-actions .button", "font-size");
    const gap = 8;
    const total =
      Object.values(labelEm).reduce((sum, chars) => sum + chars * fontSize + padding * 2, 0) +
      gap * 2;
    expect(total).toBeLessThanOrEqual(320 - 30);
  });
});
