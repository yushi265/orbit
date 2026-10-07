import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";

// CSS を整形済みの文字列ではなく「media × selector × property」で検証するためのテスト用 helper。
// 整形・並び替え・ファイル分割をしても意味が同じならテストが壊れないようにする。

export type StyleRule = {
  media: string | null;
  selectors: string[];
  declarations: Map<string, string>;
};

const normalizeSelector = (selector: string) =>
  selector
    .trim()
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .replace(/\s+/g, " ");

// media は postcss の params 表記ゆれ（コロン後・連続空白）を吸収して "(max-width: 767px)" 形式にそろえる。
const normalizeMedia = (media: string) =>
  media
    .trim()
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s+/g, " ");

export function parseStyleRules(
  source = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8"),
): StyleRule[] {
  const rules: StyleRule[] = [];
  postcss.parse(source).walkRules((rule) => {
    const parent = rule.parent;
    let media: string | null = null;
    if (parent?.type === "atrule") {
      const atRule = parent as postcss.AtRule;
      if (atRule.name !== "media") return;
      media = normalizeMedia(atRule.params);
    }
    const declarations = new Map<string, string>();
    rule.walkDecls((decl) => {
      declarations.set(decl.prop, decl.important ? `${decl.value} !important` : decl.value);
    });
    rules.push({ media, selectors: rule.selectors.map(normalizeSelector), declarations });
  });
  return rules;
}

// 指定 selector に当たる宣言をソース順に後勝ちでマージする。media 省略時はトップレベルだけを見る。
export function declarationsFor(
  rules: StyleRule[],
  selector: string,
  media: string | null = null,
): Map<string, string> {
  const target = { selector: normalizeSelector(selector), media: media && normalizeMedia(media) };
  const merged = new Map<string, string>();
  for (const rule of rules) {
    if (rule.media !== target.media || !rule.selectors.includes(target.selector)) continue;
    for (const [prop, value] of rule.declarations) merged.set(prop, value);
  }
  return merged;
}
