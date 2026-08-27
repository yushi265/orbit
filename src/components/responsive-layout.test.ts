import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const orbitApp = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

describe("responsive issue layout contract", () => {
  it("[境界値] mobileのIssue一覧は表示中の5列だけで本文幅を確保する", () => {
    expect(styles).toContain("grid-template-columns: 25px minmax(0, 1fr) 82px 30px 62px;");
    expect(styles).toContain(
      ".issue-table:not(.manual-order) .status-cell select { width: calc(100% - 14px); }",
    );
    expect(styles).toMatch(
      /\.issue-table:not\(\.manual-order\) \.table-header span:nth-child\(5\) \{ display: block; \}/,
    );
    expect(styles).toMatch(
      /\.issue-table:not\(\.manual-order\) \.table-header span:nth-child\(6\), \.issue-table:not\(\.manual-order\) \.table-header span:nth-child\(7\) \{ display: none; \}/,
    );
    expect(styles).toContain(
      ".issue-table:not(.manual-order) .table-header span:nth-child(4) { font-size: 0; }",
    );
    expect(styles).toContain(
      ".issue-table.manual-order .table-header span:nth-child(5) { font-size: 0; }",
    );
  });

  it("[境界値] tabletのIssue一覧はProject/Dueを除いた5列へ縮退する", () => {
    expect(styles).toContain("grid-template-columns: 28px minmax(0, 1fr) 105px 100px 90px;");
    expect(styles).toContain(
      ".issue-table:not(.manual-order) .table-header span:nth-child(5) { display: block; }",
    );
  });

  it("[境界値] manual orderも表示中の列数とグリッド列数を一致させる", () => {
    expect(styles).toContain("grid-template-columns: 56px 28px minmax(0, 1fr) 105px 52px 90px;");
    expect(styles).toContain("grid-template-columns: 44px 22px minmax(42px, 1fr) 72px 28px 48px;");
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
});
