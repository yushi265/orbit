# FIX-main-review: main実装レビューの修正

## 概要

main `15eb0eb` のローカルD1・ブラウザレビューで整理した19件を、P1、P2、P3の順に修正する。ユーザーは2026-10-02に、新規ブランチの作成と優先度順の修正・コミットを明示的に依頼した。

## 対象範囲

- [service.md](./service.md): Issue取得、Run、Cycle繰越、Purge、参照整合性。
- [ui.md](./ui.md): Run復旧、レスポンシブ、Dialog、一覧状態、検索・作成・保存。
- [shared.md](./shared.md): Bootstrapの最新Run結果を後方互換で追加。
- データの正規化移行、認証変更、通知生成、Saved Viewの新機能、大規模分割は対象外。
- 既存の `CLAUDE.md` 差分は保持し、コミット対象に含めない。

## 受け入れ基準

- **AC-1**: Bootstrapは本人のActive Issueを100件・500件で打ち切らず、Project/Cycle/Homeの表示と集計に欠落がない。
- **AC-2**: 実行中Runの再読込・通信中断後も進捗を再取得し、安全にcontinueできる。Lease失効時は再開導線が表示される。
- **AC-3**: 有効な長いProject名を含むIssue Filterは1440px・390px幅でページ全体を横にはみ出さない。
- **AC-4**: 390×600のComposerでタイトル・作成・キャンセルへスクロールして到達できる。
- **AC-5**: Darkの親子Issue欄はテーマに対応した背景と読める文字色を使う。
- **AC-6**: Issue詳細・Composer・Command Paletteの初期Focus、Tab巡回、復帰とEscapeがDialogの境界を守る。
- **AC-7**: Issue Filter・Mode・OrderをURLから復元し、詳細往復・再読込で保持する。
- **AC-8**: 期限を時刻を持たない日付として扱い、入力した暦日をTimezone変更後も維持する。入力・表示・UI Filter・検索APIは同じ暦日判定を行う。
- **AC-9**: 25件超のPurge/Outbox対象を同じRunで処理し、対象が残る間はStepを完了しない。cursor再送はNo-opである。
- **AC-10**: Cycle完了時に501件以上のUnstarted/Startedも漏れなく次Cycleへ繰り越す。
- **AC-11**: Purgeで対象IssueのNote/Relation/Recent等を削除し、生存する子Issueの親参照を解除する。
- **AC-12**: 競合で拒否したRunの終端状態をD1に保存し、同じKeyで後から新規起動しない。
- **AC-13**: 指定したCycleが不存在・他OwnerならIssue作成を404で拒否し、副作用を残さない。
- **AC-14**: 古い検索応答・失敗が新しい検索結果や空検索を上書きしない。
- **AC-15**: Project作成の連打・保存中のEnterを重複送信せず、IME確定Enterでは作成しない。
- **AC-16**: Autosaveの409後に最新IssueをDetailと一覧Cacheへ同期する。
- **AC-17**: Mutation receiptはexpiresAtの期限を過ぎたらPurge対象になる。
- **AC-18**: 成功したRunをSettingsの最後の実行として表示できる。
- **AC-19**: 1024pxの長いProject名でも操作ボタンの文字が細かく折り返されない。

## 判断根拠・既存実装との関係

既存OrbitStore/SnapshotとAPI Envelopeを維持する。表示用listIssuesのlimitを業務対象の抽出へ流用しない。Runの既存cursor・Lease・同時Request CASを再利用する。新しい外部サービス・DB Migrationは追加しない。Run進捗取得・URL状態・Focus trapは既存MVP specの契約を満たす修正とする。

期限はユーザー回答「期限は日付で扱う」により、既存UIが保存してきたUTC midnightの数値を暦日のcarrierとして維持する。既存値のUTC年月日をそのまま期限日と解釈し、Migrationを行わない。今日の判定だけは本人Timezoneの現在の暦日を使う。

## テスト戦略

- [境界値] 100/101/501件のBootstrap、25/26/51件のChunk、500/501件の繰越。
- [状態遷移] Run再読込・通信中断・Lease失効・Resume・同じcursor再送・拒否Key再送。
- [アクセス境界] Bootstrap、参照検証、Purge、拒否RunのOwner分離。
- [状態遷移/故障注入] 検索応答順逆転、連打、IME、Autosave競合、DialogのFocus。
- [代表値/境界値] URL条件復元と不正値の既定値、期限のUTC正負オフセットと日付境界。
- CSS変更は実Browserで上記viewport・Dark/Lightを実測する。CSS文字列だけの検査を挙動の証拠にしない。

## コミット順序

P1の取得欠落、P1のRun復旧、P2のデータ整合性、P2のUI/操作、P2の日付契約、P3の運用表示・整形の順で、独立した目的ごとにコミットする。
