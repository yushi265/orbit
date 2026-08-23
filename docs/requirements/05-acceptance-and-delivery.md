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
| Settings | Profile、Workflow、Cycle、Estimate、Label、Project status、通知、言語、Theme | 項目ごとに下層Route |

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

# 14. テスト戦略

- Unit: Cycle境界・Cooldown、繰越対象、Estimate ON/OFF、権限、Workflow / Project status遷移、Filter変換、Position計算、Tiptap JSONから検索Textへの射影
- Repository / Service Integration: 実D1 Migration、`user_id`所有境界、Issue作成・採番、Issue / CycleのCASと同時実行、Batch rollback、一意制約、検索Index、recent、30日Purge、Outbox再投入
- UI Integration: Issue CRUD、Bulk edit、Cycle繰越、Project進捗、Saved View、楽観的Rollback・Error・再試行・選択・Scroll保持、Access 401分類とTop-level Navigation、UI言語・Estimate表示切替
- Browser E2E: Access実環境の認証・拒否・Logout・Deep link復帰、Keyboard / Touch統合、Mobile / standalone PWA、Service Worker Cache境界に絞った少数のSmoke test
- Accessibility: axeによる自動検査 + Keyboardのみの主要Journey
- Performance: 1万IssueのSeedで一覧、Filter、英日混在のtitle / description検索、Cycle集計を計測する。AC-01はEnter確定からServer採番済みIssueが描画されるまでをPreview環境で測り、p95を1秒以内とする
- Resilience: Queue再試行・保持期限超過後のOutbox再投入、Cron / CYC-08同時実行、Batch途中失敗、誤った`OWNER_USER_ID`、API timeout、Mutation conflictをFault injectionする

正常系Journeyの一次担保はRepository / Service / UIの各レイヤー内Integration testとし、Browser E2EはAccess・PWA・実Browser固有の境界に限定して同じ正常系を重複させない。

## 14.1 必須テストケース

| 対象 | 技法 | 必須ケース |
| --- | --- | --- |
| 基本入力制約 | 境界値 | Issue title `0 / 1 / 255 / 256`文字、Cycle期間`0 / 1 / 8 / 9`週、Cooldown`0 / 4 / 5`週、将来Cycle`0 / 1 / 15 / 16`件 |
| Cycle状態 | 状態遷移 | Upcoming→Active、Active→Completed（scheduled / manual）、期限前scheduled拒否、Upcoming終了拒否、Completed再実行No-op、Cron / CYC-08競合、Cooldown中のActiveなし表示 |
| Cycle繰越 | デシジョンテーブル | Backlog / Completed / Canceledは残留、Unstarted / Startedは移動、次Cycle既存行再利用、Issueごとの履歴、Outbox 1件、Batch失敗時Rollback |
| Owner解決 | デシジョンテーブル | HTTP本人一致 / 不一致、Cron正常、Binding未設定、UUID不正、`users`行なし、Queue `user_id`一致 / 不一致。拒否は業務更新0件と構造化Security log、Background失敗は加えてMetricで観測する |
| Issue Mutation | デシジョンテーブル | Version一致、Version競合、同じKey・同じRequestの再送、同じKey・異なるRequestの拒否、並行更新で勝者1件、Activity / Outbox / Receipt重複なし |
| Estimate | デシジョンテーブル | 無効、有効かつ全件未設定、有効かつ一部未設定、許可値`1 / 2 / 3 / 5 / 8`、不許可値`0 / 4 / 13`、無効化後の値保持と再有効化、ProjectのCanceled除外 |
| Access失効 | デシジョンテーブル | 401、Offline、Timeout、5xxを区別し、401だけがTop-level再認証、元Deep link復帰、認証応答・個人データCacheなし |
| 楽観的更新失敗 | 状態遷移 | Optimistic表示→成功確定、Optimistic表示→失敗Rollback→Error / 再試行、選択・Scroll位置維持 |
| Search射影 | 状態遷移・障害注入 | Create / Edit / Delete時のJSON・`description_text`・FTS整合、途中失敗Rollback、短い検索語、MATCH特殊文字、英日混在、Fallback |
| Recent | 境界値 | 19 / 20 / 21件、重複Upsert、Canonical JSON、最終利用順、削除済み除外、端末同期 |
| 論理削除Purge | 境界値・状態遷移 | 30日ちょうどは復元可能、30日+1msはPurge、依存データ、Owner分離、再実行No-op、監査記録 |
| Mutation receipt期限 | 境界値 | `expires_at`直前、期限到達後かつCron削除前の同じKeyの再送応答・異なるRequest拒否、Cron削除後の新規Mutation扱い、Purge再実行No-op |

# 15. 開発フェーズ案

| Phase | 成果物 | 完了条件 |
| --- | --- | --- |
| 0. Technical spike | TanStack Start + Workers + D1 + Authの縦切りPoC | Access認証・拒否・失効復帰、Issue 1件CRUD、Preview deployが動く |
| 1. Foundation | 本人限定認証、Owner bootstrap、個人設定、Workflow、共通UI | 未認証・未許可ユーザー・Owner誤設定の拒否テストが通る |
| 2. Issue core | Issue CRUD、List、Detail、属性、Bulk、Search、Command menu、Shortcut | PC主要Journeyが通る |
| 3. Cycle | 設定、自動生成、繰越、Current/Past、Graph | AC-02、状態遷移、CYC-08の日付再計算・重複拒否のテストが通る |
| 4. Project / View | Project、Board、Filter、Saved View | 横断利用が可能になる |
| 5. Mobile / PWA | 下部Navigation、Touch最適化、PWA | 主要Mobile E2EとAA検査が通る |
| 6. Release hardening | Inbox、監査、性能、Backup、Purge、Outbox再送、運用手順 | SLO、Security、Restore drillを満たす |

# 16. リスクと判断事項

| リスク | 影響 | 対応 |
| --- | --- | --- |
| TanStack StartがRC | API変更・Upgrade工数 | Version固定、薄いFramework境界、Phase 0でDeploy検証 |
| D1はSQLite制約を持つ | 高度な全文検索・複雑な分析 | Index設計、集計テーブル、必要時Postgres + Hyperdrive移行 |
| 高機能DnDは端末差が大きい | Mobile操作不良、Accessibility低下 | Keyboard代替、Touch sensor、実機E2E、Menu操作も提供 |
| 楽観的更新の競合 | 表示巻き戻り・上書き | version、Idempotency key、Conflict UI |
| Cycle自動処理 | 二重繰越・時刻ずれ | UTC保存、個人timezone変換、Token付きCAS、一意制約、冪等Job、境界Unit test |
| Linear全機能を追う | MVP肥大化 | Mustの完了までPhase 2機能を着手しない |
| Rich text | XSS・データ互換性 | JSON schema、sanitize、Markdown export、editor version保持 |

## Phase 0で実装可能性・品質を確定する項目

1. 承認済みのD1 Token付きCAS方式について、Drizzleでの`meta.changes`取得、同時実行、Batch rollback、CYC-08競合・日付再計算・個別調整済みCycleとの重複拒否、履歴・Outbox・次Cycleの重複防止
2. Cloudflare Access JWT検証、非同期リクエストへの401契約、Top-level再認証、元URL復帰、Logout、standalone PWAでのTanStack Start SSR / Server Functions保護
3. D1 FTS5のTokenizer、短い検索語、英日混在の検索品質、射影・Index整合性、1万Issue時のLatency、およびExport / Restore時の再Index手順
4. 採用するDnDライブラリのReact現行版対応とTouch / Keyboard品質
5. Tiptap JSONからMarkdownへの可逆性とsanitize方針

# 17. MVP完成の定義

以下をすべて満たしたとき、MVP完成とする。

- 本人一人でIssue、Cycle、Project、Viewの日常運用ができる
- Cycleが設定に従って自動生成・開始・終了・繰越される
- PC、スマートフォン、タブレットで主要Journeyが完了する
- PCではIssue作成、選択、属性変更、検索をKeyboardだけで実行できる
- Mobileでは主要操作が2〜3タップで到達でき、横方向の表示崩れがない
- 本人限定アクセス、Cycle冪等性、Conflictの自動テストが通る
- Production deploy、Migration、Rollback、D1 restore、障害確認の手順が文書化される
- Core Web VitalsとAPI latencyの目標を検証環境で満たす
