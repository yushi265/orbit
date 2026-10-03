# MVP: データ層 詳細設計

> D1 / Drizzle の所有者境界、業務データ、CAS・一意制約・Background Run 台帳の正本。Service は本書の Repository 契約だけを利用し、D1 へ直接 SQL を発行しない。

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人が Issues で `C` → タイトル → Enter を行うと、Preview 環境で Enter 確定から Server 採番済み Issue が一覧へ描画されるまでの p95 が 1 秒以内であり、`TASK-123` 形式の Issue 番号が採番され、専用 URL で同じ Issue 詳細を開ける。
- **AC-2**: 期限を過ぎた Active Cycle を並行して終了しても、Unstarted と Started だけが次 Cycle へ移り、Backlog / Completed / Canceled は元 Cycle に残り、元 Cycle は Completed、次 Cycle は既存行を再利用して 1 件だけ存在し、移動履歴と Outbox event は対象ごとに 1 件だけ冪等に確定する。
- **AC-3**: PC で変更した Issue の High priority がスマートフォンにも表示され、スマートフォンから Status を変更でき、タップ対象が重ならず横にはみ出さない。
- **AC-6**: Access JWT で認証した本人が手動 Run を開始したとき、Run の `user_id` と本人の所有者が一致する場合だけその `user_id` のデータを Chunk 処理し、未認証・対応する users 行なし・Run の `user_id` 不一致では業務データを更新せず失敗を記録する。
- **AC-7**: 同じ Issue version を読んだ 2 つの Mutation を並行実行したとき、条件付き UPDATE に成功した 1 件だけが保存され、もう 1 件は 409 Conflict になり、Activity・Outbox event・Mutation receipt は勝者の 1 件だけ作成される。
- **AC-8**: 成功済み Issue Mutation を同じ `idempotencyKey` と同じ Request で再送すると初回と同じ Response を返し、Issue version・Activity・Outbox event・Mutation receipt は増えず、同じ Key で異なる Request を送ると 409 `IDEMPOTENCY_KEY_REUSED` になり業務データを更新しない。
- **AC-9**: Settings から Maintenance Run を起動すると 202 と `run_id` が返り、固定 schema 以外は 400、固定 3 Step は `cycle_transition` → `purge` → `outbox_retry` の順で処理され、異なる Key の同時起動は 1 件だけが受理されて他は 423、同じ Key・同じ Request の同時再送・応答紛失後の再送は同じ `run_id` に収束し、`rejected` Run は同じ Key で再起動しない。
- **AC-10**: Background Run が `running` の間、Issue・Cycle・Project・View・Settings 等の業務 Mutation は 423 `OPERATION_IN_PROGRESS` で拒否され、version・Activity・Outbox・Mutation receipt は増えず、読み取り・進捗取得・Run 継続 / 復旧・ログアウト・Access 再認証は許可され、再読み込み後も Overlay と別端末の同一 Run 状態が復元される。
- **AC-11**: Background Run の Heartbeat が途切れて Lease が期限切れになると Run は `paused` になり Lock が解放され、古い HTTP 処理の業務データ・進捗・Run 状態・Heartbeat・Lock 更新は拒否され、同じ Run を cursor 位置から再開でき、Lease 直前は有効・期限ちょうど以降は無効である。
- **AC-12**: `pending` または `running` の Run で Step が失敗すると Run は `failed`、失敗 Step 以降は `skipped` になり、完了済み Step と業務成果物を保持して Lock を解放し、`succeeded` / `rejected` から逆戻りせず、`failed` は同じ Run の resume で失敗箇所から再開できる。
- **AC-13**: 同じ Run・Step・cursor の HTTP Chunk が再送・同時実行されても業務効果は 1 回だけで、前 Step 未完了なら効果を発生させず、resume は同じ Run の Lease を更新し、成功済み Chunk を No-op とし、返却 cursor は同値または前進のみ、`user_id` 不一致・Run 不存在は 404、paused / failed の continue は 409 `RUN_REQUIRES_RESUME`、Lease 競合は 423 になる。

## このレイヤーが公開する契約（外部インターフェース）

### 共通型と所有者境界

| 項目 | 確定値 |
|---|---|
| 主キー | `TEXT` の UUID v7 または同等の時系列ソート可能 ID。Service が生成し、DB の一意制約で重複を拒否する。 |
| 所有者 | `users.id`。主な業務テーブルは `user_id TEXT NOT NULL` を持ち、Repository の全メソッドが `ownerUserId` を受け取る。 |
| 日時 | UTC Unix milliseconds の `INTEGER`。Cycle境界は個人設定のIANA timezoneで計算する。Issue期限はUTC年月日の暦日carrierとして保存し、Timezone変換しない。今日との比較には本人Timezoneの現在暦日を使う。 |
| JSON | `TEXT` として保存し、保存前に対象ドメインの構造を検証する。Token・Cookie・秘密値は保存しない。 |
| 論理削除 | Issue、Project、Notification、Note、Saved View 等は `deleted_at` または対象固有の `archived_at` を持つ。通常 Query は未削除・未アーカイブを既定とする。 |
| 物理削除 | `purge` Step が `deleted_at` から 30 日を超えた対象を依存順に Chunk 処理する。対象行単位の dedupe key を使い、再実行は No-op にする。 |

### MVP Schema

| Table | 主な列・型 | 制約 / Index / 境界 |
|---|---|---|
| `users` | `id`, `name`, `email`, `avatar_url`, `created_at` | `id` PK、`email` は Owner 解決用に一意。MVP は唯一 Owner の 1 行を Bootstrap する。 |
| `user_preferences` | `user_id`, `timezone`, `locale`, `theme`, `color_theme`, `issue_counter`, `estimate_enabled`, `default_issue_display_json` | `user_id` PK / FK。`locale` は `ja / en`、`theme` は `light / dark / system`、`color_theme` は `coral / ocean / violet / forest / amber`。Issue 採番カウンタは同一 Owner 行で更新する。 |
| `workflow_states` | `id`, `user_id`, `name`, `category`, `color`, `position`, `is_default` | `category` は `Backlog / Unstarted / Started / Completed / Canceled`。Owner ごとに `is_default = true` を部分 Unique。 |
| `cycle_settings` | `user_id`, `enabled`, `duration_weeks`, `cooldown_weeks`, `start_weekday`, `future_count`, `auto_add_to_current_cycle` | `user_id` PK / FK。期間 `1..8`、Cooldown `0..4`、将来数 `1..15`、曜日 `0..6`。 |
| `cycles` | `id`, `user_id`, `number`, `name_override`, `description_json`, `starts_at`, `ends_at`, `schedule_overridden`, `status`, `completed_at`, `completion_token` | `(user_id, number)` Unique。`status` は `upcoming / active / completed`。過去 Cycle の日付変更を Repository で拒否する。 |
| `project_statuses` | `id`, `user_id`, `name`, `category`, `color`, `position`, `is_default` | `category` は `Backlog / Planned / In Progress / Completed / Canceled`。Owner ごとに既定値を 1 件。 |
| `projects` | `id`, `user_id`, `name`, `status_id`, `priority`, `color`, `icon`, `description_json`, `start_at`, `start_precision`, `target_at`, `target_precision`, `archived_at`, `deleted_at` | `status_id` は同一 Owner のみ。日付の精度 `day / month / quarter` を日付と別に保存する。 |
| `issues` | `id`, `user_id`, `number`, `title`, `description_json`, `description_text`, `status_id`, `priority`, `estimate`, `due_at`, `project_id`, `cycle_id`, `parent_id`, `position`, `version`, `last_mutation_key`, `archived_at`, `deleted_at`, `created_at`, `updated_at` | `(user_id, number)` Unique。`title` は 1..255 文字、`priority` は `no_priority / low / medium / high / urgent`、`estimate` は `NULL / 1 / 2 / 3 / 5 / 8`。Project / Cycle / Parent / Status は同一 Owner。 |
| `labels` | `id`, `user_id`, `name`, `color` | `(user_id, name)` を一意にする。 |
| `issue_labels` | `issue_id`, `label_id` | `(issue_id, label_id)` PK。両参照先の Owner が一致することを Repository で検証する。 |
| `issue_relations` | `source_issue_id`, `target_issue_id`, `type` | `type` は `blocking / blocked_by / related / duplicate`。正規化した組合せを Unique にし、自己参照を拒否する。 |
| `issue_notes` | `id`, `issue_id`, `user_id`, `body_json`, `created_at`, `edited_at`, `deleted_at` | Issue と Owner の一致を必須にする。論理削除を既定とする。 |
| `cycle_issue_history` | `id`, `user_id`, `issue_id`, `from_cycle_id`, `to_cycle_id`, `reason`, `moved_at` | `(user_id, issue_id, from_cycle_id, to_cycle_id, reason)` Unique。繰越の重複を吸収する。 |
| `saved_views` | `id`, `user_id`, `name`, `entity_type`, `query_json`, `layout_json`, `deleted_at` | `query_json` は Filter / Group / Order、`layout_json` は表示プロパティ。URL state と別に保存する。 |
| `recent_issue_views` | `user_id`, `issue_id`, `viewed_at` | `(user_id, issue_id)` Unique。種別ごとに新しい 20 件を保持し、削除済みを返さない。 |
| `recent_searches` | `id`, `user_id`, `normalized_query_json`, `searched_at` | `(user_id, normalized_query_json)` Unique。Canonical JSON（Key 順、既定値、空条件を正規化）を保存し、新しい 20 件を保持する。 |
| `notifications` | `id`, `user_id`, `type`, `entity_type`, `entity_id`, `read_at`, `deleted_at`, `created_at` | 通知種別・対象・既読・論理削除を保持し、Owner で分離する。 |
| `notification_preferences` | `user_id`, `notification_type`, `enabled` | `(user_id, notification_type)` Unique。 |
| `activity_events` | `id`, `user_id`, `actor_type`, `actor_id`, `entity_type`, `entity_id`, `action`, `request_id`, `mutation_key`, `before_json`, `after_json`, `created_at` | `(user_id, mutation_key)` Unique。本文・Token・Cookie を保存しない。actor は `user` または `system:manual-run`。 |
| `outbox_events` | `id`, `user_id`, `event_id`, `type`, `payload_json`, `dedupe_key`, `status`, `attempt_count`, `available_at`, `created_at` | `(user_id, dedupe_key)` Unique。MVP は同じ Worker の `outbox_retry` Step が再処理する。 |
| `mutation_receipts` | `id`, `user_id`, `idempotency_key`, `operation`, `request_hash`, `response_json`, `created_at`, `expires_at` | `(user_id, idempotency_key)` Unique。`expires_at` 到達後も物理削除までは同じ Key を予約し、物理削除後だけ新規 Mutation として扱う（保持は作成から24時間・Snapshot保存時に自動削除。[FIX-snapshot-growth](../FIX-snapshot-growth/index.md)で変更）。 |
| `background_runs` | `id`, `user_id`, `kind`, `status`, `plan_json`, `progress_json`, `error_json`, `idempotency_key`, `request_hash`, `admission_token`, `requested_at`, `started_at`, `heartbeat_at`, `finished_at`, `lease_expires_at`, `resume_count` | `(user_id, idempotency_key)` Unique。`kind = maintenance` のみ。`status` は `pending / running / paused / failed / succeeded / rejected`。Token は応答・ログへ出さない。 |
| `background_run_steps` | `id`, `user_id`, `run_id`, `step`, `status`, `cursor`, `processed_count`, `total_count`, `result_json`, `dedupe_key`, `attempt_count`, `error_json`, `started_at`, `finished_at` | `(run_id, step)` Unique。Step は `cycle_transition / purge / outbox_retry`、状態は `pending / running / succeeded / failed / skipped`。Run と Owner の一致を FK / Repository で検証する。 |
| `background_effect_dedupes` | `id`, `user_id`, `step`, `dedupe_key`, `first_run_id`, `status`, `effect_json`, `attempt_count`, `created_at`, `completed_at` | `(user_id, step, dedupe_key)` Unique。Run UUID ではなく業務対象と論理境界から Key を作る。 |
| `user_runtime_locks` | `user_id`, `run_id`, `lock_token`, `status`, `acquired_at`, `heartbeat_at`, `lease_expires_at` | `user_id` PK。Owner Bootstrap 時に `idle` 行を 1 件作る。`status` は `idle / running`。Lock Claim / Heartbeat / Release は Run と Token の条件付き更新。 |

### 必須 Index / Unique 制約

- `issues(user_id, status_id, updated_at)`
- `issues(user_id, cycle_id, position)`
- `issues(user_id, project_id, status_id, position)`
- `notifications(user_id, read_at, created_at)`
- `activity_events(user_id, entity_type, entity_id, created_at)`
- `cycles(user_id, number)` Unique
- `outbox_events(user_id, dedupe_key)` Unique
- `mutation_receipts(user_id, idempotency_key)` Unique
- `background_runs(user_id, idempotency_key)` Unique
- `background_run_steps(run_id, step)` Unique
- `background_effect_dedupes(user_id, step, dedupe_key)` Unique
- `recent_issue_views(user_id, issue_id)` Unique
- `recent_searches(user_id, normalized_query_json)` Unique
- `activity_events(user_id, mutation_key)` Unique
- Owner ごとの `workflow_states(is_default = true)` および `project_statuses(is_default = true)` の部分 Unique

### Repository IF

| Repository | 操作 | 入力 / 成功 | 失敗・No-op |
|---|---|---|---|
| `ownerRepo` | `resolveAllowedOwner(accessIdentity)` | `OWNER_USER_ID` と users 行、検証済み email が一致した `OwnerContext` | 未設定・不正・不一致は `OwnerNotFound`。業務 Query を実行しない。 |
| `issueRepo` | `createWithCounter` | `user_id`、Validation 済み Issue を同一 batch で採番・保存 | Unique 競合は再試行可能な内部エラーへ変換。所有者外参照は Not Found。 |
| `issueRepo` | `updateByVersion` | `id + user_id + version` が一致した 1 行を更新し `version + 1` | `changes = 0` は receipt 再確認後に `ISSUE_VERSION_CONFLICT`。副作用は作らない。 |
| `mutationReceiptRepo` | `find / recordIfAbsent` | Owner + Key + Request hash + Response を保持 | 同じ hash は保存 Response を返し、異なる hash は `IDEMPOTENCY_KEY_REUSED`。 |
| `activityRepo` / `outboxRepo` | `appendUniqueIfMutationMatches` / `enqueueUniqueIfMutationMatches` | 勝者の Mutation と同じ batch で 1 件だけ追加 | Key / dedupe 既存は No-op。Mutation が失敗した batch では追加しない。 |
| `cycleRepo` | `completeIfActive` / `ensureNextIfTokenMatches` | Active + 期限 / manual 条件を CAS で取得し completion token を発行 | 期限前・完了済み・競合は `changes = 0` の No-op。重複生成なし。 |
| `cycleIssueHistoryRepo` / `issueRepo` | `recordCandidatesIfTokenMatches` / `moveCandidatesIfTokenMatches` | 同じ completion token、Workflow category が Unstarted / Started の行だけを移動 | Backlog / Completed / Canceled は残留。既存履歴・既存所属は No-op。 |
| `runtimeLockRepo` | `claim / heartbeat / release / pauseExpired` | `status = idle` または `lease_expires_at <= databaseNow` を条件に Claim | `meta.changes = 0` は 423。古い Run / Token の更新は No-op。 |
| `backgroundRunRepo` | `createPendingIfAbsent / activate / fail / resume` | Owner + Key + Request hash で Run と固定 3 Step を作成・状態遷移 | 異なる hash は 409。同じ Key は既存 Run。同 terminal 状態からの逆戻りなし。 |
| `backgroundStepRepo` | `claimChunk / completeChunk / failStep` | `run_id + user_id + step + expected_cursor + 有効 Lease` の CAS で 1 Chunk を Claim | 競合敗者は現在進捗を返す。古い cursor・前 Step 未完了は効果なし。 |
| `effectDedupeRepo` | `claim / markSucceeded` | `user_id + step + business dedupe_key` を業務効果と同一 batch で確定 | 既存 succeeded は No-op。side effect と台帳更新が分離しない。 |

## このレイヤーが依存する下位の契約

- Cloudflare D1 Binding の `batch()`、トランザクション的な一括実行、`meta.changes` の取得。
- Drizzle ORMのSQLite schema / migrationは `src/db/schema.ts`、`src/db/client.ts`、`src/db/repositories/`、`drizzle/0000_initial.sql` に固定し、現行Storeの全モデルを欠落なく永続化するSnapshot Adapterを `src/db/repositories/store-snapshot.ts` と `drizzle/0001_*.sql` に追加した。ローカル主要JourneyはMemory Store、本番RequestはD1 Snapshotを使い、ドメイン単位の正規化Repository移行は別Release hardeningとする。
- Lease の時刻は Worker の時計ではなく、D1 側で評価した `databaseNow` を正本とする。

## 実装配置

- `src/db/client.ts`: D1 Binding と Drizzle client の生成
- `src/db/schema.ts`: Schema と SQLite 制約
- `src/db/repositories/owner.ts`
- `src/db/repositories/preferences.ts`
- `src/db/repositories/issues.ts`
- `src/db/repositories/store-snapshot.ts`: 現行Storeの本番永続化bridge
- `src/db/repositories/cycles.ts`
- `src/db/repositories/projects.ts`
- `src/db/repositories/views.ts`
- `src/db/repositories/notifications.ts`
- `src/db/repositories/audit.ts`
- `src/db/repositories/background-runs.ts`
- `drizzle/`: 生成 Migration（運用確定後）

Repository は `ownerUserId` がないと呼び出せない API とし、他ドメイン Repository や Browser API を直接 import しない。Purge の依存削除順は、通知・Recent・Activity / Outbox / Receipt・Notes / Relation / Label join・Issue / Project / View のように、実データの FK 方針と Migration 確定後に固定する。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| `user_id` なし / 所有者外 ID | Repository は Not Found 相当を返し、SQL の対象行数は 0。外部へ存在を漏らさず、内部 Security log に requestId と種別だけを記録する。 |
| Issue version 不一致 | 条件付き UPDATE が 0 件。Activity / Outbox / Receipt を作らず、Service が 409 `ISSUE_VERSION_CONFLICT` に変換する。 |
| Idempotency Key 既存・同一 hash | 保存済み Response を返すだけで全ての業務行を変更しない。 |
| Idempotency Key 既存・異なる hash | 409 `IDEMPOTENCY_KEY_REUSED`。Payload や Key 値をログ出力しない。 |
| Runtime lock 中の通常 Mutation | 全書き込み predicate が `NOT EXISTS(active lock)` となり 0 件。version / Activity / Outbox / Receipt は増えない。 |
| Lease 切れ・古い Run / Token | `run_id + lock_token + lease_expires_at > databaseNow` が不成立となり、業務・進捗・Heartbeat・Release を No-op にする。 |
| D1 batch の途中失敗 | 同一 batch の CAS、業務効果、Activity、Outbox、Receipt を全て rollback。Run の `failed` / Lock 解放は別 CAS として行う。 |
| Unique 制約競合 | 作成者を勝者として扱わず、既存行を再読込して同じ効果を返せる場合は No-op、矛盾する場合は構造化内部エラーへ変換する。 |

## テストケース（技法注記付き）

- [同値分割 + 境界値] Issue title `0 / 1 / 255 / 256` 文字、Cycle 期間 `0 / 1 / 8 / 9` 週、Cooldown `0 / 4 / 5` 週、将来 Cycle `0 / 1 / 15 / 16` 件を受け入れ / 拒否する。
- [同値分割 + 境界値] Estimate の `NULL / 1 / 2 / 3 / 5 / 8` を受け入れ、`0 / 4 / 13` を拒否し、無効化後も既存値を保持する。
- [デシジョンテーブル] Owner の HTTP 本人一致 / 不一致、UUID 不正、users 行なし、Run user_id 一致 / 不一致を判定し、拒否時の業務更新件数が 0 になる。
- [状態遷移] Workflow category ごとの Cycle 繰越、Upcoming → Active → Completed、Completed の再実行 No-op、期限前 manual 終了拒否、Cooldown 中の Active Cycle なしを検証する。
- [同時実行] 同じ Issue version の 2 Mutation、同じ Cycle の 2 終了処理、CYC-08 との競合を実 D1 で実行し、勝者 1 件・副作用 1 件を確認する。
- [同値分割 + 境界値] Mutation receipt の `expires_at` 直前・到達後・Purge 後を検証し、Purge 前は同じ Response / Key 再利用エラー、Purge 後は新規 Mutation とする。
- [状態遷移] `pending / running / paused / failed / succeeded / rejected` と Step の `pending / running / succeeded / failed / skipped` の有効遷移・禁止逆戻りを検証する。
- [境界値 + 同時実行] `CHUNK_SIZE` 件、`CHUNK_SIZE + 1` 件、同一 cursor の再送・同時実行を検証し、processed_count は一回分、cursor は同値または前進だけにする。
- [状態遷移 + 障害注入] Lease 直前・期限ちょうど・期限直後、古い Token の Heartbeat / Release / Run 更新、Lock 再取得後の旧処理 No-op を検証する。
- [代表値 + 障害注入] `background_effect_dedupes` Claim → 業務効果 → succeeded を同一 batch で確定し、side effect 後・台帳更新前クラッシュの重複を防ぐ。
- [境界値] Recent を 19 / 20 / 21 件で Upsert し、重複対象、Canonical JSON、削除済み Issue 除外、端末間同期を検証する。
- [障害注入] JSON / `description_text` / FTS 射影の途中失敗で、元データと検索 Index の不整合が残らないことを検証する。
