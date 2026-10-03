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
    expect(styles).toContain(".mobile-menu-sheet .nav-item:hover { color: #84909f; }");
    expect(styles).toContain(
      ".mobile-menu-sheet .nav-item.active, .mobile-menu-sheet .nav-item.active:hover { color: var(--orbit-accent-strong",
    );
    expect(styles).toContain("padding: 10px 12px max(12px, env(safe-area-inset-bottom));");
    expect(styles).toMatch(
      /\.filter-fields\.open \.filter-sheet-done \{[^}]*position: sticky; bottom: 0;[^}]*env\(safe-area-inset-bottom\)/,
    );
  });
});
