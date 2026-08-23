import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkTierTripwire, type TierTrigger, type TriggersData } from "./tier-tripwire";

const triggers: TierTrigger[] = [
  {
    id: "db-schema",
    glob: "service/db/migrations/**",
    contentPattern: "CREATE TABLE|ALTER TABLE|DROP TABLE",
  },
  {
    id: "data-boundary",
    glob: "**/*.sql",
    contentPattern: "GRANT|REVOKE|CREATE POLICY",
  },
];

test("migrations 配下 + CREATE TABLE 追加 + 宣言 tier=2 → 昇格勧告 1 件（代表値）", () => {
  const findings = checkTierTripwire(
    "service/db/migrations/0002_add_notes.sql",
    ["CREATE TABLE notes (id uuid PRIMARY KEY);"],
    2,
    triggers,
  );
  // db-schema と data-boundary 両 glob にマッチするが、パターン一致は db-schema のみ
  assert.equal(findings.length, 1);
  assert.equal(findings[0].triggerId, "db-schema");
  assert.ok(findings[0].message.includes("Tier 1"));
  assert.ok(findings[0].message.includes("再宣言"));
});

// デシジョンテーブル: glob マッチ有無 × state 有無 × 宣言 tier → 勧告は 1 組合せのみ
test("デシジョンテーブル: 勧告が出るのは「マッチ × state あり × tier 2/3」のみ", () => {
  const added = ["ALTER TABLE users ADD COLUMN x int;"];
  const file = "service/db/migrations/0003_x.sql";
  // マッチしないファイル → 無音
  assert.deepEqual(checkTierTripwire("ui/src/page.tsx", added, 2, triggers), []);
  // state なし（declaredTier=null・非 AI-DLC 作業）→ 無音
  assert.deepEqual(checkTierTripwire(file, added, null, triggers), []);
  // tier=1 宣言済み → 無音（正常）
  assert.deepEqual(checkTierTripwire(file, added, 1, triggers), []);
  // tier=2 → 勧告 / tier=3 → 勧告
  assert.equal(checkTierTripwire(file, added, 2, triggers).length, 1);
  assert.equal(checkTierTripwire(file, added, 3, triggers).length, 1);
});

test("追加行にパターンが無い（既存行への接触のみ）→ 無音（境界値）", () => {
  const findings = checkTierTripwire(
    "service/db/migrations/0002_add_notes.sql",
    ["-- コメントだけの追加", "INSERT INTO notes VALUES (1);"],
    2,
    triggers,
  );
  assert.deepEqual(findings, []);
});

test("アクセス制御系（GRANT / REVOKE / CREATE POLICY）を data-boundary トリガーで検出", () => {
  const f1 = checkTierTripwire("service/db/queries/x.sql", ["GRANT ALL ON t TO app;"], 2, triggers);
  assert.equal(f1[0]?.triggerId, "data-boundary");
  const f2 = checkTierTripwire("service/db/queries/y.sql", ["CREATE POLICY p ON t;"], 3, triggers);
  assert.equal(f2[0]?.triggerId, "data-boundary");
});

test("triggers が空 / 壊れた regex は無音（fail-open）", () => {
  assert.deepEqual(checkTierTripwire("a.sql", ["CREATE POLICY p;"], 2, []), []);
  const broken: TierTrigger[] = [{ id: "x", glob: "**/*.sql", contentPattern: "([unclosed" }];
  assert.deepEqual(checkTierTripwire("a.sql", ["CREATE POLICY p;"], 2, broken), []);
});

test("実 tier-triggers.json が読めて db-schema トリガーを含む（較正）", () => {
  const data: TriggersData = JSON.parse(
    readFileSync(new URL("../../tier-triggers.json", import.meta.url), "utf8"),
  );
  const ids = data.triggers.map((t) => t.id);
  assert.ok(ids.includes("db-schema"));
  // 実データで勧告が出ることの較正（ミラーの regex が有効であること）
  const findings = checkTierTripwire(
    "service/db/migrations/0001_init.sql",
    ["CREATE TABLE items (id uuid);"],
    2,
    data.triggers,
  );
  assert.ok(findings.length >= 1);
});
