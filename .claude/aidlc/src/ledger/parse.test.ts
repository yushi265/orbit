import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLedger, extractSpecAcs } from "./parse";
import { verifyLedger, formatLedgerReport } from "./verify";

const LEDGER = [
  "## 実装タスク計画（順序付き）",
  "",
  "> 自由記述の前置きは無視される。",
  "",
  "- [x] T1 [db] AC-1 依存:なし — companies テーブル",
  "- [x] T2 [service] AC-2,AC-3 依存:T1 — GET /companies ハンドラ",
  "- [ ] T3 [api] AC-4 依存:T2 — companies resolver",
  "- [ ] T4 [ui] AC-5 依存:T3 — 一覧画面",
  "- [ ] T5 [infra] なし 依存:なし — compose に新サービス追加",
  "- ただの箇条書き（記法外）は台帳として扱わない",
].join("\n");

test("正常 5 行 → 5 タスク構造化・記法外の行は無視（代表値 + 境界値）", () => {
  const tasks = parseLedger(LEDGER);
  assert.equal(tasks.length, 5);
  assert.deepEqual(tasks[1], {
    done: true,
    id: "T2",
    layer: "service",
    acs: ["AC-2", "AC-3"],
    deps: ["T1"],
    title: "GET /companies ハンドラ",
  });
  assert.deepEqual(tasks[4].acs, []); // AC なし = 横断タスク
});

test("台帳節が無い / 記法対象行ゼロ → 空配列（trivial ボルト互換）", () => {
  assert.deepEqual(parseLedger("# progress\n- 分解不要"), []);
});

test("extractSpecAcs: index.md から AC 番号をユニーク抽出", () => {
  const md = "- [ ] AC-1: 一覧が見える\n- [ ] AC-2: 403 になる\n本文中の AC-1 参照は重複しない";
  assert.deepEqual(extractSpecAcs(md), ["AC-1", "AC-2"]);
});

test("依存違反のデシジョンテーブル: done × 依存未完のみ違反", () => {
  const tasks = parseLedger(
    [
      "- [x] T1 [db] AC-1 依存:なし — 基盤",
      "- [x] T2 [service] AC-2 依存:T1 — ok（依存 done）",
      "- [x] T3 [api] AC-3 依存:T4 — 違反（依存が未完なのに done）",
      "- [ ] T4 [ui] AC-4 依存:T1 — ok（未着手が done に依存）",
      "- [ ] T5 [infra] なし 依存:T4 — ok（未着手同士）",
    ].join("\n"),
  );
  const r = verifyLedger(tasks, null);
  assert.equal(r.dependencyViolations.length, 1);
  assert.ok(r.dependencyViolations[0].includes("T3"));
  assert.ok(r.dependencyViolations[0].includes("T4"));
});

test("存在しないタスクへの依存は unknownDeps として報告", () => {
  const tasks = parseLedger("- [ ] T1 [db] AC-1 依存:T9 — 孤児依存");
  const r = verifyLedger(tasks, null);
  assert.equal(r.unknownDeps.length, 1);
  assert.ok(r.unknownDeps[0].includes("T9"));
});

test("spec AC との突合: 未割当 AC を検出（AC なしタスクはカバレッジ除外）", () => {
  const tasks = parseLedger(
    ["- [x] T1 [db] AC-1 依存:なし — a", "- [ ] T2 [infra] なし 依存:なし — b"].join("\n"),
  );
  const r = verifyLedger(tasks, ["AC-1", "AC-2"]);
  assert.deepEqual(r.uncoveredAcs, ["AC-2"]);
});

test("formatLedgerReport: 台帳行ゼロ → 「台帳なし」で正常終了（trivial ボルト互換の文言）", () => {
  const out = formatLedgerReport(verifyLedger([], null));
  assert.ok(out.includes("台帳なし"));
});

test("formatLedgerReport: 残タスク列挙と全消化サマリ", () => {
  const tasks = parseLedger(LEDGER);
  const out = formatLedgerReport(verifyLedger(tasks, ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"]));
  assert.ok(out.includes("5 件"));
  assert.ok(out.includes("T3"));
  assert.ok(out.includes("未割当 AC: なし"));
});
