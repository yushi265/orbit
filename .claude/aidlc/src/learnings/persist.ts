// learnings persist（advisory）
// 採用 Try を docs/ai-dlc/learnings.md（機械追記専用ファイル・旧 .claude/rules/_learnings.md）へ **dedup 追記**する決定論部分。
//   - dedup（idempotency）: 観察文の内容キーで重複 append を防ぐ（日付・出典が違っても同じ観察は1件）。
//   - conflict-check（既存 .claude/rules/*.md との矛盾照合）は LLM 依存で純ツールに入れない。
//     orchestrator が persist 前に code-reviewer へ委譲し、矛盾なら persist せず escalation する。

const SECTION_HEADING = "## 学び（採用済み・未昇格）";

/** learnings.md の 1 学び entry。 */
export interface LearningEntry {
  raw: string;
}

/**
 * entry 行から dedup 用の内容キー（観察文）を取り出して正規化する。
 * 形式: `- [YYYY-MM-DD] <観察文> \`[category]\` → 還流先候補: ... （出典: ...）`
 * 日付・カテゴリ・還流先・出典は落とし、観察文だけを空白正規化して返す（同じ学びを1件と見なすため）。
 */
export function observationOf(line: string): string {
  // 先頭の "- [date] " を剥がす（date が無くても "- " は剥がす）。
  const dated = line.match(/^-\s*\[[0-9-]+\]\s*(.*)$/);
  let body = dated ? dated[1] : line.replace(/^-\s*/, "");
  // カテゴリタグ `[ ... の手前で切る。無ければ "→ 還流先" の手前で切る。
  const catIdx = body.indexOf("`[");
  if (catIdx !== -1) {
    body = body.slice(0, catIdx);
  } else {
    const reflux = body.indexOf("→ 還流先");
    if (reflux !== -1) body = body.slice(0, reflux);
  }
  return body.replace(/\s+/g, " ").trim();
}

/** learnings.md 本文から学びセクションの entry 行（`- [...`）を抽出する。 */
export function parseLearningEntries(md: string): LearningEntry[] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(SECTION_HEADING));
  if (start === -1) return [];
  const entries: LearningEntry[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break; // 次のセクションで終わり
    if (lines[i].startsWith("- ")) entries.push({ raw: lines[i] });
  }
  return entries;
}

/** 新 entry が既存 entry と同じ観察文（＝重複）か。 */
export function isDuplicate(md: string, newLine: string): boolean {
  const key = observationOf(newLine);
  return parseLearningEntries(md).some((e) => observationOf(e.raw) === key);
}

/**
 * 学びセクションに新 entry を dedup 追記した**新しい** md を返す。
 * - 重複なら追記せず `{ appended: false }`（本文不変・冪等）。
 * - 既存 entry があればその直後、無ければ見出しと末尾注記の間に挿入する。
 * - セクションが無ければ例外（機械追記先が壊れている）。
 */
export function appendLearning(
  md: string,
  newLine: string,
): { md: string; appended: boolean; reason: string } {
  const lines = md.split("\n");
  const headingIdx = lines.findIndex((l) => l.startsWith(SECTION_HEADING));
  if (headingIdx === -1) {
    throw new Error(`学びセクション（${SECTION_HEADING}）が見つからない`);
  }
  if (isDuplicate(md, newLine)) {
    return { md, appended: false, reason: "duplicate" };
  }

  // セクション範囲（見出し〜次の "## " or 末尾）で最後の entry 行を探す。
  let lastEntryIdx = -1;
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      sectionEnd = i;
      break;
    }
    if (lines[i].startsWith("- ")) lastEntryIdx = i;
  }

  if (lastEntryIdx !== -1) {
    // 既存 entry の直後へ挿入。
    lines.splice(lastEntryIdx + 1, 0, newLine);
  } else {
    // 空セクション: 末尾注記（"> ..."）の手前へ。注記が無ければセクション末尾へ。
    let insertAt = sectionEnd;
    for (let i = headingIdx + 1; i < sectionEnd; i++) {
      if (lines[i].startsWith(">")) {
        insertAt = i;
        break;
      }
    }
    // entry と注記の間に空行を保つ。
    lines.splice(insertAt, 0, newLine, "");
  }
  return { md: lines.join("\n"), appended: true, reason: "appended" };
}
