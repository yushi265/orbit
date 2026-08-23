// sensor: learnings-format — learnings.md 追記行の書式を決定論検査（advisory）
// 正本: docs/ai-dlc/learnings.md 冒頭のエントリ・フォーマット規約
// `- [YYYY-MM-DD] <観察> \`[category]\` → 還流先候補: <...> （出典: <...>）`
// 書式が崩れると surface / measure / persist の機械パース（dedup・日付バケット）が静かに劣化するため、
// 追記時点で欠落要素を指摘する（検査は「## 学び」セクション内の entry 行のみ・fail-open）。

export interface LearningsFormatFinding {
  rule: "learnings-format";
  line: number; // 1 始まり
  message: string;
}

const SECTION_HEADING = "## 学び（採用済み・未昇格）";

const CHECKS: { name: string; re: RegExp }[] = [
  { name: "日付 [YYYY-MM-DD]", re: /^-\s*\[\d{4}-\d{2}-\d{2}\]/ },
  { name: "カテゴリタグ `[category]`", re: /`\[[a-z]+\]`/ },
  { name: "還流先候補", re: /→\s*還流先候補:/ },
  { name: "出典", re: /（出典:.+）/ },
];

/** learnings.md の学びセクション内 entry 行の書式を検査する（純粋関数） */
export function scanLearningsFormat(md: string): LearningsFormatFinding[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(SECTION_HEADING));
  if (start === -1) return []; // セクションが無い = 検査対象なし（fail-open）

  const findings: LearningsFormatFinding[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break; // 次セクションで終わり
    if (!lines[i].startsWith("- ")) continue; // entry 行のみ検査
    const missing = CHECKS.filter((c) => !c.re.test(lines[i])).map((c) => c.name);
    if (missing.length > 0) {
      findings.push({
        rule: "learnings-format",
        line: i + 1,
        message: `書式不備: ${missing.join(" / ")} が欠落（learnings.md 冒頭のフォーマット規約）`,
      });
    }
  }
  return findings;
}
