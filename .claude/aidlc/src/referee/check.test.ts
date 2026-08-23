// referee-check の TDD。
// 「exit 0 の集合だけが権威 green」「コマンド不在は RED でなく unavailable」
// （worker/AI の自己申告を信用せず、検証コマンドの exit code だけを権威にする）。
// レイヤー名・コマンドは注入データ（referee.config.json）。下記 fixture は汎用例。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideTargets,
  toResult,
  overallVerdict,
  classifyOutcome,
  buildAuditNote,
  missingPrecondition,
  type RefereeConfig,
} from "./check";
import { applyReportToDocument, initialDocument } from "../state/state";

const CONFIG: RefereeConfig = {
  layers: {
    service: { cwd: "service", command: ["make", "test"] },
    api: { cwd: "api", command: ["npm", "test"] },
    ui: { cwd: "ui", command: ["npm", "test"] },
  },
  post: { name: "lefthook", cwd: ".", command: ["npx", "lefthook", "run", "pre-commit"] },
};

// --- decideTargets: layer 指定 × コマンド有無（デシジョンテーブル全列） ------------

test("[デシジョンテーブル] all → 全レイヤー + post（lefthook）を宣言順で返す", () => {
  const t = decideTargets("all", CONFIG);
  assert.deepEqual(
    t.map((x) => x.name),
    ["service", "api", "ui", "lefthook"],
  );
});

test("[デシジョンテーブル] 個別レイヤー指定 → そのレイヤーのみ（post は付かない）", () => {
  const t = decideTargets("service", CONFIG);
  assert.equal(t.length, 1);
  assert.equal(t[0].name, "service");
  assert.deepEqual(t[0].cmd.command, ["make", "test"]);
});

test("[デシジョンテーブル] post 未定義の config で all → レイヤーのみ（欠落を許容）", () => {
  const noPost: RefereeConfig = { layers: { service: CONFIG.layers.service } };
  assert.deepEqual(decideTargets("all", noPost).map((x) => x.name), ["service"]);
});

test("[値域外] 未知レイヤー名 → 利用可能一覧付きで throw（fail fast）", () => {
  assert.throws(() => decideTargets("db", CONFIG), /service.*api.*ui|利用可能/);
});

// --- toResult: exit code → verdict（自己申告でなく exit だけが権威） ---------------

test("[代表値] exit 0 → GREEN / exit 1 → RED（出力の最後 5 行を要約に付ける）", () => {
  const green = toResult("service", { exit: 0, output: "ok\nPASS\n" });
  assert.equal(green.verdict, "GREEN");
  const red = toResult("api", { exit: 1, output: ["l1", "l2", "l3", "l4", "l5", "l6", "FAIL x"].join("\n") });
  assert.equal(red.verdict, "RED");
  assert.equal(red.summary.length, 5);
  assert.equal(red.summary[4], "FAIL x"); // 最後の 5 行（先頭は落ちる）
});

test("[境界値] コマンド不在（ツール未導入）→ RED でなく unavailable（環境差の誤赤を防ぐ）", () => {
  const r = toResult("ui", { exit: null, output: "", notFound: true });
  assert.equal(r.verdict, "unavailable");
});

test("[境界値] tail 要約: ちょうど 5 行 → そのまま・6 行 → 最後の 5 行", () => {
  const five = toResult("x", { exit: 1, output: "1\n2\n3\n4\n5" });
  assert.deepEqual(five.summary, ["1", "2", "3", "4", "5"]);
  const six = toResult("x", { exit: 1, output: "1\n2\n3\n4\n5\n6" });
  assert.deepEqual(six.summary, ["2", "3", "4", "5", "6"]);
});

// --- classifyOutcome: spawnSync 結果 → outcome（cli の I/O 境界判定の固定） ----------

test("[代表値] classifyOutcome: ENOENT → notFound / 正常 exit → notFound false・stdout+stderr 結合", () => {
  const enoent = classifyOutcome({ status: null, error: Object.assign(new Error("spawn x ENOENT"), { code: "ENOENT" }) });
  assert.equal(enoent.notFound, true);
  const ok = classifyOutcome({ status: 0, stdout: "PASS\n", stderr: "warn\n" });
  assert.equal(ok.notFound, false);
  assert.equal(ok.exit, 0);
  assert.equal(ok.output, "PASS\nwarn\n");
  // ENOENT 以外の error（起動後の失敗等）は notFound にしない
  const other = classifyOutcome({ status: 1, error: Object.assign(new Error("boom"), { code: "EACCES" }) });
  assert.equal(other.notFound, false);
});

test("[境界値] missingPrecondition: 宣言あり + 不在 → true（unavailable 扱い）/ 実在 or 宣言なし → false", () => {
  const cmd = { cwd: "ui", command: ["npm", "test"], precondition: "node_modules" };
  assert.equal(missingPrecondition(cmd, () => false), true); // deps 未導入 → spawn せず unavailable
  assert.equal(missingPrecondition(cmd, (p) => p === "ui/node_modules"), false);
  assert.equal(missingPrecondition({ cwd: "service", command: ["make", "test"] }, () => false), false); // 宣言なしは常に実行
});

// --- buildAuditNote: 決定論 → note event の既存重複スキップで冪等（audit 冪等） --

test("[冪等] buildAuditNote は同一入力でバイト同一 → note の二重 report が audit に重複追記されない", () => {
  const results = [{ name: "service", verdict: "GREEN" as const, summary: [] }];
  const note = buildAuditNote("service", results, "GREEN");
  assert.equal(note, buildAuditNote("service", results, "GREEN")); // 決定論（順序・書式が安定）
  assert.match(note, /^REFEREE_GREEN service/);
  const doc = initialDocument("REF-1", { tier: 2, specPlanned: false });
  const first = applyReportToDocument(doc, { type: "note", note }, "2026-01-01T00:00:00.000Z");
  assert.equal(first.skipped, false);
  const second = applyReportToDocument(first.doc, { type: "note", note }, "2026-01-01T01:00:00.000Z");
  assert.equal(second.skipped, true); // 冪等: 同一判定の連続実行は追記しない
  assert.equal(second.doc.audit.length, 1);
});

test("[代表値] buildAuditNote: unavailable の総合は UNAVAILABLE で記録（本物の RED と audit 上で区別・green も名乗らない）", () => {
  const results = [{ name: "service", verdict: "unavailable" as const, summary: [] }];
  assert.match(buildAuditNote("all", results, "unavailable"), /^REFEREE_UNAVAILABLE all/);
});

// --- overallVerdict: GREEN の集合だけが権威 green -----------------------------------

test("[デシジョンテーブル] 全 GREEN → GREEN / RED 混在 → RED / unavailable 混在（RED なし）→ unavailable", () => {
  const g = { name: "a", verdict: "GREEN" as const, summary: [] };
  const r = { name: "b", verdict: "RED" as const, summary: [] };
  const u = { name: "c", verdict: "unavailable" as const, summary: [] };
  assert.equal(overallVerdict([g, g]), "GREEN");
  assert.equal(overallVerdict([g, r, u]), "RED"); // RED が最優先
  assert.equal(overallVerdict([g, u]), "unavailable"); // 全実行できてこそ権威 green
});
