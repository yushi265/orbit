import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const orbitApp = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

describe("responsive issue layout contract", () => {
  it("[境界値] mobileのIssue一覧は本文幅を確保し期限を2行目で編集できる", () => {
    expect(styles).toContain("grid-template-columns: 25px minmax(0, 1fr) 82px 30px;");
    expect(styles).toContain(".issue-row .due-cell { grid-column: 2 / -1; grid-row: 2; }");
    expect(styles).toContain(
      '.due-cell input[type="date"] { width: 130px; max-width: 100%; font-size: 11px; }',
    );
    expect(styles).not.toMatch(/\.issue-row \.due-cell,[^{]*\{ display: none;/);
  });

  it("[境界値] tabletのIssue一覧はProjectを省略し期限は本文下で表示する", () => {
    expect(styles).toContain("grid-template-columns: 28px minmax(0, 1fr) 105px 100px;");
    expect(styles).toContain("@media (max-width: 1199px) { .issue-row");
    expect(styles).toContain(".table-header > .due-cell { display: none; }");
  });

  it("[境界値] manual orderも表示中の列数とグリッド列数を一致させる", () => {
    expect(styles).toContain("grid-template-columns: 32px 28px minmax(0, 1fr) 105px 52px;");
    expect(styles).toContain("grid-template-columns: 44px 22px minmax(42px, 1fr) 72px 28px;");
    expect(styles).toContain(".issue-table.manual-order .due-cell { grid-column: 3 / -1; }");
  });

  it("[状態遷移] toolbarのList/Board切替は一組で折り返す", () => {
    expect(orbitApp).toContain('<div className="view-toggle-group">');
    expect(styles).toContain(".view-toggle-group { display: flex;");
  });

  it("[境界値] mobileの詳細操作はスクロール領域下端で見切れない", () => {
    expect(styles).toMatch(
      /@media \(max-width: 767px\) \{[^}]*\.detail-actions \{ position: sticky;/,
    );
    expect(styles).toContain(
      ".detail-actions .button { padding: 0 6px; font-size: 10px; white-space: nowrap; }",
    );
  });

  it("[境界値] Cycle日付編集はmobileで1列へ縮退し固定幅を持たない", () => {
    expect(styles).toContain(
      ".cycle-schedule-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(styles).toContain(
      "@media (max-width: 767px) { .cycle-schedule-fields { grid-template-columns: minmax(0, 1fr); } }",
    );
    expect(orbitApp).toContain('type="date"');
    expect(orbitApp).toContain('aria-label="Cycle開始日"');
    expect(orbitApp).toContain('aria-label="Cycle終了日"');
  });
});
