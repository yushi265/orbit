# FIX-api-boundary-hardening AI-DLC 振り返り学習ノート（retro note）

> このユニット（チケット）で**何を学んだか**を残す永続資産。`progress.md`（揮発・再開用）とは別物。
> 各 Stage の境界で notable な気づきだけ追記し、Gate 3 で KPT を蒸留する。
> 証跡（テスト数・ゲート結果）は progress.md / PR を指すポインタに留め、ここに転記しない。
> ループの全体像と還流先は [README.md](./README.md)。

## メタ

- ticket: FIX-api-boundary-hardening
- 機能概要: 監査 P1 の service 境界の入力検証漏れ4件（未知 action・冪等性キー欠落・一覧クエリ未検証・Body 上限すり抜け）を塞ぐ
- Stage 宣言の結果: Tier 1。全 Stage 実行（spec 必須）。Gate 2 は委任
- トークン実測: 未計測
- 着手日 / 完了日: 2026-10-07 / 2026-10-07

## 各 Stage の気づき（材料・軽量）

> notable なものだけ。摩擦・想定外・判断を 1〜2 行。無ければ省略してよい。

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | 4 件の挙動変更を AskUserQuestion 3 問 + Gate 1/2 選択 1 問に収め、質問数上限内で決め切れた |
| 2 spec 作成 | 監査時の「limit 未適用」指摘は誤りだった（store.ts で 1〜500 に丸め済み）。spec 化の前の実物確認で訂正できた |
| 3+4 TDD | seed に Issue が 4 件あり、件数の絶対値 assert（101 件）が落ちた。seed 依存は相対比較にした。テスト・実装ともメインループで直接書いた（小規模のため implementer 委譲を省略） |
| 5 静的解析 | gitleaks がクラウド環境に未導入で lefthook が exit 127。公式バイナリを scratchpad に置いて PATH 追加で回避（前ボルトに続き 2 回目） |
| 6 セルフレビュー | Must 0 / Should 6。テストの「対象不変」「既定値の中身」検証漏れを test-quality が検出。code は同文言インライン検査 3 箇所の共通化漏れを検出 |
| 8 成果提示 | — |

## 振り返り（KPT）

> Gate 3 で蒸留する。このノートの主役。

### Keep（効いた・次も続ける）
- 監査結果を spec 化前に実物確認し、誤指摘（limit 未適用）を契約に持ち込まなかった
- mutation（既定 limit 変更）で強化テストが実際に効くことを確認した

### Problem（詰まった・摩擦・想定外）

> 各項目の先頭に分類タグ `[カテゴリ]` を付ける（棚卸しでの再発チェック集計キー）。
> カテゴリ: `spec` / `tdd` / `review` / `gate` / `boundary` / `security` / `tooling` / `other`。

- `[tooling]` gitleaks 未導入のクラウド環境で pre-commit が毎回止まる（2 ボルト連続）
- `[tdd]` 正常系テストが status 200 だけを見て、既定値・対象不変などの中身を検証していなかった（review で発覚）

### Try（次ボルト以降でフローをこう変える）
- SessionStart hook で gitleaks を導入する（既存の未対応 Try と同一）
- 異常系テストには「対象が変わっていないこと」の assert を定型で入れる（tdd-cycle のテストリスト観点に追加）

## フロー改善アクション

> 各 Try を「ハーネスのどこに還流するか」へ割り付ける。還流先は [README.md](./README.md) の表に従う。

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| SessionStart hook で gitleaks 導入 | SessionStart hook / 環境セットアップ | 未対応 |
| 異常系テストに対象不変 assert を定型化 | .claude/skills/tdd-cycle/SKILL.md | 未対応 |
