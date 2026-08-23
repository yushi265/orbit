# autonomy — 自律区間の機械検証ゲート（advisory）

human-in-the-loop → human-on-the-loop の要諦は **「人間ゲートを外す＝機械ゲートに置き換える」**。
その機械ゲートの中核が、自律区間で「**テストを甘くして緑にする**」を止める **anti-tamper 検出器**。

> **advisory（非強制）**。ティア→自律度マッピング（下記）は方針で、`risk-tiers.md` 本体はプロジェクトが人間承認のうえ明文化する。

## anti-tamper（test diff の改ざん検出）

`scanTestDiff(diff)` が unified diff を走査し、**既存テストの緩和**を検出する純粋関数:

| kind | 検出内容 |
|---|---|
| `test-removed` | 既存テスト宣言（`func Test…` / `it(` / `test(` / `describe(` / `def test…` 等）の削除 |
| `assertion-removed` | 既存 assertion（`assert` / `require` / `expect` / `t.Error` 等）の削除 |
| `skip-added` | `t.Skip` / `.skip(` / `.only(` / `xit` / `@pytest.mark.skip` / `#[ignore]` 等の追加 |
| `trivial-assertion` | `expect(true).toBe(true)` / `assert.True(t, true)` / `assert True` 等の自明 assertion 追加 |
| `test-commented-out` | テストのコメントアウト追加 |

**新規テスト・assertion の追加は検出しない**（緩和ではないため）。テストファイル判定・イディオムはプロジェクトの言語に合わせて調整する（`anti-tamper.ts` の regex 群・既定は主要言語をカバー）。

> `test-quality-reviewer` は「ファイル全体の grep（T-1〜T-6）」、本検出器は「**diff の改ざん**」を見る。役割が補完関係。

### 既知の限界（advisory・人間が最終判断）

- **assertion の置換・テストのリネーム・期待値の更新**は、削除側を `assertion-removed` / `test-removed` として報告する。これは「改ざんの容疑を人間に知らせるフィルタ」であり、正当な変更か緩和かの判断は人間が diff 全体で行う（値の方向＝緩和か厳格化かは判定しない）。
- **削除を伴わない緩和**（新しい弱い assertion を追加するだけ、ループ回数・テストデータを減らす等の意味的緩和）は構文では捕捉できない。`test-quality-reviewer`（T-2/T-5）と人間レビューで担保する。
- **コメント行の削除・編集**は改ざん扱いしない（コメントは検証ではない）。

## 使い方

```bash
# AI が直前に変更したテストの diff を検査（advisory）
git diff -- '*_test.*' '*.test.*' '*.spec.*' | pnpm -C .claude/aidlc referee

# diff ファイルを渡す / 改ざんありで exit 1
pnpm -C .claude/aidlc referee <diff-file> --strict

# テスト
pnpm -C .claude/aidlc test
```

## ティア → 自律度マッピング（方針）

| tier | モデル | Stage2〜8 | Gate3 |
|---|---|---|---|
| **1**（変更コストが高い領域） | **human-in-the-loop**（自律化しない・死守） | 各 Stage 人間が見る | blocking |
| **2**（機能追加） | **human-on-the-loop** | AI 連続自走（機械ゲートが守る） | blocking |
| **3**（typo/test/設定） | human-off 寄り | AI 自走 | blocking（事後） |

**原則**: 人間ゲートを外せるのは、決定論的な機械ゲート（権威 green = プロジェクトのテスト / lint の exit0 を独立 referee が再実行 + anti-tamper）が置き換える範囲だけ。**Tier 1 は死守**、自律は Tier 2/3 限定、**Gate 3 は全ティア残す**。失敗・改ざん候補は **halt-and-ask**（AI が握りつぶさない）。
