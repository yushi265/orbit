import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile issue detail layout", () => {
  it("lets the issue detail title wrap without clipping", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain("resize: none;");
    expect(app).toContain('id="issue-detail-title"');
    expect(app).toContain("rows={1}");
  });

  it("exposes Cycles in the mobile Menu sheet within a five-column bottom nav", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

    expect(app).toContain('"cycles"');
    expect(app).toContain("mobile-menu-sheet");
    expect(styles).toContain("grid-template-columns: repeat(5, 1fr);");
    expect(styles).not.toContain("grid-template-columns: repeat(7, 1fr);");
  });

  it("[代表値/AC-8] filter sheet controls are mobile-only and desktop keeps the toolbar layout", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const mobile = styles.slice(
      styles.indexOf("@media (max-width: 767px) {\n  .filter-sheet-button"),
    );
    expect(styles).toMatch(
      /\.filter-sheet-button, \.filter-field-label, \.filter-sheet-title, \.filter-sheet-done \{ display: none; \}/,
    );
    expect(styles).toContain(
      ".filter-fields-wrap, .filter-fields, .filter-field { display: contents; }",
    );
    expect(mobile).toContain(".filter-sheet-button { display: inline-flex;");
    expect(mobile).toContain(".filter-fields.open .filter-field-label { display: block;");
    expect(mobile).toContain("max-height: 80dvh");
    expect(mobile).toContain("env(safe-area-inset-bottom)");
    expect(mobile).toContain("font-size: 16px");
  });

  it("[代表値] Menu sheet items keep one color in every state, the Done button is sticky, and the sheet respects the safe area", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(styles).toContain(".mobile-menu-sheet .nav-item:hover { color: var(--orbit-muted); }");
    expect(styles).toContain(
      ".mobile-menu-sheet .nav-item.active, .mobile-menu-sheet .nav-item.active:hover { color: var(--orbit-accent-strong",
    );
    expect(styles).toContain("padding: 10px 12px max(12px, env(safe-area-inset-bottom));");
    expect(styles).toMatch(
      /\.filter-fields\.open \.filter-sheet-done \{[^}]*position: sticky; bottom: 0;[^}]*env\(safe-area-inset-bottom\)/,
    );
  });

  it("[代表値] horizontal safe-area insets are applied to the shell, nav, toast, menu sheet and filter sheet", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(styles).toContain(
      ".app-shell { min-height: 100vh; display: flex; background: #f7f8fa; padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }",
    );
    // shorthandの直後にlonghandで上書きする順序までセレクタ単位で固定する。
    expect(styles).toMatch(
      /\.mobile-nav \{[^}]*padding: 7px 10px max\(7px, env\(safe-area-inset-bottom\)\); padding-left: max\(10px, env\(safe-area-inset-left\)\); padding-right: max\(10px, env\(safe-area-inset-right\)\);/,
    );
    expect(styles).toMatch(
      /\.toast \{[^}]*right: calc\(24px \+ env\(safe-area-inset-right\)\); bottom: 24px;/,
    );
    expect(styles).toMatch(
      /\.toast \{ right: max\(14px, env\(safe-area-inset-right\)\); bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\); left: max\(14px, env\(safe-area-inset-left\)\);/,
    );
    expect(styles).toMatch(
      /\.mobile-menu-sheet \{[^}]*padding: 10px 12px max\(12px, env\(safe-area-inset-bottom\)\); padding-left: max\(12px, env\(safe-area-inset-left\)\); padding-right: max\(12px, env\(safe-area-inset-right\)\);/,
    );
    expect(styles).toMatch(
      /\.filter-fields\.open \{[^}]*padding: 18px 18px 0; padding-left: max\(18px, env\(safe-area-inset-left\)\); padding-right: max\(18px, env\(safe-area-inset-right\)\);/,
    );
  });

  it("[同値分割] existing safe-area declarations remain", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(styles).toMatch(
      /\.content-area \{[^}]*padding: 28px 17px calc\(94px \+ env\(safe-area-inset-bottom\)\);/,
    );
    expect(styles).toMatch(
      /\.mobile-nav \{[^}]*height: calc\(70px \+ env\(safe-area-inset-bottom\)\);/,
    );
    expect(styles).toMatch(
      /\.modal-backdrop \{[^}]*padding: calc\(var\(--modal-gutter\) \+ env\(safe-area-inset-top\)\) calc\(var\(--modal-gutter\) \+ env\(safe-area-inset-right\)\) calc\(var\(--modal-gutter\) \+ env\(safe-area-inset-bottom\)\) calc\(var\(--modal-gutter\) \+ env\(safe-area-inset-left\)\);/,
    );
    expect(styles).toMatch(
      /\.issue-detail-backdrop, \.issue-composer-backdrop \{[^}]*padding: 0 env\(safe-area-inset-right\) 0 env\(safe-area-inset-left\);/,
    );
    expect(styles).toMatch(
      /\.filter-fields\.open \.filter-sheet-done \{[^}]*min-height: calc\(48px \+ env\(safe-area-inset-bottom\)\);[^}]*padding-bottom: env\(safe-area-inset-bottom\);/,
    );
  });
});
