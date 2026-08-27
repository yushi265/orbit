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
const animationName = pageMotionDeclarations.get("animation")?.match(/^[\w-]+/)?.[0];
const keyframes = animationName
  ? styles.match(
      new RegExp(
        `@keyframes\\s+${escapeRegExp(animationName)}\\s*\\{\\s*from\\s*\\{([^}]*)\\}\\s*to\\s*\\{([^}]*)\\}\\s*\\}`,
        "s",
      ),
    )
  : null;

describe("page entrance motion CSS contract", () => {
  it("[代表値] .page has a one-time eased entrance animation", () => {
    const animation = pageMotionDeclarations.get("animation") ?? "";
    const duration = animation.match(/(?:^|\s)(\d*\.?\d+)(ms|s)(?=\s|$)/);
    const durationMilliseconds = Number(duration?.[1]) * (duration?.[2] === "s" ? 1000 : 1);
    const cubicBezierValues =
      animation
        .match(/cubic-bezier\(([^)]*)\)/)?.[1]
        ?.split(",")
        .map((value) => Number(value.trim())) ?? [];

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
    expect(animation).toMatch(/\b[\w-]+\b/);
    expect(duration).not.toBeNull();
    expect(durationMilliseconds).toBeGreaterThanOrEqual(700);
    expect(cubicBezierValues).toHaveLength(4);
    expect(cubicBezierValues.every(Number.isFinite)).toBe(true);
    expect(cubicBezierValues[0]).toBeGreaterThanOrEqual(0);
    expect(cubicBezierValues[0]).toBeLessThanOrEqual(1);
    expect(cubicBezierValues[2]).toBeGreaterThanOrEqual(0);
    expect(cubicBezierValues[2]).toBeLessThanOrEqual(1);
    expect(cubicBezierValues[1]).toBeGreaterThanOrEqual(0.75);
    expect(cubicBezierValues[3]).toBeGreaterThanOrEqual(cubicBezierValues[1]);
    expect(animation.split(/\s+/)).toContain("both");
    expect(pageMotionDeclarations.get("animation-iteration-count")).toBe("1");
    expect(animation).not.toMatch(/\binfinite\b/);
  });

  it("[状態遷移] enters from transparent and slightly below its resting position", () => {
    const fromDeclarations = parseDeclarations(keyframes?.[1] ?? "");
    const toDeclarations = parseDeclarations(keyframes?.[2] ?? "");

    expect(animationName).toBeTruthy();
    expect(keyframes).not.toBeNull();
    expect(fromDeclarations.get("opacity")).toBe("0");
    expect(parseCssPixels(fromDeclarations.get("top"))).toBeGreaterThanOrEqual(16);
    expect(toDeclarations.get("opacity")).toBe("1");
    expect(parseCssPixels(toDeclarations.get("top"))).toBe(0);
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
