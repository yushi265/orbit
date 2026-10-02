# 共有契約

## 担保AC

- **AC-8**: 期限を時刻を持たない日付として扱い、入力した暦日をTimezone変更後も維持する。入力・表示・UI Filter・検索APIは同じ暦日判定を行う。
- **AC-18**: 成功したRunをSettingsの最後の実行として表示できる。

## 契約

Issue期限の`dueAt: number | null`のwire/Snapshot形状を維持する。期限日は値のUTC年月日で、Owner/browser/serverのTimezoneへ変換しない。UIの入力は既存UTC midnight保存を維持する。API経由の既存非midnight値もUTC年月日として解釈し、既存値を書き換えない。

共有helperは`src/shared/issue-dates.ts`に置く。期限のUTC date key、nowのIANA timezone date key、none/overdue/today/upcoming判定、日付だけの表示をUI/serviceで再利用する。期限と比較するtodayは本人Timezoneの暦日。近日はtodayより後であり、Homeの7日範囲は暦日加算とする。Cycle境界、Project日付、Activity等のtimestampの意味を変えない。

公開helperは`issueDueDateKey(value: number): string`（UTCのYYYY-MM-DD）、`calendarDateKeyInTimeZone(value: number, timeZone: string): string`（nowの暦日）、`matchesIssueDueDate(dueAt: number | null, filter: 'none' | 'overdue' | 'today' | 'upcoming', now: number, timeZone: string): boolean`、`formatIssueDueDate(value: number, locale?: string): string`（month short/day numeric、timeZone UTC、locale既定ja-JP）とする。null時の画面の文言は各画面の既存仕様に従いhelperに含めない。

日付テストは東京/LA/UTCの同じ保存日・既存非midnight値・Timezone変更後の日付維持、日本の深夜とLA前日のtoday差、DST前後、Homeの暦日7日範囲、UI/API一致を確認する。入力の保存方式は従来どおりであり、今回の修正で別のtimestamp変換を導入しない。

Bootstrapのbackgroundへ`lastRun: PublicRunViewModel | null`を追加する。これはOwnerの最新requested_atのRunで、既存PublicRunの全statusを許す。Owner ID、Lease token、内部stepCursors、receipt等の非公開値は既存publicRunで除去する。

既存`background.run`はpending/running/paused/failedの進行中・復旧対象だけを返す。`GET /api/v1/background-runs/current`のnull/active契約は変更しない。`BootstrapViewModel.background.lastRun`はoptionalとし、旧Snapshot/既存test fixtureを受け入れる。StoreのBootstrapは常にlastRunを返す。

## テスト

- [状態遷移] 初期null、成功Runを含む最新結果、active優先の画面表示、再読込後も最後の実行を表示する。
- [アクセス境界] 他Ownerの最新Runを返さず、publicRunの非公開値を返さない。
