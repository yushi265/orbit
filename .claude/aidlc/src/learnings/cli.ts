// learnings CLI（advisory）
// 使い方:
//   pnpm -C .claude/aidlc learnings [<retro-dir>]              … surface（Phase A）: retro note 集約
//   pnpm -C .claude/aidlc learnings persist "<entry 行>"       … persist（Phase C）: docs/ai-dlc/learnings.md へ dedup 追記
//   pnpm -C .claude/aidlc learnings measure [<retro-dir>]      … measure: 再発マトリクス + sensor FAIL 推移（判定はしない）
// surface は retro-triage の「未対応 Try 集約」「カテゴリ再発チェック」を機械化して提示する（非強制）。

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRetroNote, aggregateLearnings, type ParsedRetroNote } from "./parse";
import { appendLearning } from "./persist";
import { buildMatrix, formatMeasure, parseAdoptedTries, parseSensorLog, type NoteInput } from "./measure";

// persist サブコマンド（Phase C）: 採用 Try を docs/ai-dlc/learnings.md へ dedup 追記する。
// （旧 .claude/rules/_learnings.md。docs/ へ移設 = 常時注入コンテキストから除外）
// conflict-check（新 learning と既存 .claude/rules/*.md の矛盾照合）は LLM 依存で本ツールに入れない。
// orchestrator が persist の**前に** code-reviewer へ委譲し、矛盾時は persist せず human escalation する。
if (process.argv[2] === "persist") {
  const entry = (process.argv[3] ?? "").trim();
  if (!entry.startsWith("- ")) {
    process.stderr.write(
      '使い方: learnings persist "- [YYYY-MM-DD] <観察> `[category]` → 還流先候補: ... （出典: ...）"\n',
    );
    process.exit(2);
  }
  const learningsPath = fileURLToPath(
    new URL("../../../../docs/ai-dlc/learnings.md", import.meta.url),
  );
  const { md, appended, reason } = appendLearning(readFileSync(learningsPath, "utf8"), entry);
  if (appended) {
    writeFileSync(learningsPath, md);
    process.stdout.write("✓ docs/ai-dlc/learnings.md へ追記しました（advisory・未昇格）\n");
    process.stderr.write(
      "[reminder] persist 前に conflict-check（既存 .claude/rules/*.md との矛盾照合・code-reviewer 委譲）を済ませましたか？ 矛盾時は追記を取り消し human escalation。\n",
    );
  } else {
    process.stdout.write(`- 重複につき追記スキップ（${reason}）: 同じ観察が既に docs/ai-dlc/learnings.md にあります\n`);
  }
  process.exit(0);
}

// measure サブコマンド: 再発マトリクス（カテゴリ × 期間 × 出典）+ sensor FAIL 推移を出す。
// read-only・**判定はしない**——「効いた/未達」は retro-triage の手順 1.5 で人間が下す（材料集めだけを機械化）。
if (process.argv[2] === "measure") {
  const dir = process.argv[3] ?? fileURLToPath(new URL("../../../../docs/ai-dlc/retro/", import.meta.url));
  const readOr = (p: string): string => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return ""; // learnings.md / sensor-log.jsonl が無くても落とさない（fail-open）
    }
  };
  const notes: NoteInput[] = listNotes(dir).map((f) => {
    const p = parseRetroNote(readFileSync(f, "utf8"));
    return {
      name: f.split("/").pop() ?? f,
      date: p.completedDate,
      problems: p.problems,
      untaggedProblems: p.untaggedProblems,
      insightTags: p.insightTags,
    };
  });
  const tries = parseAdoptedTries(readOr(fileURLToPath(new URL("../../../../docs/ai-dlc/learnings.md", import.meta.url))));
  const log = parseSensorLog(readOr(fileURLToPath(new URL("../../state/sensor-log.jsonl", import.meta.url))));
  process.stdout.write(formatMeasure(buildMatrix(notes, tries), log));
  process.exit(0);
}

const retroDir = process.argv[2] ?? fileURLToPath(new URL("../../../../docs/ai-dlc/retro/", import.meta.url));

function listNotes(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "_TEMPLATE.md" && f !== "README.md")
    .map((f) => join(dir, f));
}

const parsed: { name: string; note: ParsedRetroNote }[] = listNotes(retroDir).map((f) => ({
  name: f.split("/").pop() ?? f,
  note: parseRetroNote(readFileSync(f, "utf8")),
}));
const agg = aggregateLearnings(parsed.map((p) => p.note));

const out = process.stdout;
out.write(`# learnings surface（${parsed.length} note・advisory）\n\n`);

out.write(`## 未対応 Try（${agg.openActions.length} 件）— 棚卸し候補\n`);
if (agg.openActions.length === 0) out.write("- なし\n");
for (const a of agg.openActions) out.write(`- [還流先: ${a.refluxTarget}] ${a.improvement}（${a.status}）\n`);

out.write(`\n## Problem カテゴリ再発（効果測定キー）\n`);
const entries = Object.entries(agg.categoryCounts).sort((a, b) => b[1] - a[1]);
if (entries.length === 0) out.write("- なし\n");
for (const [cat, n] of entries) {
  out.write(`- ${cat}: ${n} 件${n >= 2 ? "  ← 再発（剪定 / 機械化の検討候補）" : ""}\n`);
}
