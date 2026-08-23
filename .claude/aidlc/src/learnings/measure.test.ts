// measure（効果測定）の TDD。
// 「判定はしない（表を出すだけ）」——効いた/未達の判断は retro-triage で人間が下す。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMatrix,
  formatMeasure,
  parseAdoptedTries,
  parseSensorLog,
  type NoteInput,
} from "./measure";

const note = (
  name: string,
  date: string | null,
  problems: { category: string; text: string }[],
  untagged: string[] = [],
  insightTags: string[] = [],
): NoteInput => ({
  name,
  date,
  problems,
  untaggedProblems: untagged,
  insightTags,
});

const TRY_LINE =
  "- [2026-06-25] advisory ツールは発火方式で実地採用率が決まる `[tooling]` → 還流先候補: .claude/aidlc（#1/#3 のフック化） （出典: phaseb retro）";

// --- buildMatrix: カテゴリ × 期間バケット -------------------------------------

test("[代表値] note 3 件 + 採用 Try 1 日付 → 2 バケットのマトリクス（区切り日当日は前バケット）", () => {
  const tries = parseAdoptedTries(`## 学び（採用済み・未昇格）\n\n${TRY_LINE}\n`);
  const m = buildMatrix(
    [
      note("a.md", "2026-06-18", [{ category: "tooling", text: "p1" }]),
      note("b.md", "2026-06-25", [{ category: "tooling", text: "p2" }]),
      note("c.md", "2026-07-01", [{ category: "spec", text: "p3" }]),
    ],
    tries,
  );
  assert.equal(m.buckets.length, 2);
  assert.equal(m.cells["tooling"][0].count, 2); // 6/18 + 6/25（当日は Try 前の観察）
  assert.equal(m.cells["tooling"][1].count, 0); // Try 後の再発なし（判定は人間）
  assert.equal(m.cells["spec"][0].count, 0);
  assert.equal(m.cells["spec"][1].count, 1);
});

test("[境界値] 採用 Try 0 件 → 「全期間」1 バケットのみ（初回棚卸し前の互換）", () => {
  const m = buildMatrix([note("a.md", "2026-06-18", [{ category: "spec", text: "p" }])], []);
  assert.equal(m.buckets.length, 1);
  assert.equal(m.cells["spec"][0].count, 1);
});

test("[代表値] タグ無し Problem は other に集計（落とさない）", () => {
  const m = buildMatrix([note("a.md", "2026-06-18", [], ["タグ無しの問題"])], []);
  assert.equal(m.cells["other"][0].count, 1);
});

test("[代表値] セルに出典 note 名が付く", () => {
  const m = buildMatrix(
    [
      note("a.md", "2026-06-18", [{ category: "tooling", text: "p1" }]),
      note("b.md", "2026-06-19", [{ category: "tooling", text: "p2" }]),
    ],
    [],
  );
  assert.deepEqual(m.cells["tooling"][0].sources, ["a.md", "b.md"]);
});

test("[代表値] 日付 null の note は「日付不明」に集計（期間比較外・落とさない）", () => {
  const m = buildMatrix([note("phaseb.md", null, [{ category: "tooling", text: "p" }])], []);
  assert.equal(m.unknownByCategory["tooling"].count, 1);
  assert.deepEqual(m.unknownByCategory["tooling"].sources, ["phaseb.md"]);
  // バケット側には入らない
  assert.equal(m.cells["tooling"]?.[0]?.count ?? 0, 0);
});

test("[代表値] 気づきセル埋め込みタグも再発カウントに算入（surface の categoryCounts と同一仕様・M-1）", () => {
  const m = buildMatrix(
    [note("a.md", "2026-06-18", [{ category: "spec", text: "p" }], [], ["tooling", "tooling"])],
    [],
  );
  assert.equal(m.cells["tooling"][0].count, 2); // 気づきタグ分
  assert.equal(m.cells["spec"][0].count, 1); // Problem 分（両方算入）
});

test("[境界値] 採用 Try 2 エントリ（別日）→ 3 バケット・同日 Try は去重で区切り 1 個", () => {
  const m = buildMatrix(
    [
      note("a.md", "2026-06-18", [{ category: "spec", text: "p1" }]),
      note("b.md", "2026-06-22", [{ category: "spec", text: "p2" }]), // 中間バケット
      note("c.md", "2026-07-01", [{ category: "spec", text: "p3" }]),
    ],
    [
      { date: "2026-06-20", refluxTarget: "x", raw: "" },
      { date: "2026-06-25", refluxTarget: "y", raw: "" },
    ],
  );
  assert.equal(m.buckets.length, 3);
  assert.deepEqual(m.cells["spec"].map((c) => c.count), [1, 1, 1]);
  // 同日 2 エントリは去重され区切り 1 個 = 2 バケット
  const dup = buildMatrix([], [
    { date: "2026-06-25", refluxTarget: "x", raw: "" },
    { date: "2026-06-25", refluxTarget: "y", raw: "" },
  ]);
  assert.equal(dup.buckets.length, 2);
});

test("[代表値] formatMeasure: Try 0 件の文言と出典 note の場所注記を出す", () => {
  const m = buildMatrix([note("a.md", "2026-06-18", [{ category: "spec", text: "p" }])], []);
  const out = formatMeasure(m, []);
  assert.match(out, /なし（初回棚卸し前・全期間の出現数のみ表示）/);
  assert.match(out, /docs\/ai-dlc\/retro\//); // 出典 note の場所（人間が本文へ辿れること）
});

// --- parseAdoptedTries: learnings.md → 採用 Try（日付・還流先） ----------------

test("[代表値] parseAdoptedTries は entry 行から日付・還流先を抽出する", () => {
  const md = `## 学び（採用済み・未昇格）\n\n${TRY_LINE}\n\n> 注記行\n`;
  const tries = parseAdoptedTries(md);
  assert.equal(tries.length, 1);
  assert.equal(tries[0].date, "2026-06-25");
  assert.equal(tries[0].refluxTarget, ".claude/aidlc（#1/#3 のフック化）");
});

// --- parseSensorLog: JSONL（fail-open） ---------------------------------------

test("[値域外] parseSensorLog は壊れ行・欠損フィールド行をスキップして続行（fail-open）", () => {
  const jsonl = [
    '{"ts":"2026-07-01T00:00:00Z","sensor":"custom-sensor","file":"x.sql","result":"FAIL","findings":2}',
    "こわれた行 { not json",
    '{"ts":"2026-07-02T00:00:00Z"}', // sensor/result 欠損 → スキップ
    '{"ts":"2026-07-02T01:00:00Z","sensor":"custom-sensor","file":"y.sql","result":"PASS","findings":0}',
    "",
  ].join("\n");
  const entries = parseSensorLog(jsonl);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].result, "FAIL");
  assert.equal(entries[1].result, "PASS");
});

// --- formatMeasure: 表 + Try 一覧 + sensor 推移 --------------------------------

test("[代表値] formatMeasure はマトリクス表・採用 Try 一覧・sensor FAIL 集計を含む（判定文言は出さない）", () => {
  const tries = parseAdoptedTries(`## 学び（採用済み・未昇格）\n\n${TRY_LINE}\n`);
  const m = buildMatrix(
    [
      note("a.md", "2026-06-18", [{ category: "tooling", text: "p1" }]),
      note("c.md", "2026-07-01", [{ category: "spec", text: "p3" }]),
      note("phaseb.md", null, [{ category: "review", text: "p4" }]),
    ],
    tries,
  );
  const out = formatMeasure(m, parseSensorLog('{"ts":"2026-07-01T00:00:00Z","sensor":"custom-sensor","file":"x.sql","result":"FAIL","findings":2}'));
  assert.match(out, /tooling/);
  assert.match(out, /2026-06-25/); // バケット境界 = Try 日付
  assert.match(out, /a\.md/); // 出典リンク
  assert.match(out, /日付不明/); // null 日付 note の行
  assert.match(out, /custom-sensor.*FAIL/); // sensor 推移
  assert.doesNotMatch(out, /効いた|未達/); // 判定はしない（人間の領分）
});

test("[境界値] formatMeasure: sensor-log 空 → 「記録なし」を表示（セクション自体は出す）", () => {
  const m = buildMatrix([note("a.md", "2026-06-18", [{ category: "spec", text: "p" }])], []);
  const out = formatMeasure(m, []);
  assert.match(out, /記録なし/);
});
