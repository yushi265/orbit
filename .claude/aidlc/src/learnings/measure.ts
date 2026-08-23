// measure（効果測定・advisory）
// retro note 群 × learnings.md（採用 Try）× sensor-log.jsonl → 再発マトリクスの純関数。
// **判定はしない（表を出すだけ）**——効いた/未達の判断は retro-triage で人間が下す
// （既存原則「定量スコアでなく定性 = proxy 最適化の回避」を維持し、材料集めだけを機械化する）。

import { parseLearningEntries } from "./persist";
import type { ProblemItem } from "./parse";

/** measure の入力 1 note 分（parse.ts の ParsedRetroNote から CLI が組み立てる） */
export interface NoteInput {
  name: string;
  /** completedDate（無ければ null = 期間比較外・「日付不明」に集計） */
  date: string | null;
  problems: ProblemItem[];
  /** タグ無し Problem（other として集計・落とさない） */
  untaggedProblems: string[];
  /** 気づきセル埋め込みタグ（surface の categoryCounts と同一仕様で算入する。落とすと surface と無言で食い違う） */
  insightTags: string[];
}

/** learnings.md の採用 Try 1 件（日付が期間バケットの区切りになる） */
export interface AdoptedTry {
  date: string | null;
  refluxTarget: string;
  raw: string;
}

/** sensor-log.jsonl の 1 行（aidlc-sensor.sh が append） */
export interface SensorLogEntry {
  ts: string;
  sensor: string;
  file?: string;
  result: string; // PASS | FAIL
  findings: number;
}

interface Cell {
  count: number;
  sources: string[]; // 出典 note 名（判断前に人間が note 本文を確認するためのリンク）
}

export interface MeasureMatrix {
  /** 期間バケットのラベル（採用 Try の日付で区切る。Try 0 件なら「全期間」1 個） */
  buckets: string[];
  /** category -> バケット別の出現数 + 出典 */
  cells: Record<string, Cell[]>;
  /** 日付不明 note の集計（期間比較外・落とさない） */
  unknownByCategory: Record<string, Cell>;
  tries: AdoptedTry[];
}

const ENTRY_DATE = /^-\s*\[(\d{4}-\d{2}-\d{2})\]/;
const REFLUX = /→\s*還流先候補:\s*(.+?)\s*(?:（出典|$)/;

/** learnings.md から採用 Try（日付・還流先）を抽出する（entry 行の抽出は persist.ts を流用） */
export function parseAdoptedTries(md: string): AdoptedTry[] {
  return parseLearningEntries(md).map((e) => {
    const d = e.raw.match(ENTRY_DATE);
    const r = e.raw.match(REFLUX);
    return { date: d ? d[1] : null, refluxTarget: r ? r[1].trim() : "", raw: e.raw };
  });
}

/** sensor-log.jsonl をパースする。壊れ行・必須フィールド欠損行はスキップ（fail-open） */
export function parseSensorLog(jsonl: string): SensorLogEntry[] {
  const entries: SensorLogEntry[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Partial<SensorLogEntry>;
      if (typeof o.ts !== "string" || typeof o.sensor !== "string" || typeof o.result !== "string") continue;
      entries.push({
        ts: o.ts,
        sensor: o.sensor,
        file: typeof o.file === "string" ? o.file : undefined,
        result: o.result,
        findings: typeof o.findings === "number" ? o.findings : 0,
      });
    } catch {
      // 壊れ行はスキップ（advisory・fail-open）
    }
  }
  return entries;
}

/** note 日付が落ちるバケット index。区切り日当日は前（Try 採用日の Problem は Try 前の観察とみなす） */
function bucketIndexOf(date: string, cuts: string[]): number {
  for (let i = 0; i < cuts.length; i++) {
    if (date <= cuts[i]) return i;
  }
  return cuts.length;
}

/** カテゴリ × 期間バケットの再発マトリクスを構築する（入力は破壊しない・判定はしない） */
export function buildMatrix(notes: NoteInput[], tries: AdoptedTry[]): MeasureMatrix {
  const cuts = [...new Set(tries.map((t) => t.date).filter((d): d is string => d !== null))].sort();
  const buckets: string[] = [];
  if (cuts.length === 0) {
    buckets.push("全期間");
  } else {
    buckets.push(`〜${cuts[0]}`);
    for (let i = 1; i < cuts.length; i++) buckets.push(`${cuts[i - 1]} 後〜${cuts[i]}`);
    buckets.push(`${cuts[cuts.length - 1]} より後`);
  }

  const cells: Record<string, Cell[]> = {};
  const unknownByCategory: Record<string, Cell> = {};
  const rowOf = (cat: string): Cell[] => (cells[cat] ??= buckets.map(() => ({ count: 0, sources: [] })));
  const bump = (cat: string, note: NoteInput) => {
    const cell =
      note.date === null
        ? (unknownByCategory[cat] ??= { count: 0, sources: [] })
        : rowOf(cat)[bucketIndexOf(note.date, cuts)];
    cell.count++;
    if (!cell.sources.includes(note.name)) cell.sources.push(note.name);
  };

  for (const n of notes) {
    for (const p of n.problems) bump(p.category, n);
    for (let i = 0; i < n.untaggedProblems.length; i++) bump("other", n);
    for (const cat of n.insightTags) bump(cat, n); // 気づき埋め込みタグも算入（parse.ts aggregateLearnings と同一仕様）
  }

  return { buckets, cells, unknownByCategory, tries };
}

/** マトリクス + 採用 Try 一覧 + sensor FAIL 推移を人間向け markdown に整形する（判定文言は出さない） */
export function formatMeasure(matrix: MeasureMatrix, sensorLog: SensorLogEntry[]): string {
  const out: string[] = [];
  out.push("# learnings measure（効果測定・advisory）", "");

  out.push("## カテゴリ × 期間の Problem 出現数（判定は retro-triage で人間が下す）", "");
  out.push(`| カテゴリ | ${matrix.buckets.join(" | ")} |`);
  out.push(`|---|${matrix.buckets.map(() => "---").join("|")}|`);
  const cats = Object.keys(matrix.cells).sort(
    (a, b) =>
      matrix.cells[b].reduce((s, c) => s + c.count, 0) - matrix.cells[a].reduce((s, c) => s + c.count, 0),
  );
  if (cats.length === 0) out.push(`| （Problem なし） | ${matrix.buckets.map(() => "0").join(" | ")} |`);
  for (const cat of cats) {
    const row = matrix.cells[cat].map((c) => (c.count === 0 ? "0" : `${c.count}（${c.sources.join(", ")}）`));
    out.push(`| ${cat} | ${row.join(" | ")} |`);
  }

  out.push("", "> 出典 note はいずれも docs/ai-dlc/retro/ 配下。判断前に本文を確認する（カテゴリ粒度の誤読防止）");

  const unknownCats = Object.entries(matrix.unknownByCategory);
  if (unknownCats.length > 0) {
    out.push("", "### 日付不明 note（期間比較外・判断前に note 本文を確認）");
    for (const [cat, cell] of unknownCats) {
      out.push(`- ${cat}: ${cell.count} 件（${cell.sources.join(", ")}）`);
    }
  }

  out.push("", `## 採用 Try（learnings.md・${matrix.tries.length} 件 = 期間の区切り）`);
  if (matrix.tries.length === 0) out.push("- なし（初回棚卸し前・全期間の出現数のみ表示）");
  for (const t of matrix.tries) {
    out.push(`- [${t.date ?? "日付なし"}] 還流先候補: ${t.refluxTarget || "（未記載）"}`);
  }

  out.push("", "## sensor FAIL 推移（sensor-log.jsonl・FAIL が止まる = 学びが機械として機能している証拠）");
  if (sensorLog.length === 0) {
    out.push("- 記録なし（sensor-log.jsonl 未生成 or 空）");
  } else {
    const bySensor = new Map<string, { fail: number; pass: number; lastFail: string | null }>();
    for (const e of sensorLog) {
      const s = bySensor.get(e.sensor) ?? { fail: 0, pass: 0, lastFail: null };
      if (e.result === "FAIL") {
        s.fail++;
        s.lastFail = e.ts;
      } else {
        s.pass++;
      }
      bySensor.set(e.sensor, s);
    }
    for (const [name, s] of [...bySensor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`- ${name}: FAIL ${s.fail} 件${s.lastFail ? `（直近 ${s.lastFail}）` : ""} / PASS ${s.pass} 件`);
    }
  }
  out.push("");
  return out.join("\n");
}
