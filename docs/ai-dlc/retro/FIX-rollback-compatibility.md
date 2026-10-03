# FIX-rollback-compatibility AI-DLC振り返り

## メタ
- ticket: FIX-rollback-compatibility
- 機能概要: 旧版へ戻せるSnapshot保存とバックアップコピー検証。
- Stage宣言: Tier 1、全Stage実行。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-10-02 / 2026-10-02（実装・レビュー完了、本番反映は認証済smoke待ち）

## 各Stageの気づき
| Stage | 気づき |
|---|---|
| 2 | 前方互換だけではrollback契約にならない。実旧Storeによる読み書き往復が必要。 |
| 2 | 同msの同fallback明示保存はtimestampで見分けられずReceipt key差分を要する。 |
| 5 | 同ms旧保存のReceiptまで削除すると情報が失われる。旧版中のMaintenance Runを避ける運用前提を明記。 |
| 2 | 既存OAuthでD1再読込成功。新権限追加なしでbackupコピー復元を確認できた。 |
| 6 | metadataの非空・重複・安全整数guardへ52境界ケースを追加。guard除去のprivateコピーで退行検出を確認し、元実装のRED先行証跡と区別した。 |
| 8 | code/spec/testの独立レビュー、root抜き取りと全ゲート再実行を完了。本番smokeはログイン待ちとして切替工程を保留した。 |

## 振り返り（KPT）
### Keep
- 実旧Storeと本番のprivateコピーで検証する。
### Problem
- [boundary] 新enum追加時に旧strict保存契約のrollbackが未検証だった。
### Try
- 保存契約のenum拡張で旧版読込と旧編集後の新版再読込を検証する。

## フロー改善アクション
| Try | 還流先 | ステータス |
|---|---|---|
| 旧版往復検証 | docs/ai-dlc/codekb/shared.md | 追記済み |
