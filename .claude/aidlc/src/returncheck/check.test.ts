import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkReturn, type ReturnSchema } from "./check";

const implementer: ReturnSchema = {
  required: ["## RED 証跡", "## GREEN 証跡", "## 変更ファイル一覧", "## 申し送り"],
  contradictions: [{ if: "## GREEN 証跡", requires: "## RED 証跡" }],
};

const FULL = [
  "## RED 証跡",
  "TestX が期待どおり fail（出力抜粋）",
  "## GREEN 証跡",
  "go test ./... pass",
  "## 変更ファイル一覧",
  "- service/internal/domain/user/handler.go",
  "## 申し送り",
  "なし",
].join("\n");

test("全見出しあり → ok（代表値）", () => {
  const r = checkReturn(FULL, implementer);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.contradictions, []);
});

test("1 見出し欠落 → 見出し名入りで fail（境界値）", () => {
  const r = checkReturn(FULL.replace("## 申し送り\nなし", ""), implementer);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["## 申し送り"]);
});

test("デシジョンテーブル: GREEN あり × RED 欠落 → 矛盾（過去事故と同型の fixture）", () => {
  // 実事故: malformed 出力で「RED テストのみ・GREEN 欠落」が素通りした（learnings.md 2026-06-25）。
  // その双対（GREEN を主張しながら RED 証跡が無い = test-first の証明がない）を機械検知する。
  const greenOnly = ["## GREEN 証跡", "pass しました", "## 変更ファイル一覧", "- a.go", "## 申し送り", "なし"].join("\n");
  const r = checkReturn(greenOnly, implementer);
  assert.equal(r.ok, false);
  assert.ok(r.contradictions[0].includes("## RED 証跡"));

  // RED も GREEN も無い（両欠落）→ missing のみ・矛盾ではない
  const neither = ["## 変更ファイル一覧", "- a.go", "## 申し送り", "なし"].join("\n");
  const r2 = checkReturn(neither, implementer);
  assert.equal(r2.ok, false);
  assert.deepEqual(r2.contradictions, []);
});

test("見出しはあるが本文空 → 警告のみ（fail にしない・境界値）", () => {
  const emptyBody = ["## RED 証跡", "", "## GREEN 証跡", "pass", "## 変更ファイル一覧", "- a.go", "## 申し送り", "なし"].join("\n");
  const r = checkReturn(emptyBody, implementer);
  assert.equal(r.ok, true); // 中身の薄さは reviewer/referee の担当（守備範囲を守る）
  assert.equal(r.emptyWarnings.length, 1);
  assert.ok(r.emptyWarnings[0].includes("## RED 証跡"));
});

test("見出しの部分一致（後続文字あり）も認める", () => {
  const withSuffix = FULL.replace("## RED 証跡", "## RED 証跡（table-driven）");
  assert.equal(checkReturn(withSuffix, implementer).ok, true);
});

test("実 return-schemas.json が読めて 3 スキーマを含む（較正）", () => {
  const schemas = JSON.parse(
    readFileSync(new URL("../../return-schemas.json", import.meta.url), "utf8"),
  );
  for (const name of ["implementer-v1", "explore-v1"]) {
    assert.ok(schemas[name]?.required?.length >= 1, `${name} が無い/required が空`);
  }
});
