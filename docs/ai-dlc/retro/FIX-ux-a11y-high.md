# FIX-ux-a11y-high AI-DLC 振り返り学習ノート（retro note）

> このユニット（チケット）で**何を学んだか**を残す永続資産。`progress.md`（揮発・再開用）とは別物。
> 各 Stage の境界で notable な気づきだけ追記し、Gate 3 で KPT を蒸留する。
> 証跡（テスト数・ゲート結果）は progress.md / PR を指すポインタに留め、ここに転記しない。
> ループの全体像と還流先は [README.md](./README.md)。

## メタ

- ticket: FIX-ux-a11y-high
- 機能概要: 2026-10-06 の監査で High 判定だった UX 7 件と WCAG 2.2 AA 7 件を ui レイヤーで修正
- Stage 宣言の結果: Tier 2・全 Stage 実行（spec は単一レイヤーだが 14 項目のため作成）・Gate 2 委任
- トークン実測: 未計測
- 着手日 / 完了日: 2026-10-06 / 2026-10-06

## 各 Stage の気づき（材料・軽量）

> notable なものだけ。摩擦・想定外・判断を 1〜2 行。無ければ省略してよい。

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | 監査結果のうち Tier 1 に波及する案（一括 Label の追加モード・ショートカット設定の同期）を Gate 1 で選択肢として示し、ui のみに収めた |
| 2 spec 作成 | Cycle 完了時の「次の Cycle が無い」文言を未確定のまま spec にしたが、実装時に API の挙動（必ず次 Cycle を作る）で解消した |
| 3+4 TDD | `OrbitApp.tsx` が 9000 行の単一ファイルのため、CSS と TS を担当分けして並列にし、TS は直列にした。T2/T3 の担当が整形ツールを手動実行し、整形だけの差分が 30 か所混入した |
| 5 静的解析 | gitleaks がコンテナに未導入で pre-commit が失敗。scratchpad に取得して実行した。`scripts/local.test.mjs` の EACCES は root 実行による既存の失敗（main でも再現） |
| 6 セルフレビュー | 3 体とも整形ノイズと既存テスト変更理由の未記録を指摘。combobox の判定経路はテストが無く、追加後にミューテーションで検出力を確認した |
| 8 成果提示 | 実ブラウザでの見た目確認は未実施（jsdom の範囲外）として申し送り |

## 振り返り（KPT）

> Gate 3 で蒸留する。このノートの主役。

### Keep（効いた・次も続ける）
- 監査（read-only）→ 優先度付け → Gate 1 で Tier 1 波及案を選択肢化、の流れで修正範囲を ui に閉じられた
- 色のコントラストを styles.css から計算する単体テストにしたことで、AA の基準を回帰テストとして残せた

### Problem（詰まった・摩擦・想定外）

> 各項目の先頭に分類タグ `[カテゴリ]` を付ける（棚卸しでの再発チェック集計キー）。
> カテゴリ: `spec` / `tdd` / `review` / `gate` / `boundary` / `security` / `tooling` / `other`。

- `[tooling]` implementer が `oxfmt` を手動で実行し、AC と無関係な整形差分が混入した（oxfmt --check は両方の書き方を許容するため、ゲートで検出できない）
- `[tdd]` 既存テストを変更した理由を、各 implementer が progress.md に残さなかった（anti-tamper が 11 件検出）
- `[tooling]` gitleaks がクラウド環境に未導入で pre-commit が通らない

### Try（次ボルト以降でフローをこう変える）
- implementer への委譲定型文に「整形ツールは変更したファイルの変更行に限る／整形だけの差分を出さない」と「既存テストを変えたら progress.md に理由を 1 行」を加える
- クラウド環境の SessionStart で gitleaks を導入する

## フロー改善アクション

> 各 Try を「ハーネスのどこに還流するか」へ割り付ける。還流先は [README.md](./README.md) の表に従う。

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| implementer 委譲定型文に整形範囲と既存テスト変更理由の記録を追加 | .claude/agents/implementer.md | 未対応 |
| クラウド環境で gitleaks を導入 | SessionStart hook / 環境セットアップ | 未対応 |
