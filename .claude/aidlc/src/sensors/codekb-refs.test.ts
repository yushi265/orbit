import { test } from "node:test";
import assert from "node:assert/strict";
import { scanCodekbRefs } from "./codekb-refs";

test("実在パスのみ → 指摘なし（代表値）", () => {
  const md = "## 部品\n- orm（参照: `service/db/queries/`）\n- compose（参照: `compose.yaml`）";
  const exists = new Set(["service/db/queries/", "compose.yaml"]);
  assert.deepEqual(
    scanCodekbRefs(md, (p) => exists.has(p)),
    [],
  );
});

test("切れパス 1 件 → 1 件指摘（パス名入り・代表値）", () => {
  const md = "- 旧構成（参照: `service/legacy/gone.go`）";
  const findings = scanCodekbRefs(md, () => false);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "service/legacy/gone.go");
  assert.ok(findings[0].line >= 1);
});

test("参照: 行ゼロのファイル → 指摘なし（境界値・強制しない）", () => {
  assert.deepEqual(scanCodekbRefs("# codekb: x\n本文だけ", () => false), []);
});

test("1 行に複数の 参照: があっても全部検査する", () => {
  const md = "- A（参照: `a.md`）と B（参照: `b.md`）";
  const findings = scanCodekbRefs(md, (p) => p === "a.md");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "b.md");
});
