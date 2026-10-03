# 共有契約

## 担保AC

- **AC-1**: HomeのOpen Issues、Active Projects、期限区分、Current Cycleから、表示件数に対応する一覧または詳細へ遷移できる。個別Issue/Projectのリンクも維持する。
- **AC-7**: 更新日・作成日・タイトル・Status・Priority・期限それぞれの昇順/降順を選択し、URLとProject表示設定へ保存できる。

FIX-main-review AC-17 / AC-18は該当する既存レイヤーspecを参照する。
## 実装契約

ProjectIssueDisplayOrderへindex.mdの逆方向6値、DueFilterへnext7を追加する。既存値・保存形状を維持する。matchesIssueDueDateはnext7を受け付け、本人Timezoneの今日より後〜7暦日後を含む。同じ判定をUI/serviceで使う。

Bootstrap.background.lastRunはoptional PublicRunViewModel|null。Storeは常に本人の最新requested_atのRunを返す。既存background.run/current APIは復旧可能Runのみのまま。

同一requested_atなら既存Run集合への新しい挿入順を優先し、Snapshot復元後も維持する。新fieldは追加しない。

## テスト戦略

追加/既存enum、旧Snapshot、7/8日・DST・Owner・public投影を確認する。
