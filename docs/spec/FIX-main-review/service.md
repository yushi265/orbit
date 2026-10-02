# サービス層

## 担保AC

- **AC-1**: Bootstrapは本人のActive Issueを100件・500件で打ち切らず、Project/Cycle/Homeの表示と集計に欠落がない。
- **AC-9**: 25件超のPurge/Outbox対象を同じRunで処理し、対象が残る間はStepを完了しない。cursor再送はNo-opである。
- **AC-10**: Cycle完了時に501件以上のUnstarted/Startedも漏れなく次Cycleへ繰り越す。
- **AC-11**: Purgeで対象IssueのNote/Relation/Recent等を削除し、生存する子Issueの親参照を解除する。
- **AC-12**: 競合で拒否したRunの終端状態をD1に保存し、同じKeyで後から新規起動しない。
- **AC-13**: 指定したCycleが不存在・他OwnerならIssue作成を404で拒否し、副作用を残さない。
- **AC-17**: Mutation receiptはexpiresAtの期限を過ぎたらPurge対象になる。
- **AC-18**: 成功したRunをSettingsの最後の実行として表示できる。

## 契約

- Bootstrapの既存issues配列を本人の全Active Issueとして返す。archive/trash/他Ownerは含めない。外部listIssuesの既定100・上限500は今回のAC-1では変更しない。
- 内部の全対象抽出と表示上限を分離する。listIssuesの順序・フィルターは維持する。
- Run Stepは1回最大25対象。残件がある間は同じStepと新しいopaque cursorを返す。成功済みcursorの再送は業務効果を重複させない。
- Cycle繰越は全件を対象にし、カテゴリ・History/Outboxの既存契約を保つ。
- PurgeはOwnerの対象と依存データだけを削除し、生存する子の親参照解除でversion/更新時刻を整合させる。
- 拒否Runだけは423でも終端状態を保存する。他の失敗Requestの業務Mutationを保存するようには広げない。
- 不存在Cycleは404。receipt・採番・Issue・Activity/Outboxを作らない。
- AC-18はBootstrapの`background.lastRun`へ本人の最新Run（requested_at降順、currentがあればそれを含む）を追加する。`background.run`と`GET /background-runs/current`は従来どおりpending/running/paused/failedだけを返す。UI型は旧fixtureとの互換性のためlastRunをoptionalとして受け入れる。Migrationは不要。
- AC-8の期限処理は人間の回答後に親が契約を追記する。先行実装しない。

## テストケース

100/101/501件のBootstrapとOwner/archive/trash除外を実Store/APIで確認する。26/51件・混在対象、繰越501件、Purge依存/他Owner、receipt期限直前/ちょうど/直後、D1 Sessionの拒否Run保存とキー再送、不正Cycleの副作用なしをTDDで確認する。
