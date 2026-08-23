import { test } from "node:test";
import assert from "node:assert/strict";
import { scanTestDiff } from "./anti-tamper";

test("既存 Go テスト関数の削除を検出（test-removed）", () => {
  const diff = `diff --git a/service/foo_test.go b/service/foo_test.go
--- a/service/foo_test.go
+++ b/service/foo_test.go
@@ -5,6 +5,3 @@
 func TestKept(t *testing.T) {
	_ = 1
 }
-func TestRemoved(t *testing.T) {
-	assert.Equal(t, 1, want)
-}
`;
  const f = scanTestDiff(diff);
  assert.ok(f.some((x) => x.kind === "test-removed"));
  assert.ok(f.some((x) => x.kind === "assertion-removed"));
});

test("assertion の削除を検出（assertion-removed）", () => {
  const diff = `--- a/x.test.ts
+++ b/x.test.ts
@@ -1,3 +1,2 @@
 it("works", () => {
-  expect(result).toBe(42);
 });
`;
  const f = scanTestDiff(diff);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "assertion-removed");
});

test("t.Skip / it.only / xit の追加を検出（skip-added）", () => {
  const goDiff = `--- a/a_test.go
+++ b/a_test.go
@@ -1,2 +1,3 @@
 func TestX(t *testing.T) {
+	t.Skip("flaky")
 }
`;
  assert.equal(scanTestDiff(goDiff)[0].kind, "skip-added");

  const tsDiff = `--- a/b.test.ts
+++ b/b.test.ts
@@ -1,1 +1,1 @@
+describe.only("x", () => {})
`;
  assert.ok(scanTestDiff(tsDiff).some((x) => x.kind === "skip-added"));
});

test("自明な assertion の追加を検出（trivial-assertion）", () => {
  const diff = `--- a/c.test.ts
+++ b/c.test.ts
@@ -1,1 +1,2 @@
 it("x", () => {
+  expect(true).toBe(true);
`;
  assert.equal(scanTestDiff(diff)[0].kind, "trivial-assertion");
});

test("Go の自明 assertion（assert.True(t, true)）も検出", () => {
  const diff = `--- a/g_test.go
+++ b/g_test.go
@@ -1,1 +1,2 @@
 func TestG(t *testing.T) {
+	assert.True(t, true)
`;
  assert.equal(scanTestDiff(diff)[0].kind, "trivial-assertion");
});

test("テストのコメントアウト追加を検出（test-commented-out）", () => {
  const diff = `--- a/d_test.go
+++ b/d_test.go
@@ -1,1 +1,1 @@
-func TestD(t *testing.T) {
+// func TestD(t *testing.T) {
`;
  assert.ok(scanTestDiff(diff).some((x) => x.kind === "test-commented-out"));
});

test("テストでないファイルの変更は無視", () => {
  const diff = `--- a/service/foo.go
+++ b/service/foo.go
@@ -1,2 +1,1 @@
-	assert.Equal(t, 1, 2)
`;
  assert.deepEqual(scanTestDiff(diff), []);
});

test("新規テスト・assertion の追加は検出しない（緩和でない）", () => {
  const diff = `--- a/e.test.ts
+++ b/e.test.ts
@@ -1,1 +1,4 @@
 describe("e", () => {
+  it("new", () => {
+    expect(foo()).toBe(3);
+  });
`;
  assert.deepEqual(scanTestDiff(diff), []);
});

test("行番号を旧側で報告（削除行）", () => {
  const diff = `--- a/f.test.ts
+++ b/f.test.ts
@@ -10,3 +10,2 @@
 a
-  expect(x).toBe(1);
 b
`;
  const f = scanTestDiff(diff);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 11); // context a=10, 削除 expect=11
});

test("複数ファイル・複数違反を横断で集約", () => {
  const diff = `--- a/p_test.go
+++ b/p_test.go
@@ -1,3 +1,1 @@
-func TestP(t *testing.T) {
-	require.NoError(t, err)
-}
--- a/q.test.ts
+++ b/q.test.ts
@@ -1,1 +1,2 @@
 it("q", () => {
+  it.skip("later", () => {})
`;
  const f = scanTestDiff(diff);
  assert.ok(f.some((x) => x.file.endsWith("p_test.go") && x.kind === "test-removed"));
  assert.ok(f.some((x) => x.file.endsWith("q.test.ts") && x.kind === "skip-added"));
});

// --- 堅牢化 / 既知の限界の固定（Stage 6 レビュー反映） ---

test("削除された行がコメントなら test-removed/assertion-removed を出さない（コメント削除は改ざんでない）", () => {
  const diff = `--- a/x_test.go
+++ b/x_test.go
@@ -1,2 +1,1 @@
-// func TestOld(t *testing.T) { 旧コメント
 keep
`;
  assert.deepEqual(scanTestDiff(diff), []);
});

test("__tests__/ 配下のファイルも test として扱う", () => {
  const diff = `--- a/src/__tests__/foo.ts
+++ b/src/__tests__/foo.ts
@@ -1,1 +1,1 @@
+  it.skip("x", () => {})
`;
  assert.ok(scanTestDiff(diff).some((x) => x.kind === "skip-added"));
});

test("既知の特性: assertion 置換（toBe→toBeDefined）は削除側を報告（値の妥当性は人間判断）", () => {
  const diff = `--- a/x.test.ts
+++ b/x.test.ts
@@ -1,3 +1,3 @@
 it("x", () => {
-  expect(x).toBe(42);
+  expect(x).toBeDefined();
`;
  const f = scanTestDiff(diff);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "assertion-removed");
});

test("既知の特性: テストのリネームは test-removed として報告（advisory・人間がリネームか削除か判断）", () => {
  const diff = `--- a/x_test.go
+++ b/x_test.go
@@ -1,1 +1,1 @@
-func TestOld(t *testing.T) {
+func TestNew(t *testing.T) {
`;
  const f = scanTestDiff(diff);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "test-removed");
});
