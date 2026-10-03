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

  it("exposes Cycles in the mobile navigation", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

    expect(app).toContain('item="cycles"');
    expect(styles).toContain("grid-template-columns: repeat(7, 1fr);");
  });
});
