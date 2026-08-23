// autonomy: anti-tamper — test の diff から「既存テストの緩和（改ざん）」を決定論検出（advisory）
// 自律区間で「テストを甘くして緑にする」を機械的に止める門番。
// 正本: .claude/rules/testing.md（禁止: 実装に合わせてテストを甘くする）/ tdd-cycle のアンチパターン。
// 純粋関数: unified diff テキスト → TamperFinding[]（副作用なし）。
// test-quality-reviewer が「ファイル全体の grep」なのに対し、本検出器は「diff の改ざん」を見る。
// テスト命名・イディオムはプロジェクトの言語に合わせて調整する（下記 regex 群。既定は主要言語をカバー）。

export type TamperKind =
  | "test-removed" // 既存テスト宣言の削除
  | "assertion-removed" // 既存 assertion の削除
  | "skip-added" // skip / only / xit 等の追加
  | "trivial-assertion" // expect(true).toBe(true) 等の自明 assertion 追加
  | "test-commented-out"; // テストのコメントアウト追加

export interface TamperFinding {
  file: string;
  line: number; // 追加=新側 / 削除=旧側 の行番号
  kind: TamperKind;
  text: string; // 該当行（マーカー除去・trim）
  message: string;
}

// 既定は主要言語の慣習をカバー: Go / JS・TS / Python / Ruby / Rust / JVM。移植先の言語に合わせて調整する。
const TEST_FILE =
  /(_test\.(go|py|rs)|test_[^/]*\.py|\.test\.[jt]sx?|\.spec\.[jt]sx?|_spec\.rb|(Test|Tests)\.(java|kt|kts))$|__tests__\/.*\.[jt]sx?$/;
const TEST_DECL =
  /\bfunc\s+Test\w*\s*\(|\b(?:it|test|describe)\s*\(|\bdef\s+test\w*\s*\(|#\[test\]|@Test\b/;
const ASSERTION = /\b(?:assert|require|expect)\w*\b|\bt\.(?:Error|Fatal)/;
const SKIP =
  /\bt\.Skip(?:Now)?\b|\.(?:skip|only)\s*\(|\b(?:xit|xdescribe|fit|fdescribe)\s*\(|@(?:unittest\.)?skip|@pytest\.mark\.skip|#\[ignore\]/;
const TRIVIAL =
  /expect\s*\(\s*true\s*\)\s*\.\s*toBe(?:Truthy)?\s*\(\s*(?:true\s*)?\)|assert\.True\s*\(\s*\w+\s*,\s*true\s*\)|\bassert\s+True\b|assert!\s*\(\s*true\s*\)/;
const COMMENTED_TEST = /^\s*(?:\/\/|#).*(?:\bfunc\s+Test|\b(?:it|test|describe)\s*\(|\bdef\s+test)/;

const MESSAGES: Record<TamperKind, string> = {
  "test-removed": "既存テスト宣言を削除（テストを甘くしていないか・testing.md 禁止）",
  "assertion-removed": "既存 assertion を削除（検証を弱めていないか）",
  "skip-added": "skip / only / xit を追加（テストの無効化・恒常 skip 禁止）",
  "trivial-assertion": "自明な assertion を追加（実装を検証していない循環）",
  "test-commented-out": "テストをコメントアウト（無効化）",
};

/** コメント行か（コメントの削除・編集は改ざんではないので test-removed/assertion-removed の対象外） */
function isCommentLine(content: string): boolean {
  return /^\s*(\/\/|#|\*|\/\*)/.test(content);
}

interface HunkPos {
  oldLine: number;
  newLine: number;
}

function push(out: TamperFinding[], file: string, line: number, kind: TamperKind, text: string): void {
  out.push({ file, line, kind, text: text.trim(), message: MESSAGES[kind] });
}

/** unified diff を走査し、test ファイルの改ざん候補を返す */
export function scanTestDiff(diff: string): TamperFinding[] {
  const findings: TamperFinding[] = [];
  let file = "";
  let isTest = false;
  let pos: HunkPos = { oldLine: 0, newLine: 0 };

  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "").trim();
      isTest = TEST_FILE.test(file);
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff ") || raw.startsWith("\\")) continue;

    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      pos = { oldLine: Number(hunk[1]), newLine: Number(hunk[2]) };
      continue;
    }
    if (!isTest) continue;

    if (raw.startsWith("+")) {
      const content = raw.slice(1);
      if (SKIP.test(content)) push(findings, file, pos.newLine, "skip-added", content);
      if (TRIVIAL.test(content)) push(findings, file, pos.newLine, "trivial-assertion", content);
      if (COMMENTED_TEST.test(content)) push(findings, file, pos.newLine, "test-commented-out", content);
      pos.newLine++;
    } else if (raw.startsWith("-")) {
      const content = raw.slice(1);
      if (!isCommentLine(content)) {
        if (TEST_DECL.test(content)) push(findings, file, pos.oldLine, "test-removed", content);
        else if (ASSERTION.test(content)) push(findings, file, pos.oldLine, "assertion-removed", content);
      }
      pos.oldLine++;
    } else {
      // 文脈行
      pos.oldLine++;
      pos.newLine++;
    }
  }

  return findings;
}
