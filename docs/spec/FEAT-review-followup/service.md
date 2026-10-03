# Service

## 担保AC

- **AC-1**: HomeのOpen Issues、Active Projects、期限区分、Current Cycleから、表示件数に対応する一覧または詳細へ遷移できる。個別Issue/Projectのリンクも維持する。
- **AC-7**: 更新日・作成日・タイトル・Status・Priority・期限それぞれの昇順/降順を選択し、URLとProject表示設定へ保存できる。

FIX-main-review AC-17 / AC-18は該当する既存レイヤーspecを参照する。
## 実装契約

期限Filterへnext7を追加する。Queryの他の意味は変えない。Project表示設定は追加Order/Due値を保存し、既存のOwner/version/receipt境界で復元する。Run public投影を再利用し、OwnerやLease token等の内部値を返さない。receiptのexpiresAtから更に30日待つ条件を除き、期限を過ぎたらPurgeする。

## テスト戦略

期限の前/一致/後、latestRunの全status/同Owner/旧Snapshot、Project設定の新旧保存値、service/UI共有Filterの7/8日を確認する。
