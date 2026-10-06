import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const orbitApp = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");
const datePicker = readFileSync(
  resolve(process.cwd(), "src/components/orbit-date-picker.tsx"),
  "utf8",
);

describe("responsive issue layout contract", () => {
  it("[境界値] mobileのIssue一覧は本文幅を確保し期限を2行目で編集できる", () => {
    expect(styles).toContain("grid-template-columns: 44px minmax(0, 1fr) 96px 44px;");
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
    expect(styles).toContain("grid-template-columns: 88px 44px minmax(0, 1fr) 80px 44px;");
    expect(styles).toContain(".issue-table.manual-order .due-cell { grid-column: 3 / -1; }");
  });

  it("[状態遷移] toolbarのList/Board切替は一組で折り返す", () => {
    expect(orbitApp).toContain('<div className="view-toggle-group">');
    expect(styles).toContain(".view-toggle-group { display: flex;");
  });

  it("[境界値] mobileの詳細操作はスクロール領域下端で見切れない", () => {
    // 固定フッターは全幅（メディアクエリ外）で効き、mobileはsafe-areaを下パディングに含める。
    expect(styles).toMatch(/\n\.detail-foot \{ position: sticky; bottom: 0;/);
    expect(styles).toMatch(
      /@media \(max-width: 767px\) \{[^@]*?\.detail-actions \{[^}]*env\(safe-area-inset-bottom\)/,
    );
    expect(styles).toContain(
      ".detail-actions .button { flex: 0 0 auto; min-height: 44px; padding: 0 12px; font-size: 14px; white-space: nowrap; }",
    );
  });

  it("[境界値] 詳細の閉じる操作は固定し、Composerは画面幅に応じて広がる", () => {
    expect(styles).toContain(".composer.modal-panel { width: 90vw;");
    expect(styles).toContain(".detail-header { position: sticky; top: 0;");
    expect(styles).toContain(".detail-close { flex: 0 0 44px;");
    expect(styles).toContain("@media (max-width: 767px) { .composer.modal-panel { width: 100%; }");
  });

  it("[境界値] Cycle日付編集はmobileで1列へ縮退し固定幅を持たない", () => {
    expect(styles).toContain(
      ".cycle-schedule-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(styles).toContain(
      "@media (max-width: 767px) { .cycle-schedule-fields { grid-template-columns: minmax(0, 1fr); } }",
    );
    expect(datePicker).toContain('type="date"');
    expect(orbitApp).toContain('label="Cycle開始日"');
    expect(orbitApp).toContain('label="Cycle終了日"');
  });

  it("[境界値] tablet(768〜1023px)の設定グリッドは1列のままで暗黙の2列目を作らない", () => {
    expect(styles).toContain(".label-settings-card { grid-column: 1 / -1; }");
    expect(styles).not.toMatch(/\.label-settings-card \{[^}]*grid-column:[^;}]*span/);
    expect(styles).not.toContain(".label-settings-card { grid-column: auto; }");
    expect(styles).toContain(
      "@media (min-width: 768px) and (max-width: 1023px) { .settings-grid { grid-template-columns: minmax(0, 1fr); }",
    );
    expect(styles).toContain(
      ".settings-grid { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr));",
    );
  });
});
