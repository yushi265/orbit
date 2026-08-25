import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile issue detail layout", () => {
  it("keeps the detail panel inside the mobile safe area", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toContain(
      ".issue-detail-backdrop { display: flex; align-items: flex-start; justify-content: center; overflow-y: auto;",
    );
    expect(styles).toContain(
      ".issue-detail-backdrop .detail-panel { max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));",
    );
  });

  it("lets the issue detail title wrap without clipping", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain("resize: none;");
    expect(app).toContain('id="issue-detail-title"');
    expect(app).toContain("rows={1}");
  });
});
