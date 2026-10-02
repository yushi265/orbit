import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const pageRule = styles.match(/\.page\s*\{([^}]*)\}/s)?.[1] ?? "";
const pageMotionRule =
  styles.match(/\.page\s*>\s*:not\(\.cycle-blocking-overlay\)\s*\{([^}]*)\}/s)?.[1] ?? "";
const reducedMotionStyles = styles.slice(styles.indexOf("@media (prefers-reduced-motion: reduce)"));

const parseDeclarations = (block: string) =>
  new Map(
    block
      .split(";")
      .map((declaration) => declaration.split(":"))
      .filter(([property, value]) => property && value)
      .map(([property, ...value]) => [property.trim(), value.join(":").trim()]),
  );

const parseCssPixels = (value: string | undefined) =>
  value?.trim() === "0" ? 0 : Number(value?.match(/^(-?(?:\d*\.)?\d+)px$/)?.[1] ?? "NaN");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ruleBlocksForSelector = (selector: string) =>
  [
    ...styles.matchAll(
      new RegExp(`(?:^|[{},])\\s*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "g"),
    ),
  ].map(([, block]) => parseDeclarations(block ?? ""));

const pageDeclarations = parseDeclarations(pageRule);
const pageRuleBlocks = ruleBlocksForSelector(".page");
const reducedMotionPageRule =
  reducedMotionStyles.match(/\.page\s*>\s*:not\(\.cycle-blocking-overlay\)\s*\{([^}]*)\}/s)?.[1] ??
  "";
const reducedMotionDeclarations = parseDeclarations(reducedMotionPageRule);
const pageMotionDeclarations = parseDeclarations(pageMotionRule);

describe("page visibility and motion CSS contract", () => {
  it("[代表値] keeps page content visible without replaying an entrance animation", () => {
    expect(pageRuleBlocks.length).toBeGreaterThan(0);
    expect(
      pageRuleBlocks.every(
        (declarations) =>
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
    expect(pageMotionDeclarations.has("opacity")).toBe(false);
    expect(pageMotionDeclarations.has("top")).toBe(false);
    expect(pageMotionDeclarations.has("transform")).toBe(false);
    expect(styles).not.toMatch(/@keyframes\s+orbit-page-enter\b/);
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
        ruleBlocksForSelector(selector).some(
          (declarations) => declarations.get("position") === "fixed",
        ),
      ).toBe(true);
    }
  });
});
