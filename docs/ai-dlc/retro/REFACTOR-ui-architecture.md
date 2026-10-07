# REFACTOR-ui-architecture AI-DLC 振り返り学習ノート（retro note）

> このユニット（チケット）で**何を学んだか**を残す永続資産。`progress.md`（揮発・再開用）とは別物。
> 各 Stage の境界で notable な気づきだけ追記し、Gate 3 で KPT を蒸留する。
> 証跡（テスト数・ゲート結果）は progress.md / PR を指すポインタに留め、ここに転記しない。
> ループの全体像と還流先は [README.md](./README.md)。

## メタ

- ticket: REFACTOR-ui-architecture
- 機能概要: OrbitApp.tsx（9,439 行）の疑似ルーティング（section state）を実ルーティング + features/ 分割へ移す設計 spec と 6 Phase の移行計画
- Stage 宣言の結果: Tier 1。spec のみのボルト（Stage 3+4 は N/A、各 Phase で実施）。Gate 2 委任
- トークン実測: 未計測
- 着手日 / 完了日: 2026-10-07 / 2026-10-07

## 各 Stage の気づき（材料・軽量）

> notable なものだけ。摩擦・想定外・判断を 1〜2 行。無ければ省略してよい。

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | スコープ（spec のみ）・API 不変・URL 完全互換・Gate 2 委任を 1 回の AskUserQuestion で確定 |
| 2 spec 作成 | spec 執筆時にショートカット（`g`+キー）と not-found 挙動を推測で書いてしまい、実コード照合で訂正した。挙動の記述は書く前に該当行を読む |
| 3+4 TDD | N/A（spec のみのボルト） |
| 5 静的解析 | docs のみで lint / format は対象外。gitleaks は scratchpad のバイナリで実行（3 ボルト連続） |
| 6 セルフレビュー | 1 回目 Must 5（AC-5 の対象範囲が実現不能、Phase 0 の弱化歯止めなし、根拠数値の誤り等）、再レビューで新規 Must 1。spec の数値・挙動の主張を実コードで裏取りさせると誤りが確実に出た |
| 8 成果提示 | — |

## 振り返り（KPT）

> Gate 3 で蒸留する。このノートの主役。

### Keep（効いた・次も続ける）
- 調査を Explore 3 体（shell / data / views）に分けて並列化し、spec 2b の材料が 1 往復で揃った
- レビュアーに「spec の主張を実コードで裏取り」を明示したことで、数値（30→35 コンポーネント、15→9 か所）と実現不能な AC を検出できた

### Problem（詰まった・摩擦・想定外）

> 各項目の先頭に分類タグ `[カテゴリ]` を付ける（棚卸しでの再発チェック集計キー）。
> カテゴリ: `spec` / `tdd` / `review` / `gate` / `boundary` / `security` / `tooling` / `other`。

- `[spec]` 挙動・数値を推測で書いた箇所（`g`+キーのショートカット、useIdempotentMutation の 15 か所、AC-5 の対象範囲）が 3 件あり、レビュー往復が増えた
- `[spec]` AC を「〜しない」「同等以上」のような観測しにくい表現で書き、テスト設計レビューで書き直しになった
- `[tooling]` gitleaks 未導入で 3 ボルト連続の回避運用

### Try（次ボルト以降でフローをこう変える）
- spec の数値・行番号・挙動の記述は、書く時点で grep / 該当行の読み取り結果を添える（2b 執筆時のセルフチェック）
- AC は「対象ディレクトリ」「観測手段（DOM 同一性・fake timers 等）」を本文に含めて書く

## フロー改善アクション

> 各 Try を「ハーネスのどこに還流するか」へ割り付ける。還流先は [README.md](./README.md) の表に従う。

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| spec の数値・挙動記述に裏取り結果を添える | .claude/skills/create-spec/SKILL.md（手順 4） | 未対応 |
| AC に対象範囲と観測手段を含める | .claude/skills/create-spec/SKILL.md（手順 5） | 未対応 |
| SessionStart hook で gitleaks 導入 | SessionStart hook / 環境セットアップ | 未対応（既存 Try と同一） |

## Phase 0（テスト基盤）ボルト — 2026-10-07

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 0+1 | 本番 routeTree を jsdom で描画できるかを捨てスパイクで先に確認し、spec の前提 2 点（QueryClient の別インスタンス化・root 描画）を Gate 1 で修正できた |
| 3+4 | 5 グループ並列の移行で、2 グループが実ルーターの `router.navigate` spy assert（resetScroll・回数）を「navigate モック assert」と誤認して削除した。オーケストレーター監査（diff の expect 削除行の目視）で検出し復元 |
| 3+4 | worker の mutation check が権限拒否で未実施になったグループがあり、メインループで代行した |
| 5 | ベースライン記録時に既存の flaky テスト（local backup/restore）が 1 回 fail。単体・再実行で pass を確認し既知 fail から除外、別タスク化 |
| 6 | 重複 ID（it.each）で「同名・同数」が崩れる穴をレビューが検出（1418 件中一意 1383）。件数突合に修正 |

### Keep
- 先に捨てスパイクで技術前提を確かめ、Gate 1 で spec 差分として合意してから実装した
- オーケストレーターが「削除された expect 行」を機械抽出して監査し、worker の弱化を捕まえられた

### Problem
- `[tdd]` 移行ブリーフの「navigate モック assert は location へ置換」が、実ルーターの spy assert まで巻き込む解釈を許した（対象の定義が曖昧）
- `[tooling]` worktree の worker が本番ファイルの一時改変（mutation check）を権限で拒否されることがある

### Try
- 移行ブリーフでは「置換対象＝vi.mock で作ったモックへの assert のみ。実オブジェクトへの spy は維持」と明記する
- mutation check を worker に課す場合、拒否されたらメインループで代行する前提をブリーフに書く

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| 移行ブリーフでモック assert と実 spy assert を区別する | .claude/skills/tdd-cycle/SKILL.md（リファクタ時の注意） | 未対応 |
| worker の mutation check 拒否時はメインループで代行 | .claude/skills/ai-dlc-flow/SKILL.md（受領検査） | 未対応 |
