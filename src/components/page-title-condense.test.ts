import { describe, expect, it } from "vitest";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";

// 見出し凝縮: スマホでもページ名を上部バーに出す（パンくずはスマホで非表示だった）。
const rules = parseStyleRules();
const MOBILE = "(max-width: 767px)";

describe("見出し凝縮 CSS", () => {
  it("[代表値] スマホ幅でも上部バーのページ名を隠さず、少し小さく出す", () => {
    expect(declarationsFor(rules, ".topbar-title").get("font-size")).toBe("20px");
    expect(declarationsFor(rules, ".topbar-title", MOBILE).get("display")).toBeUndefined();
    expect(declarationsFor(rules, ".topbar-title", MOBILE).get("font-size")).toBe("18px");
  });
  it("[代表値] スマホ幅ではツールバーの作成ボタンを隠す（下部ナビの＋で作成できる）", () => {
    expect(declarationsFor(rules, ".toolbar-create", MOBILE).get("display")).toBe("none");
    expect(declarationsFor(rules, ".toolbar-create").get("display")).toBeUndefined();
  });
  it("[代表値] 使わなくなったパンくずのスタイルを残さない", () => {
    expect(rules.some((rule) => rule.selectors.some((s) => s.includes(".breadcrumbs")))).toBe(
      false,
    );
  });
});
