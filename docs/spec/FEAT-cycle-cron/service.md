# FEAT-cycle-cron: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Activeの`endsAt <= now`のとき、scheduled実行1回でそのCycleが`completed`になり、Workflow categoryが`unstarted` / `started`のIssueだけが次のCycleへ移動する。繰越履歴は移動したIssueごとに1件、Outbox `cycle.completed`は1件作られ、D1 Snapshotへ保存される。
- **AC-2**: Activeが無く、最も番号の小さいUpcomingの`startsAt <= now`のとき、scheduled実行でそのCycleが予定の`startsAt` / `endsAt`を保ったまま`active`になり、Activity（`cycle` / `started`）がactor `system:automation`で1件、Outbox `cycle.started`が1件記録される。
- **AC-3**: 境界に達したCycleが無いとき（Activeの`endsAt > now`、またはActiveが無くUpcomingの`startsAt > now`）、scheduled実行はCycle・Issue・Activity・Outboxを変更せず、D1 Snapshotのversionを進めない。
- **AC-4**: 後続Upcomingが`futureCount`に足りないとき、scheduled実行で不足分が補充されてD1 Snapshotへ保存される。Cycleが0件のOwnerでは初期Active Cycle 1が作られる。
- **AC-5**: 同じ時刻のままscheduled実行を2回続けても、2回目はCycle・繰越履歴・Activity・Outboxを増やさず、D1 Snapshotのversionを進めない。
- **AC-6**: Manual RunがLockを保持している（Leaseが有効）とき、scheduled実行は何も変更・保存せず`{ outcome: "skipped", reason: "run_in_progress" }`を返す。Leaseが切れているときはRunを`paused`にしてLockを解放したうえでCycle処理を行い、保存する。
- **AC-7**: 保存時に`D1_WRITE_CONFLICT`が起きたら最新のSnapshotを読み直してやり直し、合計3回まで試行する。途中で成功すればCycle処理は1回分だけ反映される。3回とも競合したら例外を投げ、D1は競合相手が保存した内容のまま残る。
- **AC-8**: Cycle処理の途中で例外が起きたら、D1へ何も保存せず、`console.error`へ`event` / `outcome` / `message`だけを持つJSONを1行出して例外を再送出する。ログにメールアドレス・Issue本文・Tokenを出さない。
- **AC-9**: Ownerは次のとおり解決する。productionは`OWNER_USER_ID` / `OWNER_EMAIL`を使い、`users`行のemail一致を確認する。未設定・行なし・email不一致・D1 Bindingなしは、保存せず例外を投げる。localは固定の`local-owner`を使う。development（Memory Store）は`{ outcome: "skipped", reason: "memory_storage" }`を返す。Access JWTは使わない。
- **AC-10**: 境界に達した処理が26件以上たまっているとき、1回のscheduled実行は25件まで処理して`hasRemaining: true`を返し、次の実行が残りを処理する。ちょうど25件のときは`hasRemaining: false`を返す。
- **AC-11**: Worker entry `src/server.ts`のdefault exportが`fetch`（TanStack Startのserver entryの`fetch`そのもの）と`scheduled`を持つ。`wrangler.jsonc`と`wrangler.local.jsonc`の`main`は`src/server.ts`、`wrangler.jsonc`のトップレベルに`"triggers": { "crons": ["0 * * * *"] }`がある。`CLOUDFLARE_ENV=production pnpm build`が生成する`dist/server/wrangler.json`に同じ`triggers`と`APP_ENV=production`が出る。
- **AC-12**: Manual Runの挙動、Server Route、共有契約、D1 Schemaは変わらない。Manual Runによる予定開始のActivity actorは`system:manual-run`のまま。既存テストは変更なしで通る。
- **AC-13**: 要件・設計・運用ドキュメントの「手動実行のみ」「自動スケジューラは対象外」の記述が、Cron併用の内容へ更新されている（対象は[service.md](./service.md)の「ドキュメント更新」）。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-----------------|-------------------|------|
| 追加 | `OrbitStore.runScheduledCycleTransitions(userId)` | 下記 | 呼び出し側がOwnerを確定済みであること | Cycle境界処理（Runなし） |
| 追加 | `runScheduledCycles(env)`（`src/server/scheduled-cycles.ts`） | 下記 | envと`users`行でOwnerを確認 | scheduledの本体 |
| 追加 | `src/server.ts` default export `{ fetch, scheduled }` | 下記 | `fetch`は既存どおり。`scheduled`はHTTP外 | Worker entry |
| 変更 | `wrangler.jsonc` / `wrangler.local.jsonc` | `main: "src/server.ts"`。`wrangler.jsonc`のみ`triggers.crons: ["0 * * * *"]` | — | Cron登録 |

HTTPのパス、共有契約（`src/shared/`）、D1 Schemaの増減はない。

### `OrbitStore.runScheduledCycleTransitions`

```ts
runScheduledCycleTransitions(userId: string):
  | { status: "locked" }
  | { status: "done"; processed: number; hasRemaining: boolean }
```

1. `expireRunIfNeeded(userId)`を呼ぶ。
2. Lockが`running`、またはそのOwnerに`pending` / `running`のRunがあれば、何も変更せず`{ status: "locked" }`を返す（例外にしない）。
3. `processed < CHUNK_SIZE`（25）の間、`nextCycleTransition(userId)`を繰り返す。
   - Active（`endsAt <= now`）: `closeCycle(userId, cycle.id, "scheduled-" + cycle.id)`。`runId`は渡さない。
   - Upcoming（`startsAt <= now`、Activeなし）: `activateScheduledCycle`を「Runなし」で呼ぶ。`false`が返ったらループを抜ける。
   - 対象なし: ループを抜ける。
4. `{ status: "done", processed, hasRemaining: nextCycleTransition(userId) !== undefined }`を返す。

`activateScheduledCycle`は第3引数を`runId: string | undefined`に変える。

| 呼び出し元 | `assertUnlocked` | `mutationKey` | actor |
|---|---|---|---|
| Manual Run（`runId`あり・現状維持） | `(userId, runId)` | `run-${runId}-${cycle.id}-start` | `system:manual-run` |
| scheduled（`runId`なし） | `(userId)` | `scheduled-${cycle.id}-start` | `system:automation` |

Outbox（`cycle.started`、dedupe key `cycle.started:${cycle.id}`、payload `{ cycleId, startsAt, endsAt }`）は両方で同じ。

### `runScheduledCycles`

```ts
export type ScheduledCyclesResult =
  | { outcome: "skipped"; reason: "memory_storage" | "run_in_progress" }
  | { outcome: "completed"; processed: number; hasRemaining: boolean; persisted: boolean; attempts: number };

export async function runScheduledCycles(env: RuntimeEnvironment): Promise<ScheduledCyclesResult>
```

`RuntimeEnvironment`は`src/server/auth.ts`の既存型。

1. `resolveRuntimeConfig(env)`。`storage === "memory"`なら`skipped / memory_storage`。
2. Owner解決。
   - `mode === "local"`: `LOCAL_OWNER`。
   - `mode === "production"`: `env.OWNER_USER_ID` / `env.OWNER_EMAIL`。どちらか未設定なら例外。
   - `env.DB`が無ければ例外。
   - `findOwnedUser(createDb({ DB: env.DB }), userId, email)`が`null`なら例外。
3. 次を最大3回（`MAX_ATTEMPTS = 3`）試行する。
   1. `openStoreSession(userId, email, env)`。
   2. `store.runScheduledCycleTransitions(userId)`。`locked`なら保存せず`skipped / run_in_progress`を返す。
   3. `processed > 0`または`session.needsInitialPersist`なら`session.persist()`、それ以外は保存しない（`persisted: false`）。
   4. `persist`が`ServiceError`の`D1_WRITE_CONFLICT`を投げたら、sessionを捨てて次の試行へ。3回目も競合ならその例外を投げる。
4. `completed`を返す。`attempts`は実際の試行回数（1〜3）。

結果は`console.log(JSON.stringify({ event: "scheduled_cycles", ...result }))`で1行出す。例外は`console.error(JSON.stringify({ event: "scheduled_cycles", outcome: "failed", message }))`を出してから再送出する。`message`は`Error.message`（`Error`でなければ`"unknown"`）。ログ出力と再送出は`runScheduledCycles`の中で行う。

Owner解決の例外messageは固定文言にし、値を含めない: `"Owner is not configured"` / `"D1 binding is missing"` / `"Owner was not found"`。

### `src/server.ts`

```ts
import handler from "@tanstack/react-start/server-entry";
import type { RuntimeEnvironment } from "./server/auth";
import { runScheduledCycles } from "./server/scheduled-cycles";

export default {
  fetch: handler.fetch,
  async scheduled(_controller: unknown, env: RuntimeEnvironment): Promise<void> {
    await runScheduledCycles(env);
  },
};
```

- `createServerEntry`で包まない（`fetch`以外を落とす）。
- `_controller`の型は実装時に`@cloudflare/workers-types`の`ScheduledController`を使ってよい。

### 設定

- `wrangler.jsonc`: `"main": "src/server.ts"`、トップレベルに`"triggers": { "crons": ["0 * * * *"] }`（`triggers`は`env.production`へ継承される）。
- `wrangler.local.jsonc`: `"main": "src/server.ts"`。`triggers`は足さない。
- `package.json`: `format` / `format:check`の対象へ`src/server.ts`を追加する。

## このレイヤーが依存する下位の契約（呼び出す相手）

- `openStoreSession` / `session.persist()`（`src/server/store-session.ts`）: Snapshot読込・`ensureUpcomingCycles`・Version CAS。
- `findOwnedUser` / `createDb`（`src/db/`）: Owner行の確認。変更しない。

## 実装配置

- `src/server/store.ts`: `runScheduledCycleTransitions`追加、`activateScheduledCycle`の引数変更。
- `src/server/scheduled-cycles.ts`（新規）: `runScheduledCycles`。
- `src/server.ts`（新規）: Worker entry。
- `wrangler.jsonc`、`wrangler.local.jsonc`、`package.json`。
- テスト: `src/server/store-scheduled-cycles.test.ts`、`src/server/scheduled-cycles.test.ts`、`src/server-entry.test.ts`、`scripts/worker-config.test.mjs`（いずれも新規）。

### ドキュメント更新（AC-13）

「手動実行のみ」「自動スケジューラは対象外」を、「Cycle境界処理はCron Trigger（毎時）とManual Runの両方から起動する。PurgeとOutbox再送はManual Runのみ」へ改める。

- `docs/requirements/01-product.md`: 62、76〜77、89、99行付近
- `docs/requirements/02-functional.md`: AUTH-06、CYC-04、CYC-05、CYC-12、ASYNC-01、ASYNC-04、ASYNC-06
- `docs/requirements/04-architecture.md`: 21〜22、56、58、60、368行付近（Scheduler行、actorに`system:automation`、CronのOwner解決）
- `docs/requirements/05-acceptance-and-delivery.md`: 220、245、252〜253行付近のCycleに関する「手動Run」
- `docs/architecture.md`: Manual Runの段落と依存方向の図
- `docs/deployment.md`: Cron Triggerの登録と確認、5章（本番更新前の確認）、7章（ロールバック）
- `docs/ai-dlc/codekb/shared.md`: 本ボルトで判明した事実と罠

Purge・Outbox・Runのロックに関する「手動Run」の記述は、事実のままなので変えない。過去のspec（`docs/spec/FEAT-*`など）は書き換えない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Manual Run実行中（Lease有効） | 変更・保存なし。`{"event":"scheduled_cycles","outcome":"skipped","reason":"run_in_progress"}`を`console.log` |
| Memory Store（development） | 変更なし。`skipped / memory_storage`を`console.log` |
| `D1_WRITE_CONFLICT` 1〜2回 | 読み直して再試行。成功時の`attempts`は2または3 |
| `D1_WRITE_CONFLICT` 3回 | `console.error`（`outcome: "failed"`）のあと例外を再送出 |
| Owner未設定 / 行なし / email不一致 | Snapshotを読まない。`console.error`のあと例外を再送出 |
| D1 Bindingなし | `console.error`のあと例外を再送出 |
| 実行設定の組合せ不正 | `resolveRuntimeConfig`の例外を`console.error`のあと再送出 |
| Cycle処理中の例外 | `persist`を呼ばない。`console.error`のあと例外を再送出 |
| Snapshotが読めない（互換codecの拒否） | `openStoreSession`の例外を`console.error`のあと再送出。D1は上書きしない |

## テストケース

### `src/server/store-scheduled-cycles.test.ts`（単体・`new OrbitStore(() => now)`）

- `[状態遷移]` Activeが期限切れ → `completed`になり、次Cycleが無ければ作られる（AC-1）
- `[同値分割]` 繰越はcategory別に、backlog / completed / canceledは残り、unstarted / startedは移動してversionが1増える（AC-1）
- `[代表値]` 繰越履歴は移動したIssueごとに1件、Outbox `cycle.completed`は1件でpayloadの`moved`が移動件数（AC-1）
- `[代表値]` 終了処理のReceiptがidempotency key `scheduled-<cycleId>`・operation `cycle.close`で記録される（AC-1）
- `[状態遷移]` Activeなし・Upcomingが開始時刻到達 → `active`、`startsAt` / `endsAt`は不変（AC-2）
- `[代表値]` 自動開始のActivityは`system:automation`・mutationKey `scheduled-<cycleId>-start`、Outbox `cycle.started`は1件（AC-2）
- `[状態遷移]` Activeが期限切れかつ次のUpcomingも開始時刻到達 → 1回で終了と開始の2件を処理（AC-1, AC-2）
- `[境界値]` Active `endsAt`が`now - 1` / `now` / `now + 1` → 処理する / 処理する / 処理しない（AC-3）
- `[境界値]` Upcoming `startsAt`が`now - 1` / `now` / `now + 1` → 開始する / 開始する / 開始しない（AC-3）
- `[デシジョンテーブル]` Activeの有無 × Active期限切れ × Upcoming開始時刻到達の全組合せで、処理対象が期待どおり（Activeが期限内ならUpcomingが到達していても開始しない）（AC-3）
- `[状態遷移]` 禁止遷移: `completed`のCycleは再処理されない、Active存在中にUpcomingは`active`にならない（AC-3, AC-5）
- `[代表値]` 同じ時刻で2回目を呼ぶと`processed: 0`で、Cycle・履歴・Activity・Outboxの件数が変わらない（AC-5）
- `[境界値]` Lockの`leaseExpiresAt`が`now + 1` / `now` → `locked`を返し何も変わらない / Runが`paused`になりCycle処理が進む（AC-6）
- `[代表値]` `locked`のときCycle・Issue・Outboxは不変（AC-6）
- `[境界値]` 処理対象が24 / 25 / 26件 → `processed`が24 / 25 / 25、`hasRemaining`が`false` / `false` / `true`。26件のときは2回目で残り1件を処理（AC-10）
- `[代表値]` Manual Run（`startRun` → `continueRun`）による予定開始のActivityは`system:manual-run`・mutationKey `run-<runId>-<cycleId>-start`のまま（AC-12）

### `src/server/scheduled-cycles.test.ts`（レイヤー内結合・FakeD1 + `vi.useFakeTimers()`）

- `[代表値]` 期限切れActiveを持つSnapshot → `completed` / `processed >= 1` / `persisted: true` / `attempts: 1`、D1のversionが1進み、再読込したStoreでCycleが`completed`（AC-1）
- `[代表値]` 境界なし・補充不要 → `processed: 0` / `persisted: false`、D1のversion不変（AC-3）
- `[代表値]` 続けて2回実行 → 2回目は`persisted: false`でversion不変（AC-5）
- `[代表値]` Upcomingが`futureCount`未満のSnapshot → 補充されて保存される（AC-4）
- `[代表値]` Snapshot行が無いOwner → Cycle 1（Active）が作られて保存される（AC-4）
- `[状態遷移]` Lease有効なRunを持つSnapshot → `skipped / run_in_progress`、version不変（AC-6）
- `[状態遷移]` Lease切れのRunを持つSnapshot → Runが`paused`、Lockが`idle`で保存され、Cycle処理も反映（AC-6）
- `[境界値]` 保存の競合が0 / 1 / 2 / 3回 → `attempts`が1 / 2 / 3 / 例外。成功時、Cycleの終了は1回分だけ（履歴・Outboxが重複しない）（AC-7）
- `[代表値]` 3回競合したとき、D1は競合相手が保存した内容のまま（AC-7）
- `[代表値]` 保存が競合以外の例外を投げる → 再試行せず1回で再送出され、D1は不変（AC-7, AC-8）
- `[代表値]` Cycle処理が例外を投げる → 例外が再送出され、D1のversion不変、`console.error`の内容が`{event, outcome: "failed", message}`のキーだけ（AC-8）
- `[代表値]` 成功・失敗どちらのログにも`OWNER_EMAIL`・`OWNER_USER_ID`の値とIssueタイトルが含まれない（AC-8）
- `[代表値]` `Error`でない例外の`message`は`unknown`（AC-8）
- `[代表値]` Owner解決の例外messageは固定文言3種で、値を含まない（AC-9）
- `[デシジョンテーブル]` Owner解決（AC-9）:

  | mode | OWNER_USER_ID | OWNER_EMAIL | DB | users行 | 結果 |
  |---|---|---|---|---|---|
  | production | あり | あり | あり | email一致 | 処理する |
  | production | なし | あり | あり | — | 例外・Snapshotを読まない |
  | production | あり | なし | あり | — | 例外・Snapshotを読まない |
  | production | あり | あり | なし | — | 例外 |
  | production | あり | あり | あり | 行なし | 例外・Snapshotを読まない |
  | production | あり | あり | あり | email不一致 | 例外・Snapshotを読まない |
  | production | あり | あり | あり | 大文字小文字だけ違う | 処理する |
  | local | — | — | あり | `local-owner`行あり | `local-owner`で処理する |
  | local | — | — | なし | — | 例外 |
  | development | — | — | — | — | `skipped / memory_storage` |
  | production + `ORBIT_STORAGE=memory` | — | — | — | — | 例外（設定不正） |

- `[代表値]` Access JWT関連のenv（`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`）が無くても処理できる（AC-9）

### `src/server-entry.test.ts`（単体・`vi.mock`）

- `[代表値]` default exportの`fetch`が`@tanstack/react-start/server-entry`の`fetch`と同一参照（AC-11）
- `[代表値]` `scheduled(controller, env)`が`runScheduledCycles`を`env`で1回呼び、その完了を待つ（AC-11）
- `[代表値]` `runScheduledCycles`が例外を投げたら`scheduled`も同じ例外で失敗する（AC-8, AC-11）

### `scripts/worker-config.test.mjs`（単体・設定ファイルの照合）

- `[代表値]` `wrangler.jsonc`と`wrangler.local.jsonc`の`main`が`src/server.ts`（AC-11）
- `[代表値]` `wrangler.jsonc`のトップレベル`triggers.crons`が`["0 * * * *"]`で、`wrangler.local.jsonc`に`triggers`が無い（AC-11）
- `[代表値]` `package.json`の`format`と`format:check`が`src/server.ts`を含む（AC-11）

### 実測（Stage 5・テストコードなし）

- `CLOUDFLARE_ENV=production pnpm build`後の`dist/server/wrangler.json`に`triggers.crons = ["0 * * * *"]`と`vars.APP_ENV = "production"`がある（AC-11）
- 既存テストが変更なしで通る（AC-12）
