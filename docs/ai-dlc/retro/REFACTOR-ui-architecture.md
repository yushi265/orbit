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

## Phase 1（components/ui 抽出）ボルト — 2026-10-07

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 3+4 | 1 ファイル内の抽出なので並列化せずメインループで文字列ブロック単位に移動。日付 helper の統合は旧実装を test 内に固定して出力一致を先に確認 |
| 5 | 抽出先の mutation check で `dismissOpenCalendar` のフォーカス復帰が既存テストで守られていない（既存の欠落）ことが判明し、単体テストを追加 |
| 6 | 3 体とも Must 0。Should は未テスト helper の代表値テストと未使用 export の内部化 |

### Keep
- 「移動したコードを一時的に壊して既存テストが落ちるか」を確認することで、移動前から存在したテストの穴を見つけられた

### Problem
- `[tdd]` 振る舞い不変リファクタでも、移動対象に既存テストが届いていない関数があった（回帰網の過信）

### Try
- 抽出・移動する関数ごとに 1 回は mutation check を行い、生き残ったら移動と同じ PR でテストを足す

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| 抽出・移動時は関数ごとに mutation check | .claude/skills/tdd-cycle/SKILL.md（リファクタ時） | 未対応 |

## Phase 2（データ層 lib/queries）ボルト — 2026-10-07

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 0+1 | 調査で spec の穴を 3 点（`["issues"]` 前方一致の invalidate、trash 後の再取得、新規の追加位置）と、`*MutationKeyRef` に保持型と入力比較型の 2 種があることを発見。signature の扱いを Gate 1 で人間が決定 |
| 3+4 | Gate 2 承認後に、spec の「新規は先頭追加」が既存テスト（末尾追加を固定）とぶつかることが判明し、実装前に人間へ再確認して spec を修正 |
| 5 | mutation check で、9 か所の冪等キー置換のうち 8 か所が既存テストで守られていないことが判明 → テストを追加 |

### Keep
- Phase 1 の Try（置換箇所ごとの mutation check）を適用し、置換の正しさが既存テストに守られていない箇所を Gate 3 前に見つけられた

### Problem
- `[spec]` Gate 2 の時点で、spec の具体値（追加位置）を既存テストの期待値と突き合わせていなかった

### Try
- spec に既存挙動の具体値（順序・形状）を書くときは、その値を固定している既存テストを grep してから Gate 2 に出す

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| 既存挙動の具体値は既存テストと突き合わせてから Gate 2 | .claude/skills/create-spec/SKILL.md（現実装の調査手順） | 未対応 |

## Phase 3a（ルート構造と型付き遷移）ボルト — 2026-10-07

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 0+1 | Phase 3 全体を Plan エージェントで棚卸しし、spec の穴 14 点を洗い出した。1 PR ではレビュー不能と判断し、4 PR に分割することを Gate 1 で合意 |
| 3+4 | AC-5 の「`to` の型検査」は router の型が `string` を素通しするため `as never` 0 件だけでは担保できず、リポジトリ検査を追加 |
| 5 | mutation check で、`validateSearch` の移動が観測不能（root の生 search が子へ漏れる既存挙動）と判明。範囲外として別タスク化 |

### Keep
- 振る舞い不変の移動でも mutation check をしたことで、正規化が実質効いていない既存の不具合を見つけられた

### Problem
- `[spec]` AC-1 の「同じ正規化結果」は、正規化が観測できるかを確かめないまま書いていた

### Try
- 正規化・変換を AC にするときは、変換をしないと画面が変わる入力を 1 つ挙げてから AC に書く

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| 正規化系の AC は観測可能な入力例を添える | .claude/skills/create-spec/SKILL.md（AC の観測手段） | 未対応 |
