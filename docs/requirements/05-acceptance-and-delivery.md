# 12. 画面一覧

| 画面 | 主な内容 | Mobile差分 |
| --- | --- | --- |
| Home | Current Cycle、期限超過・期限接近、Recently updated | Card中心 |
| Issues | List / Board、Filter、Group、Bulk action、Archived Filter / 復元 | List優先、FilterはBottom sheet |
| Cycle list | Current、Upcoming、Past | 横SwipeまたはSelect |
| Cycle detail | Summary、Graph、Issues、Status / Priority / Project別内訳 | Summaryを折りたたみ表示 |
| Project list | List / Board、Progress、Archived Filter / 復元 | Card密度を下げる |
| Project detail | Overview、Issues、Progress | Section navigation |
| Issue detail | Title、Description、Properties、Relations、Notes、Activity | Full screen route |
| Search | Query、Recent、Result、Filter | 下部タブからFull screen |
| Inbox | Notification list、Detail link | 下部タブ |
| Saved Views | 保存View一覧 | 1列 |
| Trash | 論理削除済みデータ、削除予定日、復元 | Settings配下のFull screen route |
| Settings | Profile、Workflow、Cycle、Estimate、Label、Project status、通知、言語、Theme、Background processing / Run now | 項目ごとに下層Route |

Cloudflare Accessが提供する認証画面はアプリ画面一覧の対象外とする。

# 13. 受入シナリオ

## AC-01 Issue作成

```gherkin
Given 本人がログインしてIssuesを開いている
When Cを押してタイトルを入力しEnterで確定する
Then Preview環境でEnter確定からServer採番済みIssueが一覧へ描画されるまでのp95が1秒以内である
And `TASK-123`形式のIssue番号が採番される
And URLを開くと同じIssue詳細を表示できる
```

## AC-02 Cycle繰越

```gherkin
Given Active CycleにBacklogとUnstartedとStartedとCompletedとCanceledのIssueがある
And Cycle終了時刻を過ぎている
When 同じCycleの終了Jobが並行して実行される
Then UnstartedとStartedのIssueだけが次Cycleへ移る
And BacklogとCompletedとCanceledのIssueは元Cycleに残る
And 元CycleはCompletedになる
And 次Cycleは既存行を再利用して1件だけ存在する
And 繰越履歴は移動したIssueごとに1件、このシナリオでは2件だけ作成される
And Outbox eventは1件だけ作成される
And Jobを再実行しても結果は変わらない
```

## AC-03 端末横断

```gherkin
Given PCでIssueをHigh priorityへ変更した
When 同じユーザーがスマートフォンで対象Issueを開く
Then High priorityが表示される
And スマートフォンからStatusを変更できる
And タップ対象が重なったり横にはみ出したりしない
```

## AC-04 楽観的更新失敗

```gherkin
Given Issue一覧を表示している
When Status変更の保存がサーバーで失敗する
Then UIは変更前のStatusへ戻る
And Error理由と再試行操作を表示する
And 他Issueの選択やScroll位置は維持される
```

## AC-05 Accessセッション再認証

```gherkin
Given standalone PWAでIssue詳細を開いている
And Cloudflare Accessのセッションが失効している
When Server Functionを呼び出す
Then 401をNetwork障害や5xxと区別して検知する
And 現在URLへのTop-level NavigationでCloudflare Accessの再認証へ移る
And 再認証後に同じIssue詳細へ戻る
And 認証応答や個人データをService WorkerへCacheしない
```

## AC-06 所有者境界

```gherkin
Given JWTを持たないCronまたはQueue consumerが起動する
When `OWNER_USER_ID`が唯一のusers行と一致する
Then そのuser_idに属するデータだけを処理する
But Binding未設定、対応行なし、またはQueue messageのuser_id不一致の場合
Then 業務データを更新せず失敗を記録する
```

## AC-07 Issue更新競合

```gherkin
Given 同じIssue versionを読んだ2つのMutationがある
When 2つを並行実行する
Then 条件付きUPDATEに成功した1件だけが保存される
And もう1件は409 Conflictになる
And Activity、Outbox event、Mutation receiptは勝者の1件だけ作成される
```

## AC-08 Mutation再送

```gherkin
Given Issue更新が成功しMutation receiptが保存されている
When 同じidempotencyKeyと同じRequestを再送する
Then 初回と同じResponseを返す
And Issue version、Activity、Outbox event、Mutation receiptは増えない
But 同じidempotencyKeyで異なるRequestを送る
Then 409 IDEMPOTENCY_KEY_REUSEDを返し業務データを更新しない
```

## AC-09 バックグラウンド処理の手動実行

```gherkin
Given Settingsに保留中のバックグラウンド処理がある
When 「バックグラウンド処理を実行」を押す
Then 202と`run_id`が返り、処理状態が`queued`または`running`になる
And Cycle境界処理、将来Cycle生成、Purge、Outbox再送が決められた順序で実行される
And 同じボタンを連続して押しても実行中Runは1件だけになる
And 異なる`idempotencyKey`の同時起動は1件だけ202になり、他は423になる
And 同じKey・同じRequestの同時2リクエスト、再送、または202応答紛失後の再送は両方とも同じ`run_id`を返す
And 同じKey・異なるRequestは409になり、業務データを変更しない
And lock競合で`rejected`になったRunは同じKeyの再送でも同じ`rejected`を返し、新しいKeyで再起動する
```

## AC-10 実行中の操作ロック

```gherkin
Given バックグラウンド処理が`running`である
When Issue、Cycle、Project、Viewまたは設定を変更する
Then 423 `OPERATION_IN_PROGRESS`になり、業務データは変更されない
And 進捗取得、読み取り、ログアウト、Access再認証は実行できる
And ブラウザを再読み込みしても処理中Overlayが復元される
And 別端末は`GET /api/v1/background-runs/current`で同じRun・Step・進捗を表示し、業務Mutationは423になる
And Runが`failed / expired / succeeded`になると両端末のOverlayが解除される
```

## AC-11 バックグラウンド処理の失敗復旧

```gherkin
Given バックグラウンド処理のHeartbeatが途切れてLeaseが期限切れになった
When ユーザーが処理状態を開く
Then `expired`として表示され、古いWorkerからの書き込みは拒否される
And ロックを解放して新しい`idempotencyKey`で同じ処理を再実行できる
And Lease直前は有効、期限ちょうど以降は業務データ・進捗・Run状態・Heartbeat・Lockを更新できない
And 新RunがLockを再取得した後も、古いWorkerのHeartbeat・解放・失敗更新はすべてNo-opになる
```

## AC-12 バックグラウンド処理の状態遷移と失敗

```gherkin
Given `queued`または`running`のRunでStepが失敗する
When エラー処理が完了する
Then Runは`failed`になり、失敗Step以降は`skipped`になる
And 完了済みStepと業務上の成果物は保持され、ロックは解放される
And `succeeded / failed / expired / rejected`から別状態へ逆戻りしない
And 新しい`idempotencyKey`と`run_id`で再実行できる
```

## AC-13 Queueによる手動RunのStep実行

```gherkin
Given Settingsから起動したRunの`cycle_transition` StepがQueueへ送られている
When side effect後・ack前に同じMessageが再配送され、同時に二重配送される
Then `background_run_steps`と`background_effect_dedupes`を含む業務データへの効果は1回だけになる
And `run_id`、`lock_token`、Lease、`user_id`が不正または期限切れのMessageは効果なしで再試行またはackされる
And 別RunのMessageは延期され、前Stepが`succeeded`になるまで後続Stepは実行されない
And 失敗Runからの再実行は同じ業務対象の安定した`dedupe_key`を引き継ぐ
And Schema不正・未知のuser・不正Tokenは効果なしでackまたはDead Letterへ送り、Lease期限切れ・旧Runはackする
And 別Run実行中・前Step未完了はdefer/retryし、一時的なD1・Queue障害はretryする
And 通常ログ・監査ログ・Dead Letterへ`lock_token`を出力しない
```

## AC-14 Cron起動アダプタ（Phase 6）

```gherkin
Given Cron自動起動が有効化されている
When 同じ論理Cycle境界のCronが再実行され、手動Runとも同時に起動する
Then 手動Runと同じStep結果・冪等性になる
And `trigger = 'cron'`と`actor = 'system:cron'`を監査へ記録する
And ロック競合時は業務更新せず次回起動へ延期し、重複Runを作らない
```

# 14. テスト戦略

- Unit: Cycle境界・Cooldown、繰越対象、Estimate ON/OFF、権限、Workflow / Project status遷移、Filter変換、Position計算、Tiptap JSONから検索Textへの射影
- Repository / Service Integration: 実D1 Migration、`user_id`所有境界、Issue作成・採番、Issue / CycleのCASと同時実行、Batch rollback、一意制約、検索Index、recent、30日Purge、Outbox再投入、Background runのlock CAS・Lease・423拒否
- UI Integration: Issue CRUD、Bulk edit、Cycle繰越、Project進捗、Saved View、楽観的Rollback・Error・再試行・選択・Scroll保持、Access 401分類とTop-level Navigation、UI言語・Estimate表示切替、手動RunのOverlay・進捗・再読み込み復元
- Browser E2E: Access実環境の認証・拒否・Logout・Deep link復帰、Keyboard / Touch統合、Mobile / standalone PWA、Service Worker Cache境界に絞った少数のSmoke test
- Accessibility: axeによる自動検査 + Keyboardのみの主要Journey
- Performance: 1万IssueのSeedで一覧、Filter、英日混在のtitle / description検索、Cycle集計を計測する。AC-01はEnter確定からServer採番済みIssueが描画されるまでをPreview環境で測り、p95を1秒以内とする
- Resilience: Queue再試行・保持期限超過後のOutbox再投入、Cron / CYC-08同時実行、Background runのクラッシュ・Lease期限切れ・二重起動、Batch途中失敗、誤った`OWNER_USER_ID`、API timeout、Mutation conflictをFault injectionする

正常系Journeyの一次担保はRepository / Service / UIの各レイヤー内Integration testとし、Browser E2EはAccess・PWA・実Browser固有の境界に限定して同じ正常系を重複させない。

## 14.1 必須テストケース

| 対象 | 技法 | 必須ケース |
| --- | --- | --- |
| 基本入力制約 | 境界値 | Issue title `0 / 1 / 255 / 256`文字、Cycle期間`0 / 1 / 8 / 9`週、Cooldown`0 / 4 / 5`週、将来Cycle`0 / 1 / 15 / 16`件 |
| Cycle状態 | 状態遷移 | Upcoming→Active、Active→Completed（cron / manual）、期限前cron拒否、Upcoming終了拒否、Completed再実行No-op、Cron / CYC-08競合、Cooldown中のActiveなし表示 |
| Cycle繰越 | デシジョンテーブル | Backlog / Completed / Canceledは残留、Unstarted / Startedは移動、次Cycle既存行再利用、Issueごとの履歴、Outbox 1件、Batch失敗時Rollback |
| Owner解決 | デシジョンテーブル | HTTP本人一致 / 不一致、Cron正常、Binding未設定、UUID不正、`users`行なし、Queue `user_id`一致 / 不一致。拒否は業務更新0件と構造化Security log、Background失敗は加えてMetricで観測する |
| Issue Mutation | デシジョンテーブル | Version一致、Version競合、同じKey・同じRequestの再送、同じKey・異なるRequestの拒否、並行更新で勝者1件、Activity / Outbox / Receipt重複なし |
| Estimate | デシジョンテーブル | 無効、有効かつ全件未設定、有効かつ一部未設定、許可値`1 / 2 / 3 / 5 / 8`、不許可値`0 / 4 / 13`、無効化後の値保持と再有効化、ProjectのCanceled除外 |
| Access失効 | デシジョンテーブル | 401、Offline、Timeout、5xxを区別し、401だけがTop-level再認証、元Deep link復帰、認証応答・個人データCacheなし |
| 楽観的更新失敗 | 状態遷移 | Optimistic表示→成功確定、Optimistic表示→失敗Rollback→Error / 再試行、選択・Scroll位置維持 |
| Search射影 | 状態遷移・障害注入 | Create / Edit / Delete時のJSON・`description_text`・FTS整合、途中失敗Rollback、短い検索語、MATCH特殊文字、英日混在、Fallback |
| Recent | 境界値 | 19 / 20 / 21件、重複Upsert、Canonical JSON、最終利用順、削除済み除外、端末同期 |
| 論理削除Purge | 境界値・状態遷移 | 30日ちょうどは復元可能、30日+1msはPurge、依存データ、Owner分離、再実行No-op、監査記録 |
| Mutation receipt期限 | 境界値 | `expires_at`直前、期限到達後かつPurge実行前の同じKeyの再送応答・異なるRequest拒否、Purge後の新規Mutation扱い、再実行No-op |
| Background run lock | 状態遷移・同時実行 | Fake clock + 実D1で、異なるKeyの同時起動（202は1件・もう1件423）、同じKey・同じRequestの同時再送（同じ`run_id`）、同じKey・異なるRequestの409、202応答紛失後の再送、pending作成後・Lock Claim前クラッシュ、dispatch intent作成後・Queue送信前クラッシュ、running中の全Mutation423と副作用0、読み取り・ログアウト許可、別端末の現在Run発見、別RunのQueue Message延期、Heartbeat更新、Lease直前・期限ちょうど・期限直後、古いTokenの書き込み・解放拒否、成功済みStepの再実行No-op、失敗/期限切れStepの再実行とattempt_countを検証する |
| Background run API | Repository / Service / UI integration | `/current`の本人Run取得、`:id`の本人所有・404境界、別端末ポーリング、terminal状態のOverlay解除、Overlay中の401再認証・Logout例外、Pointer / Keyboard / Route遮断、失敗・再実行表示、`lock_token`非露出、`progress_json` / `error_json`のSchema検証 |
| Background run steps | 状態遷移・障害注入 | 固定3Stepの順序、Stepごとの`pending / running / succeeded / failed / skipped`、成果物・processed/total、Step失敗時の後続停止、同一Stepのside effect後再配送・同時二重配送、Schema不正/未知user/不正Token/旧Run/別Run/前Step未完了/一時障害ごとのack・Dead Letter・defer・retry、次Stepの前Step成功待ち |
| Background effect dedupe | Repository / Service Integration | `background_effect_dedupes`のClaim・業務効果・succeededを同一D1 batchで確定、旧成功StepのNo-op、旧失敗/期限切れStepのattempt_count増加と再実行、side effect後・台帳更新前クラッシュ、retry Runとのuser/step/dedupe境界 |
| Cron adapter | 契約・同時実行 | 手動Runとの同一Step結果、論理境界由来のidempotency key、`trigger` / actor監査、手動実行中の延期、重複Runなし（Phase 6） |

# 15. 開発フェーズ案

| Phase | 成果物 | 完了条件 |
| --- | --- | --- |
| 0. Technical spike | TanStack Start + Workers + D1 + Authの縦切りPoC | Access認証・拒否・失効復帰、Issue 1件CRUD、Preview deployが動く |
| 1. Foundation | 本人限定認証、Owner bootstrap、個人設定、Workflow、共通UI、Background runのlock・状態表示 | 未認証・未許可ユーザー・Owner誤設定・実行中Mutationの拒否テストが通る |
| 2. Issue core | Issue CRUD、List、Detail、属性、Bulk、Search、Command menu、Shortcut | PC主要Journeyが通る |
| 3. Cycle | 設定、手動Runによる生成・繰越、Current/Past、Graph | AC-02、AC-09〜13、状態遷移、CYC-08の日付再計算・重複拒否のテストが通る |
| 4. Project / View | Project、Board、Filter、Saved View | 横断利用が可能になる |
| 5. Mobile / PWA | 下部Navigation、Touch最適化、PWA | 主要Mobile E2EとAA検査が通る |
| 6. Release hardening | Inbox、監査、性能、Backup、Cron自動起動、Queue常時自動投入、運用手順 | AC-14、SLO、Security、Restore drillを満たす |

# 16. リスクと判断事項

| リスク | 影響 | 対応 |
| --- | --- | --- |
| TanStack StartがRC | API変更・Upgrade工数 | Version固定、薄いFramework境界、Phase 0でDeploy検証 |
| D1はSQLite制約を持つ | 高度な全文検索・複雑な分析 | Index設計、集計テーブル、必要時Postgres + Hyperdrive移行 |
| 高機能DnDは端末差が大きい | Mobile操作不良、Accessibility低下 | Keyboard代替、Touch sensor、実機E2E、Menu操作も提供 |
| 楽観的更新の競合 | 表示巻き戻り・上書き | version、Idempotency key、Conflict UI |
| Cycle自動処理 | 二重繰越・時刻ずれ | UTC保存、個人timezone変換、Token付きCAS、一意制約、冪等Job、境界Unit test |
| Background runの実行ロック | UIだけの停止では別Tab・再送・Queueから書き込める | D1のlock CAS、全Mutationの423 Guard、run_id / lock_token、Heartbeat・Lease、期限切れWorker拒否、再実行テスト |
| Linear全機能を追う | MVP肥大化 | Mustの完了までPhase 2機能を着手しない |
| Rich text | XSS・データ互換性 | JSON schema、sanitize、Markdown export、editor version保持 |

## Phase 0で実装可能性・品質を確定する項目

1. 承認済みのD1 Token付きCAS方式について、Drizzleでの`meta.changes`取得、同時実行、Batch rollback、Background run lockの取得・423拒否・Lease期限切れ、CYC-08競合・日付再計算・個別調整済みCycleとの重複拒否、履歴・Outbox・次Cycleの重複防止
2. Cloudflare Access JWT検証、非同期リクエストへの401契約、Top-level再認証、元URL復帰、Logout、standalone PWAでのTanStack Start SSR / Server Functions保護
3. D1 FTS5のTokenizer、短い検索語、英日混在の検索品質、射影・Index整合性、1万Issue時のLatency、およびExport / Restore時の再Index手順
4. 採用するDnDライブラリのReact現行版対応とTouch / Keyboard品質
5. Tiptap JSONからMarkdownへの可逆性とsanitize方針
6. 手動Runを直接D1実行とQueue実行へ切り替える境界、Queue再配送時のStep冪等性、Cronから同じ起動Serviceを呼ぶ構成

# 17. MVP完成の定義

以下をすべて満たしたとき、MVP完成とする。

- 本人一人でIssue、Cycle、Project、Viewの日常運用ができる
- MVPでは手動Runにより、Cycleが設定に従って生成・開始・終了・繰越される。Cron自動起動はRelease hardening後に有効化する
- MVPでは手動RunでPurgeとOutbox再送も完了でき、Background QueueのStep再配送に耐える
- PC、スマートフォン、タブレットで主要Journeyが完了する
- PCではIssue作成、選択、属性変更、検索をKeyboardだけで実行できる
- Mobileでは主要操作が2〜3タップで到達でき、横方向の表示崩れがない
- 本人限定アクセス、Cycle冪等性、Conflictの自動テストが通る
- Background runの二重起動防止、実行中Mutationロック、Lease復旧の自動テストが通る
- AC-09〜AC-13（手動Run、全Mutationロック、失敗復旧、Background Queue Step冪等性）が通る
- Production deploy、Migration、Rollback、D1 restore、障害確認の手順が文書化される
- Core Web VitalsとAPI latencyの目標を検証環境で満たす
