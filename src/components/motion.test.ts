import { describe, expect, it } from "vitest";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";

const rules = parseStyleRules();
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const PAGE_CHILDREN = ".page > :not(.cycle-blocking-overlay)";

const parseCssPixels = (value: string | undefined) =>
  value?.trim() === "0" ? 0 : Number(value?.match(/^(-?(?:\d*\.)?\d+)px$/)?.[1] ?? "NaN");

const pageRuleBlocks = rules.filter(
  (rule) => rule.media === null && rule.selectors.includes(".page"),
);
const pageDeclarations = declarationsFor(rules, ".page");
const pageMotionDeclarations = declarationsFor(rules, PAGE_CHILDREN);
const reducedMotionDeclarations = declarationsFor(rules, PAGE_CHILDREN, REDUCED_MOTION);

describe("page visibility and motion CSS contract", () => {
  it("[代表値] keeps page content visible without replaying an entrance animation", () => {
    expect(pageRuleBlocks.length).toBeGreaterThan(0);
    expect(
      pageRuleBlocks.every(
        ({ declarations }) =>
          !declarations.has("animation") &&
          !declarations.has("opacity") &&
          !declarations.has("transform"),
      ),
    ).toBe(true);
    expect(pageMotionDeclarations.get("position")).toBe("relative");
    expect(pageMotionDeclarations.has("animation")).toBe(false);
    expect(pageMotionDeclarations.has("animation-iteration-count")).toBe(false);
  });

  it("[状態遷移] does not hide or offset page content on route changes", () => {
    expect(pageMotionDeclarations.size).toBeGreaterThan(0);
    expect(pageMotionDeclarations.has("opacity")).toBe(false);
    expect(pageMotionDeclarations.has("top")).toBe(false);
    expect(pageMotionDeclarations.has("transform")).toBe(false);
    // 入場アニメーション orbit-page-enter をどの rule も参照しない
    for (const rule of rules)
      for (const prop of ["animation", "animation-name"])
        expect(rule.declarations.get(prop) ?? "", rule.selectors.join(",")).not.toMatch(
          /\borbit-page-enter\b/,
        );
  });

  it("[デシジョンテーブル] disables the new motion for reduced-motion users", () => {
    expect(reducedMotionDeclarations.get("animation")).toBe("none");
    expect(reducedMotionDeclarations.get("opacity")).toBe("1");
    expect(parseCssPixels(reducedMotionDeclarations.get("top"))).toBe(0);
  });

  it("[代表値/構造境界] keeps fixed overlays and mobile navigation viewport anchored", () => {
    expect(pageDeclarations.has("transform")).toBe(false);

    for (const selector of [
      ".cycle-blocking-overlay",
      ".modal-backdrop",
      ".run-overlay",
      ".toast",
      ".mobile-nav",
    ]) {
      expect(
        rules.some(
          (rule) =>
            rule.selectors.includes(selector) && rule.declarations.get("position") === "fixed",
        ),
        selector,
      ).toBe(true);
    }
  });
});
