// spec-sections sensor の TDD。
// index: AC 番号・テストマトリクス・スコープ外 / レイヤー .md: 担保 AC 引用・テストケース・異常系 /
// 表示層（ui）: レスポンシブ節。出典は create-spec スキルのチェックリスト（機械チェック可能行のみ）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSpecSections } from "./spec-sections";

const FULL_INDEX = `# PROJ-1: サンプル機能
## 対象範囲
- 対象外（やらないこと）: 通知連携
## 受け入れ基準（AC）
- [ ] **AC-1**: 一覧が表示される
## テスト戦略
| AC | 種別 | レイヤー |
`;

const FULL_BACKEND = `# PROJ-1: service API 詳細設計
## 担保 AC（[index.md](./index.md) の AC からの引用）
- AC-1: 一覧が表示される
## テストケース（技法注記付き）
- [代表値] 正常入力で 1 件作成
## 異常系挙動
| ケース | ステータス |
`;

// --- index.md ------------------------------------------------------------------

test("[代表値] index.md: AC 番号・テスト戦略・対象外が揃う → findings 0", () => {
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-1-foo/index.md", FULL_INDEX), []);
});

test("[境界値] index.md: AC 番号なし → 節名入り finding", () => {
  const md = FULL_INDEX.replace("- [ ] **AC-1**: 一覧が表示される", "- [ ] 一覧が表示される");
  const findings = scanSpecSections("docs/spec/PROJ-1-foo/index.md", md);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /AC 番号/);
});

test("[境界値] index.md: テスト戦略見出し欠落 → finding", () => {
  const md = FULL_INDEX.replace("## テスト戦略", "## メモ");
  const findings = scanSpecSections("docs/spec/PROJ-1-foo/index.md", md);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /テスト戦略/);
});

test("[境界値] index.md: 対象外（スコープ外）の記載なし → finding", () => {
  const md = FULL_INDEX.replace("- 対象外（やらないこと）: 通知連携", "");
  const findings = scanSpecSections("docs/spec/PROJ-1-foo/index.md", md);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /対象外|スコープ外/);
});

// --- レイヤー .md（例: data / service / ui） -------------------------------

test("[代表値] service.md: 担保 AC・テストケース・異常系の 3 節あり → findings 0", () => {
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-1-foo/service.md", FULL_BACKEND), []);
});

test("[境界値] service.md: 異常系見出し欠落 → 節名入り finding", () => {
  const md = FULL_BACKEND.replace("## 異常系挙動", "## その他");
  const findings = scanSpecSections("docs/spec/PROJ-1-foo/service.md", md);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /異常系/);
});

test("[境界値] service.md: テストケース見出し欠落 → 節名入り finding", () => {
  const md = FULL_BACKEND.replace("## テストケース（技法注記付き）", "## メモ");
  const findings = scanSpecSections("docs/spec/PROJ-1-foo/service.md", md);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /テストケース/);
});

test("[代表値] 担保 AC 節が無いレイヤー .md（旧 spec）→ 検査対象外（誤検知させない）", () => {
  // spec-conformance-reviewer B-2 の「担保 AC 節なし = 旧 spec は N/A」と同じ判定基準。
  // 担保 AC 引用節を持たない旧 spec を誤検知しないための判定。
  const legacy = "# PROJ-0: service API 詳細設計\n## API パス増減\n- GET /api/v1/foo\n## エンドポイント詳細\n";
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-0-legacy/service.md", legacy), []);
});

test("[代表値] ui.md のみレスポンシブ節必須（service.md には要求しない）", () => {
  const frontendMd = FULL_BACKEND.replace("# PROJ-1: service API 詳細設計", "# PROJ-1: ui 詳細設計");
  // 3 節はあるがレスポンシブ節が無い ui.md → finding
  const findings = scanSpecSections("docs/spec/PROJ-1-foo/ui.md", frontendMd);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /レスポンシブ/);
  // 同内容でも service.md なら 0（レスポンシブ不要）
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-1-foo/service.md", FULL_BACKEND), []);
});

test("[代表値] ui.md: レスポンシブ節あり → findings 0", () => {
  const md =
    FULL_BACKEND + "### レスポンシブ / アクセシビリティ（必須・空通過不可）\n- 主対象: desktop\n";
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-1-foo/ui.md", md), []);
});

// --- 対象外ファイル ---------------------------------------------------------------

test("[代表値] _TEMPLATE / progress.md / questions.md / 未知ファイル名は検査対象外", () => {
  assert.deepEqual(scanSpecSections("docs/spec/_TEMPLATE/index.md", "# 雛形"), []);
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-1-foo/progress.md", "# 進行"), []);
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-1-foo/questions.md", "# 質問"), []);
  assert.deepEqual(scanSpecSections("docs/spec/PROJ-1-foo/notes.md", "# メモ"), []);
});
