import { describe, expect, it } from "vitest";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";

const source = `
/* comment { not: a rule; } */
.a, .b > .c { color: red; padding: 0 4px; }
.a { color: blue; }
@media (max-width: 767px) { .a { color: green; } .b   >   .c { margin: 0; } }
@keyframes spin { from { opacity: 0; } to { opacity: 1; } }
`;

describe("css rule helper", () => {
  const rules = parseStyleRules(source);

  it("[代表値] selector list を分解し、トップレベルの宣言を後勝ちでマージする", () => {
    expect(Object.fromEntries(declarationsFor(rules, ".a"))).toEqual({
      color: "blue",
      padding: "0 4px",
    });
  });

  it("[同値分割] media を指定するとその media 内の宣言だけを返す", () => {
    expect(declarationsFor(rules, ".a", "(max-width: 767px)").get("color")).toBe("green");
    expect(declarationsFor(rules, ".a").get("color")).toBe("blue");
  });

  it("[代表値] selector の空白差は正規化して比較する", () => {
    expect(declarationsFor(rules, ".b > .c", "(max-width: 767px)").get("margin")).toBe("0");
    expect(declarationsFor(rules, ".b>.c").get("color")).toBe("red");
  });

  it("[代表値] media の空白差も正規化して比較する", () => {
    const compact = parseStyleRules(
      "@media (max-width:767px)  and (min-width:  1px) { .a { color: red; } }",
    );
    expect(
      declarationsFor(compact, ".a", "(max-width: 767px) and (min-width: 1px)").get("color"),
    ).toBe("red");
  });

  it("[境界値] 該当なし・@keyframes 内の宣言は空として扱う", () => {
    expect(declarationsFor(rules, ".missing").size).toBe(0);
    expect(declarationsFor(rules, "from").size).toBe(0);
  });

  it("[代表値] 引数なしでは src/styles.css を読む", () => {
    expect(parseStyleRules().length).toBeGreaterThan(100);
  });
});
