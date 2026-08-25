import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = () => readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");
const styles = () => readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("Issue experience UI contract", () => {
  it("[代表値] IME guard、List reorder、colorThemeの導線を配線する", () => {
    const app = appSource();

    expect(app).toContain("event.nativeEvent.isComposing");
    expect(app).toContain("hasIssueTitle(title)");
    expect(app).toContain('"/api/v1/issues/reorder"');
    expect(app).toContain("onDragStart");
    expect(app).toContain("onMove={(direction) => moveIssue(issue, direction)}");
    expect(app).toContain("await refresh()");
    expect(app).toContain("onColorTheme={saveColorTheme}");
    expect(app).toContain("color-theme-swatch");
    expect(app).toContain("issue: latestIssue");
    expect(app).toContain("idempotencyKey: idempotencyKey()");
    expect(app).toContain("setColorThemeDraft(previousColorTheme)");
    expect(app).toContain("document.documentElement.dataset.colorTheme");
    expect(app).toContain("カラーテーマを変更しました");
    expect(app).toContain("const grouped = workflowStates");
    expect(app).not.toContain("const boardIssues");
  });

  it("[アクセシビリティ/境界値] Priority label、Keyboard移動、responsive幅の契約を持つ", () => {
    const app = appSource();
    const css = styles();

    expect(app).toContain('role="img"');
    expect(app).toContain("aria-label={`${issue.identifier}のPriority`}");
    expect(app).toContain("を上へ移動");
    expect(app).toContain("を下へ移動");
    expect(css).toContain(".issue-table.manual-order");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1023px)");
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1199px)");
    expect(css).toContain('[data-color-theme="ocean"]');
    expect(css).toContain(".priority-icon-select");
  });

  it("[回帰] Project詳細の専用routeを維持する", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/routes/projects/$projectId.tsx"),
      "utf8",
    );

    expect(route).toContain('createFileRoute("/projects/$projectId")');
  });
});
