# FEAT-external-api-token AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: FEAT-external-api-token
- 機能概要: Cloudflare Access の Service Token で外部bot（Grok Bot）が既存`/api/v1`を Owner として使えるようにする。
- Stage 宣言の結果: Tier 1（認証境界）。全 Stage 実行、Gate 2 非委任。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-11-03 / 2026-11-03

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | 「一連の操作をAPIで」は新規endpoint不要で、既存`/api/v1`が画面操作をほぼ網羅していた。本題は認証だけだった |
| 2 spec 作成 | Service Token JWT のクレーム（`common_name`=Client ID、`sub`=""、emailなし）は公式ドキュメントの`index.md`版で確認できた。HTML版はナビゲーションしか取れない |
| 3+4 TDD | テストヘルパーのデフォルト引数が`undefined`を飲み込み、「未設定」ケースが誤ってgreenに見えかけた。`null`を番兵にした |
| 6 セルフレビュー | 最初のAC-5テストは自前スタブの201をassertする循環だった。実`createIssue`＋Memory Store＋`cloudflare:workers` mockに置き換えた |

## 振り返り（KPT）

### Keep（効いた・次も続ける）
- 外部連携の依頼でも、まず既存APIの網羅度を確認してから新規実装の要否を決める。

### Problem（詰まった・摩擦・想定外）

- `[tdd]` 結合テストで handler をスタブにすると AC の「作成・永続化」を検証できない（レビューで検出）。
- `[tooling]` docs に prettier を当てると既存の表まで再整形されて差分ノイズになる（このリポジトリの format 対象は oxfmt の指定パスのみ）。
- `[tdd]` `scripts/local.test.mjs` の書込不可ケースは root 実行のコンテナで常に失敗する（main でも再現・本変更と無関係）。

### Try（次ボルト以降でフローをこう変える）
- 認証境界の結合テストは `cloudflare:workers` を vi.mock して実 API ハンドラを通す形を標準にする。

## フロー改善アクション

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| 認証境界の結合テストは実ハンドラを通す | codekb/shared.md の罠として追記候補 | 未対応 |
