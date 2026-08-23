// sensor: spec-sections — spec 必須節の充足を決定論検査（advisory）
// 正本: create-spec スキルのチェックリストのうち機械チェック可能な行のみ sensor 化
// （見出し・記法の存在検査に限る。節の中身の意味的充足はレビュアー / 人間の守備範囲）。
// index.md: AC 番号・テスト戦略・対象外 / レイヤー .md: 担保 AC・テストケース・異常系 /
// 表示層（ui.md）: レスポンシブ節。_TEMPLATE / progress.md / questions.md は対象外。
// LAYER_FILES と表示層ファイル名はスタック非依存の例（data/service/ui）。プロジェクトの
// レイヤー構成（spec/_TEMPLATE のレイヤー別ファイル名）に合わせて調整する。

export interface SpecSectionFinding {
  rule: "spec-sections";
  message: string;
}

// プロジェクトのレイヤー別 spec ファイル名。例は data（永続層）/ service（ロジック層）/ ui（表示層）。
const LAYER_FILES = new Set(["data.md", "service.md", "ui.md"]);
// レスポンシブ / アクセシビリティ節を要求する表示層ファイル（UI を持たないプロジェクトでは該当なし）。
// 表示層が複数あるプロジェクト（例: プラグイン UI + ブラウザ webapp）はここに全て列挙する。
const UI_LAYER_FILES = new Set(["ui.md"]);

const finding = (message: string): SpecSectionFinding => ({ rule: "spec-sections", message });

/** 見出し行（#〜####）の本文が prefix で始まるものが存在するか（「## 担保 AC（…引用）」等の後続文字を許容） */
function hasHeading(md: string, prefix: string): boolean {
  return md
    .split(/\r?\n/)
    .some((l) => /^#{1,4}\s/.test(l) && l.replace(/^#{1,4}\s+/, "").startsWith(prefix));
}

/** spec ファイル 1 本の必須節充足を検査する（純粋関数・relPath は repo root 相対） */
export function scanSpecSections(relPath: string, md: string): SpecSectionFinding[] {
  if (relPath.includes("/_TEMPLATE/")) return []; // 雛形はプレースホルダ前提・対象外
  const base = relPath.split("/").pop() ?? "";
  const findings: SpecSectionFinding[] = [];

  if (base === "index.md") {
    if (!/\bAC-\d+/.test(md)) {
      findings.push(finding("AC 番号（AC-1 形式）が見つからない（受け入れ基準は番号付け必須・create-spec チェックリスト）"));
    }
    if (!hasHeading(md, "テスト戦略")) {
      findings.push(finding("「テスト戦略」節（テストマトリクス）が無い"));
    }
    if (!md.includes("対象外") && !md.includes("スコープ外")) {
      findings.push(finding("対象外（スコープ外 / やらないこと）の記載が無い（YAGNI の明文化）"));
    }
    return findings;
  }

  if (LAYER_FILES.has(base)) {
    // 「担保 AC」節を持たないレイヤー .md は検査対象外にする（誤検知を避ける安全側の判定。
    //  spec-conformance-reviewer B-2 の「担保 AC 節なし = N/A」と同じ基準）。テンプレ由来の
    //  新規 spec は最初から節がある。全節ゼロの新規 spec の検出は Gate 2 と
    //  spec-conformance-reviewer が担保する = 多重防壁の別層に委ねる。
    if (!hasHeading(md, "担保 AC")) return [];
    if (!hasHeading(md, "テストケース")) findings.push(finding(`「テストケース」節が無い（${base}）`));
    if (!hasHeading(md, "異常系")) findings.push(finding(`「異常系」節が無い（${base}）`));
    if (UI_LAYER_FILES.has(base) && !hasHeading(md, "レスポンシブ")) {
      findings.push(finding("「レスポンシブ / アクセシビリティ」節が無い（表示層は必須・空通過不可）"));
    }
    return findings;
  }

  return []; // progress.md / questions.md / その他の spec 配下ファイルは対象外
}
