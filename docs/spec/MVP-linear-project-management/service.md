# MVP: サービス層 詳細設計

> Cloudflare Worker 内の認証・認可、Server Functions、`/api/v1` Background Run、ドメイン処理、Mutation の整合性・監査・Outbox を定義する。表示層や D1 の内部実装へ依存しない。

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人が Issues で `C` → タイトル → Enter を行うと、Preview 環境で Enter 確定から Server 採番済み Issue が一覧へ描画されるまでの p95 が 1 秒以内であり、`TASK-123` 形式の Issue 番号が採番され、専用 URL で同じ Issue 詳細を開ける。
- **AC-2**: 期限を過ぎた Active Cycle を並行して終了しても、Unstarted と Started だけが次 Cycle へ移り、Backlog / Completed / Canceled は元 Cycle に残り、元 Cycle は Completed、次 Cycle は既存行を再利用して 1 件だけ存在し、移動履歴と Outbox event は対象ごとに 1 件だけ冪等に確定する。
- **AC-3**: PC で変更した Issue の High priority がスマートフォンにも表示され、スマートフォンから Status を変更でき、タップ対象が重ならず横にはみ出さない。
- **AC-4**: Issue の Status 保存が失敗した場合、UI は変更前の Status へ戻り、エラー理由と再試行操作を表示し、他 Issue の選択と Scroll 位置を維持する。
- **AC-5**: standalone PWA で Access セッションが失効したとき、401 を Offline / Timeout / 5xx と区別し、現在 URL への Top-level Navigation で Access 再認証へ移り、再認証後に同じ Deep link へ戻り、認証応答と個人データを Service Worker に Cache しない。
- **AC-6**: Access JWT で認証した本人が手動 Run を開始したとき、Run の `user_id` と本人の所有者が一致する場合だけその `user_id` のデータを Chunk 処理し、未認証・対応する users 行なし・Run の `user_id` 不一致では業務データを更新せず失敗を記録する。
- **AC-7**: 同じ Issue version を読んだ 2 つの Mutation を並行実行したとき、条件付き UPDATE に成功した 1 件だけが保存され、もう 1 件は 409 Conflict になり、Activity・Outbox event・Mutation receipt は勝者の 1 件だけ作成される。
- **AC-8**: 成功済み Issue Mutation を同じ `idempotencyKey` と同じ Request で再送すると初回と同じ Response を返し、Issue version・Activity・Outbox event・Mutation receipt は増えず、同じ Key で異なる Request を送ると 409 `IDEMPOTENCY_KEY_REUSED` になり業務データを更新しない。
- **AC-9**: Settings から Maintenance Run を起動すると 202 と `run_id` が返り、固定 schema 以外は 400、固定 3 Step は `cycle_transition` → `purge` → `outbox_retry` の順で処理され、異なる Key の同時起動は 1 件だけが受理されて他は 423、同じ Key・同じ Request の同時再送・応答紛失後の再送は同じ `run_id` に収束し、`rejected` Run は同じ Key で再起動しない。
- **AC-10**: Background Run が `running` の間、Issue・Cycle・Project・View・Settings 等の業務 Mutation は 423 `OPERATION_IN_PROGRESS` で拒否され、version・Activity・Outbox・Mutation receipt は増えず、読み取り・進捗取得・Run 継続 / 復旧・ログアウト・Access 再認証は許可され、再読み込み後も Overlay と別端末の同一 Run 状態が復元される。
- **AC-11**: Background Run の Heartbeat が途切れて Lease が期限切れになると Run は `paused` になり Lock が解放され、古い HTTP 処理の業務データ・進捗・Run 状態・Heartbeat・Lock 更新は拒否され、同じ Run を cursor 位置から再開でき、Lease 直前は有効・期限ちょうど以降は無効である。
- **AC-12**: `pending` または `running` の Run で Step が失敗すると Run は `failed`、失敗 Step 以降は `skipped` になり、完了済み Step と業務成果物を保持して Lock を解放し、`succeeded` / `rejected` から逆戻りせず、`failed` は同じ Run の resume で失敗箇所から再開できる。
- **AC-13**: 同じ Run・Step・cursor の HTTP Chunk が再送・同時実行されても業務効果は 1 回だけで、前 Step 未完了なら効果を発生させず、resume は同じ Run の Lease を更新し、成功済み Chunk を No-op とし、返却 cursor は同値または前進のみ、`user_id` 不一致・Run 不存在は 404、paused / failed の continue は 409 `RUN_REQUIRES_RESUME`、Lease 競合は 423 になる。

## このレイヤーが公開する契約（外部インターフェース）

### Request Context / 認証

```ts
type RequestContext = {
  requestId: string
  ownerUserId: string
  actor: { type: 'user' | 'system:manual-run'; id: string }
  runContext?: { runId: string; lockToken: string; leaseExpiresAt: number }
}

type AccessIdentity = {
  email: string
  subject: string
  issuer: string
  audience: string
}
```

全入口は次の順序で処理する。

1. Worker が `Cf-Access-Jwt-Assertion` を取得し、署名・issuer・audience・期限を検証する。
2. JWT の email と `OWNER_USER_ID` に対応する `users` 行を `ownerRepo` で解決する。未設定・不正・不一致は fail closed。
3. `requestId` を生成し、Service 内部だけの `RequestContext` を作る。メールアドレスは Context から処理後に捨て、ログへ出さない。
4. `/api/v1` の業務 Mutation は Zod Schema を検証し、通常 Mutation なら active Runtime lock の不在、Job Mutation なら自身の Run / Token / Lease の一致を D1 条件で検証する。

通常 Navigation は Cloudflare Access が Worker 到達前に保護する。アプリ内 Logout は `/cdn-cgi/access/logout` への Top-level Navigation とし、アプリ Route では実装しない。

### Server Functions

| Function | 入力 | 成功結果 | Mutation 条件 |
|---|---|---|---|
| `issue.list / issue.get` | `IssueQuery` / `{ id }` | owner-scoped Issue page / detail | 読み取り。Archived / Trash は明示 Filter 時だけ。 |
| `issue.create` | `CreateIssueInput` | 採番済み Issue と URL 用 ID | idempotency、Owner 参照検証、Audit / Outbox / Receipt を同一 batch。 |
| `issue.update` | `UpdateIssueInput` | 更新後 Issue | `id + user_id + version` CAS。409 は勝者以外に副作用なし。 |
| `issue.bulkUpdate` | `{ ids, patch, ...MutationMeta }` | 更新件数と Issue summary | 全 ID を Owner 検証し、active lock 中は 423。個別効果は dedupe。 |
| `issue.archive / restore / trash` | `{ id, ...MutationMeta }` | 更新後状態 | Archive と Trash を区別。Trash は 30 日復元可能。 |
| `issue.notes / relations / labels` | 各ドメイン Schema | 更新後対象 | 同一 Owner の参照だけ許可。全 Mutation に Lock / Audit / Outbox。 |
| `cycle.list / cycle.get` | tab / cursor | Current / Upcoming / Past | `status` は個人 timezone と `databaseNow` から表示時に一貫判定。 |
| `cycle.updateSettings` | Cycle settings Schema | 保存済み設定 | 期間 / Cooldown / future count の境界検証。実生成は手動 Run。 |
| `cycle.plan / cycle.assign` | Issue / Cycle Mutation | 更新後 Issue | Cooldown 中の Current Cycle 割当を拒否。Upcoming 割当は許可。 |
| `cycle.startNext` | `{ cycleId, ...MutationMeta }` | 更新後 Cycle 状態 | CYC-08 の token 付き CAS。個別調整 Cycle との重複なら拒否。 |
| `cycle.editMetadata` | name override / description | Cycle detail | 上書き解除は自動生成名へ戻す。 |
| `project.*` | Project / status Schema | Project detail / list | Owner 参照と Project status 既定値を検証。 |
| `view.query / view.save / view.update / view.delete` | `IssueQuery` / Saved View Schema | List / Board / Saved View | Filter は MVP の AND 条件だけ。active lock 中の保存・変更は 423。 |
| `search.issues / recent.*` | Query / Recent Schema | 検索結果 / 最大 20 件 | FTS5 または Fallback。削除済みを除外し、Recent は Upsert。 |
| `notifications.*` | Notification Mutation Schema | Inbox 状態 | 既読 / 削除 / 設定変更を Owner scoped で処理。 |
| `settings.*` | Profile / Workflow / Theme / Estimate Schema | 保存後設定 | Workflow / Project status の既定値 1 件、参照中削除を拒否。 |

画面内 Server Function は `shared` の Schema を入口・出口で利用する。将来の外部連携用 `/api/v1` 公開 API を MVP の全機能へ拡張しない。

### Background Run HTTP

| Method / Path | 入力 / 結果 | 処理規則 |
|---|---|---|
| `POST /api/v1/background-runs` | `MaintenanceRunCreateInput` → `202` + `RunSummary` | `kind = maintenance` を強制し、固定 3 Step を保存。Owner + Key の既存 Run は同じ Response。Lock 競合は Run を `rejected` に収束し 423。 |
| `GET /api/v1/background-runs/current` | なし → `{ run: RunSummary | null }` | Lease を先に評価し、本人の `pending / running / paused / failed` だけを返す。該当なしは null。 |
| `GET /api/v1/background-runs/:id` | なし → Run / 404 | Owner 不一致・不存在を同じ 404 にする。 |
| `POST /api/v1/background-runs/:id/continue` | `{ expected_cursor, idempotencyKey }` → `ContinueRunResponse` | 同一 Run / Step / cursor の最大 `CHUNK_SIZE` 件を 1 D1 batch。敗者は現在進捗を返す。paused / failed は 409。 |
| `POST /api/v1/background-runs/:id/resume` | `{ idempotencyKey }` → Run | paused / failed の同じ Run を Lease 再取得して再開。成功済み Step は No-op。 |

`lock_token` と `admission_token` は API、通常ログ、`progress_json`、Client state のどこにも含めない。

## ドメイン処理契約

### Issue Mutation

1. Access / Owner 解決と shared Schema 検証を行う。
2. `requestHash = hashCanonicalRequest(operation, payload without idempotencyKey)` を作り、Owner + Key の receipt を読む。
3. 同じ hash の receipt は保存済み Response を返す。異なる hash は 409 `IDEMPOTENCY_KEY_REUSED`。
4. Issue を Owner scoped で読み、`buildUpdatedIssue` で次値を作る。参照先 Project / Cycle / Status / Parent / Label は全て Owner 一致を検証する。
5. D1 batch の全書き込みへ通常 Lock の不在 predicate（Job は自身の Run / Token / Lease predicate）を付け、`UPDATE ... WHERE id = ? AND user_id = ? AND version = ?` を CAS とする。
6. CAS が勝った場合だけ version 更新、Activity、Outbox、Mutation receipt を同じ batch で確定する。
7. `changes = 0` の場合は receipt を再読込し、同じ Request なら Response、既存 receipt が異なれば Key 再利用、その他は `ISSUE_VERSION_CONFLICT` とする。

Client の Optimistic 更新は Service の 409 / 423 semantics と対になる。423 は Mutation を確定せず、409 は最新値を再取得する。

### Cycle / CYC-08 / 繰越

Cycle の状態は、保存された `starts_at` / `ends_at` と個人 timezone を用いて表示時に判定する。Server 自動 Scheduler は存在しないため、境界処理は次のいずれかで実行する。

- Settings からの `maintenance` Run の `cycle_transition` Step が、`ends_at <= databaseNow` の未処理 Cycle を cursor 順に処理する。
- `cycle.startNext` が手動即時開始を token 付き CAS で処理する。

`closeCycle` は 1 つの D1 batch で、次の条件を守る。

1. `status = active` かつ期限到来、または明示 manual 条件で `completion_token` を発行して Completed にする。
2. 同じ token を条件に、既存の次 Cycle を再利用し、不足時だけ 1 件を生成する。
3. CYC-08 の場合は次 Cycle の `starts_at = now`、`ends_at = now + duration` として Active にし、後続自動生成を新しい境界から再計算する。`schedule_overridden = true` の Cycle と重複する場合は先頭 CAS を成立させない。
4. 元 Cycle の Issue のうち Workflow category が `unstarted / started` のみを次 Cycle へ移す。`backlog / completed / canceled` は残す。
5. Issue ごとに `cycle_issue_history` を一件、Cycle 完了 Outbox を一件だけ作る。既存行・Unique 制約・completion token で再実行を No-op にする。

`CYC-08` と Background Run の同時実行では、Cycle CAS の勝者だけが後続処理へ進み、敗者は副作用なしの No-op または重複拒否へ変換する。

### Background Run / Lease / Step

状態は次のグラフに限定する。

```text
pending -> running -> succeeded
                   -> failed -> running (resume)
                   -> paused -> running (resume)
pending -> rejected
running / failed / paused -> rejected にはしない
succeeded / rejected -> terminal（逆戻りなし）
```

1. Start は fixed maintenance schema を検証し、`createPendingIfAbsent` で `background_runs` と 3 Step を作る。
2. `user_runtime_locks` の idle / Lease expired を D1 CAS で Claim し、Run を pending → running にする。Claim 失敗は別 Key なら 423、同一 Key なら既存 Run、Admission 失敗なら rejected とする。
3. Continue は Owner、Run、Step、前 Step の succeeded、expected cursor、Lease を検証し、1 HTTP 呼び出し 1 D1 batch で最大 `CHUNK_SIZE` 件を処理する。
4. `background_effect_dedupes` は業務対象から作った `cycle_transition:<cycle_id>:<completion_boundary>`、`purge:<entity_type>:<entity_id>:<deleted_at>`、`outbox_retry:<event_id>` のような Key を使う。Run UUID や attempt は Key に含めない。
5. 成功 Step は次 Step を pending にし、全 Step 成功で Run succeeded / Lock idle。Chunk エラーは batch rollback 後、Run failed / 後続 Step skipped / Lock idle にする。
6. Heartbeat が止まり Lease が期限切れになった場合、`GET current` / `GET :id` / `continue` / `resume` の入口で D1 `databaseNow` を基準に paused + Lock idle へ遷移する。古い処理は `run_id + lock_token + lease_expires_at > now` に失敗する。
7. Resume は paused / failed の同じ Run、同じ plan / cursor / dedupe 台帳を使い、`resume_count + 1`。failed の失敗 Step を running、後続 skipped を pending に戻す。

`CHUNK_SIZE=25`、`RUN_LEASE_MS=30000`、`HEARTBEAT_INTERVAL_MS=5000`を初期運用値として固定する。HeartbeatはLeaseの3分の1未満とする不変条件を満たし、実Worker負荷に合わせた再計測はPreviewで行う。

### 検索 / Rich Text

- Issue 保存時に Server が Tiptap JSON を検証・sanitize し、`description_text` を生成する。JSON、射影、採用した FTS Index は同一 batch で更新する。
- Phase 0 の品質基準を満たした場合は D1 SQLite FTS5 を採用する。満たさない場合は title Prefix + `description_text` の Fallback を使い、どちらも同じ shared の検索 Response を返す。
- MATCH 特殊文字、3 文字未満の Issue ID / title Prefix、英日混在を Service で安全に扱う。外部検索基盤は MVP に導入しない。

### Cycle / Project 集計

- Estimate が無効、または対象 Issue の全件が未設定なら Issue 数を既定の母数・完了値にする。
- Estimate が有効で一部未設定の Issue は合計で 0 とし、設定済み Estimate の合計で Scope / 完了率を計算する。
- Project 集計では `canceled` Issue を母数から除外する。Cycle 集計では Status / Priority / Project 別の Issue 数または Estimate 合計を同じルールで返す。
- 日別の Completed / Remaining / Scope change は Cycle 開始時点の Snapshot と追加・削除履歴から再現する。通知・Activity 生成は集計結果の読み取りで副作用を起こさない。

## このレイヤーが依存する下位の契約

- [shared.md](./shared.md) の Zod input / output、ErrorEnvelope、Run / Step 型、Canonical JSON。
- [data.md](./data.md) の Owner scoped Repository、D1 `batch()`、CAS、Unique 制約、Runtime lock / Lease。
- Cloudflare Accessの `Cf-Access-Jwt-Assertion` とAccess Policy。JWTは `src/server/auth.ts` の `jose` + JWKSでissuer / audience / emailを検証し、設定不足・不一致はfail-closedにする。

画面内のMVP操作もPWAの同一Origin再検証とCloudflare Workers PreviewのSmokeを単純化するため、TanStack StartのJSON Server Route（`/api/v1/*`）を利用する。RouteはCORSを許可せず、`X-Requested-With`、Access JWT、shared Zod契約を必須にする。Background Runの5パスは将来の外部境界を想定した公開契約として同じRoute方式を使う。

## 実装配置

- `src/server/context.ts`: requestId、Access identity、OwnerContext、RunContext
- `src/server/auth/access-jwt.ts`: JWT 検証と Owner 解決の薄い Adapter
- `src/server/mutation/guard.ts`: Runtime lock / idempotency / version の共通 Guard
- `src/server/domains/issues.ts`
- `src/server/domains/cycles.ts`
- `src/server/domains/projects.ts`
- `src/server/domains/views.ts`
- `src/server/domains/search.ts`
- `src/server/domains/notifications.ts`
- `src/server/domains/preferences.ts`
- `src/server/background/plan.ts`
- `src/server/background/runner.ts`
- `src/server/background/lease.ts`
- `src/api/v1/background-runs.ts`: `/api/v1/background-runs*` Route Adapter
- `src/server/errors.ts`: ErrorEnvelope 変換と構造化ログ

Route Adapter は入力検証・Context 作成・Service 呼び出し・HTTP status 変換だけを行う。ドメイン処理や SQL を Route file に書かない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| JWT 未提示・署名 / issuer / audience / email 不正 | `401 AUTH_REQUIRED`。Access の再認証へ戻すが、JWT の内容をログ出力しない。 |
| Owner / Run 不一致 | Run の不存在と同じ `404 RESOURCE_NOT_FOUND`。業務 Repository を実行せず、内部 Security log と metric へ requestId を記録する。 |
| Validation 不正 | `400 VALIDATION_ERROR` + fieldErrors。D1 を変更しない。 |
| Active Runtime lock 中の通常 Mutation | `423 OPERATION_IN_PROGRESS`。業務 Repository を副作用なしで終了し、Activity / Outbox / Receipt を作らない。 |
| Issue version 競合 | `409 ISSUE_VERSION_CONFLICT`。最新 Issue の再取得を Client に要求する。 |
| 同じ Key の異なる Request | `409 IDEMPOTENCY_KEY_REUSED`。同じ Key の値、hash、本文を外部に返さない。 |
| paused / failed Continue | `409 RUN_REQUIRES_RESUME`。業務効果を発生させず、resume API へ誘導する。 |
| Lease 競合 / 古い HTTP | `423 OPERATION_IN_PROGRESS` または現在進捗の No-op Response。古い処理から Run / Lock / 業務データを変更させない。 |
| D1 / JWT JWKS / 予期せぬ外部障害 | `500 INTERNAL_ERROR` + requestId。Retryable のみ UI へ示し、詳細は構造化ログへ分離する。 |
| Cycle の重複・個別調整 Cycle との衝突 | `409` のドメインエラーにし、最初の CAS を成立させず、Cycle・履歴・Outbox を増やさない。 |

## テストケース（技法注記付き）

- [デシジョンテーブル] Access JWT の未提示 / 署名不正 / issuer 不一致 / audience 不一致 / email 不一致 / Owner 一致を、401・OwnerContext・ログ内容で検証する。
- [デシジョンテーブル] `OWNER_USER_ID` の未設定 / UUID 不正 / users 行なし / JWT email 不一致 / 一致を fail closed で検証する。
- [代表値 + 境界値] Issue Create の title、Status / Project / Cycle / Label の同一 Owner 参照、TASK counter の同時作成と p95 を検証する。
- [同時実行] 同じ Issue version の 2 更新で勝者 1 件、409 1 件、Activity / Outbox / Receipt 各 1 件を実 D1 で検証する。
- [デシジョンテーブル] 同じ idempotencyKey・同じ Request、同じ Key・異なる Request、期限到達前 / Purge 前 / Purge 後を検証する。
- [状態遷移] Upcoming → Active、Active → Completed、Completed 再実行 No-op、期限前終了拒否、Cooldown、CYC-08、Background Run 競合を検証する。
- [デシジョンテーブル] Cycle Issue の category が Backlog / Unstarted / Started / Completed / Canceled の各場合に移動 / 残留、履歴、Outbox 件数を検証する。
- [状態遷移] Run の固定 3 Step 順序、Step 失敗後の skipped、succeeded / rejected の terminal、failed / paused の resume、Lease timeout を検証する。
- [同時実行 + 障害注入] 異なる Key の同時 Start、同じ Key の同時 Start、202 応答紛失、pending 作成後 Lock Claim 前クラッシュを検証する。
- [境界値 + 同時実行] `CHUNK_SIZE` と `CHUNK_SIZE + 1`、同一 cursor の再送、前 Step 未完了、cursor 単調進行、processed_count の一回分だけの増加を検証する。
- [状態遷移 + 障害注入] Lease 直前 / 期限ちょうど / 期限後、古い Token の Heartbeat / Release / fail 更新、Lock 再取得後の No-op を検証する。
- [デシジョンテーブル] 全業務 Mutation（Issue、Notes、Relation、Label、Archive、Trash、Restore、Bulk、Cycle、Project、View、Notification、Preference、Workflow）を lock 中に 423 とし、副作用 0 を検証する。Read、current、continue、resume、Logout、再認証は許可する。
- [障害注入] FTS5 検索の短語・特殊文字・英日混在・Fallback、Tiptap JSON → text 射影失敗、D1 timeout を検証する。
