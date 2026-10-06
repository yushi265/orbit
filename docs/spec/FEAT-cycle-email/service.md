# FEAT-cycle-email: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: scheduled実行でCycleが完了または開始し、保存に成功したとき、`EMAIL.send`が1回だけ呼ばれる。引数は`from`が`MAIL_FROM`、`to`が`OWNER_EMAIL`、`subject`が`[Orbit] Cycleを更新しました`で、`text`は処理した順に、完了は`<Cycle名> が完了しました（繰越 <件数> 件）`、開始は`<Cycle名> を開始しました`の行を持つ。
- **AC-2**: 1回のscheduled実行で完了と開始の両方を処理したとき、メールは1通で、本文は完了の行、開始の行の順に並ぶ。
- **AC-3**: 処理が0件（`processed: 0`。Upcomingの補充だけを保存した場合を含む）、または`skipped`のとき、メールを送らない。
- **AC-4**: 保存の競合を再試行して成功したとき、メールは成功した試行の内容で1通だけ送られる。3回とも競合して失敗したときは、更新のメールを送らず、失敗のメールを1通送る。
- **AC-5**: scheduled実行が例外で失敗したとき、`subject`が`[Orbit] Cycleの自動処理に失敗しました`、`text`に例外の`message`を含むメールを1通送り、元の例外を再送出する。失敗ログ（`event` / `outcome` / `message`の3キー）は変えない。
- **AC-6**: `EMAIL` binding、`MAIL_FROM`、`OWNER_EMAIL`のいずれかが無いとき、送信を試みず、`console.log`へ`{"event":"cycle_mail","outcome":"not_configured"}`を出す。Cycle処理の保存内容と戻り値は変わらない。
- **AC-7**: `EMAIL.send`が例外を投げても、Cycle処理の保存内容と戻り値は変わらず、例外は外へ出ない。`console.error`へ`event` / `outcome` / `code`だけを持つJSON（`outcome`は`failed`）を出す。失敗のメールの送信が失敗したときも、元の例外がそのまま再送出される。
- **AC-8**: 送信に成功したとき`console.log`へ`{"event":"cycle_mail","outcome":"sent"}`を出す。メールに関するログに、送信元・宛先のアドレス、Cycle名、メール本文を出さない。
- **AC-9**: `hasRemaining`が`true`のとき、本文の最後に`未処理のCycleが残っています。次回の自動実行で処理します。`の行が付く。`false`のときは付かない。
- **AC-10**: `OrbitStore.runScheduledCycleTransitions`の`done`の結果が、処理した順の`transitions`を持つ。完了は`{ type: "completed", cycleId, name, moved }`、開始は`{ type: "started", cycleId, name }`で、`name`は`nameOverride`があればそれ、無ければ`name`、`moved`は次のCycleへ移動したIssueの件数。`processed`は`transitions`の件数と等しい。
- **AC-11**: `wrangler.jsonc`の`env.production`に`"send_email": [{ "name": "EMAIL" }]`があり、トップレベルと`wrangler.local.jsonc`には無い。`CLOUDFLARE_ENV=production pnpm build`が生成する`dist/server/wrangler.json`の`send_email`に`EMAIL`が出る。
- **AC-12**: 要件にメール通知（NOTIF-05）が追加され、`docs/deployment.md`にメール送信の設定手順（送信元ドメイン、宛先アドレスの検証、Secret `MAIL_FROM`、確認方法、止め方）が書かれている。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-----------------|-------------------|------|
| 変更 | `OrbitStore.runScheduledCycleTransitions(userId)` | `done`の結果へ`transitions`を追加 | 変更なし | メール本文の材料 |
| 追加 | `buildTransitionMail` / `buildFailureMail` / `sendCycleMail`（`src/server/cycle-mail.ts`） | 下記 | — | メールの組み立てと送信 |
| 変更 | `runScheduledCycles(env)` | 戻り値は変えない。成功・失敗時にメールを送る | 変更なし | 送信の呼び出し |
| 変更 | `wrangler.jsonc` | `env.production`へ`"send_email": [{ "name": "EMAIL" }]` | — | binding |

HTTPのパス、共有契約、D1 Schemaの増減はない。

### `runScheduledCycleTransitions`

```ts
export type ScheduledCycleTransition =
  | { type: "completed"; cycleId: string; name: string; moved: number }
  | { type: "started"; cycleId: string; name: string };

runScheduledCycleTransitions(userId: string):
  | { status: "locked" }
  | { status: "done"; processed: number; hasRemaining: boolean; transitions: ScheduledCycleTransition[] }
```

- `transitions`は処理した順。`processed === transitions.length`。
- `name`は`cycle.nameOverride ?? cycle.name`。
- `moved`は、その`closeCycle`が記録したOutbox（dedupe key `cycle.completed:<cycleId>`）の`payload.moved`。
- `locked`の結果とロックの判定、処理の順序、上限（25件）は変えない。
- `ScheduledCycleTransition`は`src/server/model.ts`に置く。

### `src/server/cycle-mail.ts`

```ts
export type CycleMail = { subject: string; text: string };
export type CycleMailEnvironment = {
  EMAIL?: Pick<SendEmail, "send">;
  MAIL_FROM?: string;
  OWNER_EMAIL?: string;
};

export function buildTransitionMail(
  transitions: ScheduledCycleTransition[],
  hasRemaining: boolean,
): CycleMail;
export function buildFailureMail(message: string): CycleMail;
export async function sendCycleMail(
  env: CycleMailEnvironment,
  mail: CycleMail,
): Promise<"sent" | "not_configured" | "failed">;
```

`buildTransitionMail`:

- `subject`: `[Orbit] Cycleを更新しました`
- `text`: 次の行を`\n`でつなぐ。
  - 完了: `${name} が完了しました（繰越 ${moved} 件）`
  - 開始: `${name} を開始しました`
  - `hasRemaining`が`true`なら、空行を1つ挟んで`未処理のCycleが残っています。次回の自動実行で処理します。`

`buildFailureMail`:

- `subject`: `[Orbit] Cycleの自動処理に失敗しました`
- `text`: `Cycleの自動処理に失敗しました。次回の自動実行（毎時）で再試行します。\n\n原因: ${message}`

`sendCycleMail`:

1. `env.EMAIL`、`env.MAIL_FROM`、`env.OWNER_EMAIL`のいずれかが無い（空文字を含む）なら、`console.log(JSON.stringify({ event: "cycle_mail", outcome: "not_configured" }))`を出して`"not_configured"`を返す。
2. `await env.EMAIL.send({ from: env.MAIL_FROM, to: env.OWNER_EMAIL, subject: mail.subject, text: mail.text })`。
3. 成功: `console.log(JSON.stringify({ event: "cycle_mail", outcome: "sent" }))`を出して`"sent"`を返す。
4. 例外: `console.error(JSON.stringify({ event: "cycle_mail", outcome: "failed", code }))`を出して`"failed"`を返す。`code`は例外が文字列の`code`プロパティを持てばその値、無ければ`"unknown"`。例外は投げない。

### `runScheduledCycles`の変更

- 成功: `outcome: "completed"`かつ`transitions`が1件以上のとき、`persist`が成功したあと、結果ログ（`scheduled_cycles`）を出す前に`await sendCycleMail(env, buildTransitionMail(transitions, hasRemaining))`を呼ぶ。`transitions`が0件、または`skipped`のときは呼ばない。
- 失敗: 既存の失敗ログ（`console.error`）を出したあと、`await sendCycleMail(env, buildFailureMail(message))`を呼び、元の例外を再送出する。`message`は失敗ログと同じ値。
- `ScheduledCyclesResult`と`scheduled_cycles`のログのキーは変えない。
- `env`の型は`RuntimeEnvironment & CycleMailEnvironment`として受ける（`src/server/auth.ts`の`RuntimeEnvironment`は変えない）。`src/server.ts`の`scheduled`の`env`も同じ型にする。

### 設定

- `wrangler.jsonc`: `env.production`へ`"send_email": [{ "name": "EMAIL" }]`。トップレベルには書かない。宛先・送信元の制限属性は書かない（アドレスをリポジトリへ置かない）。
- `wrangler.local.jsonc`: 変更しない。
- Secret: `MAIL_FROM`（送信元アドレス）。`pnpm exec wrangler secret put MAIL_FROM --env production`で登録する。`scripts/deploy-preflight.mjs`の必須Secretには加えない（未設定でも動く）。

## このレイヤーが依存する下位の契約（呼び出す相手）

- Cloudflareの`send_email` binding: `env.EMAIL.send({ from, to, subject, text })`。失敗時は`code`を持つ`Error`を投げる。

## 実装配置

- `src/server/model.ts`: `ScheduledCycleTransition`。
- `src/server/store.ts`: `runScheduledCycleTransitions`の戻り値。
- `src/server/cycle-mail.ts`（新規）。
- `src/server/scheduled-cycles.ts`、`src/server.ts`。
- `wrangler.jsonc`。
- テスト: `src/server/cycle-mail.test.ts`（新規）、`src/server/scheduled-cycles-mail.test.ts`（新規）、`src/server/store-scheduled-cycles.test.ts`（追記）、`scripts/worker-config.test.mjs`（追記）。

### ドキュメント更新（AC-12）

- `docs/requirements/02-functional.md`: 6.8へNOTIF-05「CronによるCycleの開始・完了・自動処理の失敗を、所有者本人へメールで通知する」を追加。受入条件は「1回の自動実行につき1通。送信の失敗でCycle処理を失敗にしない。設定が無ければ送らない」。
- `docs/requirements/01-product.md` / `04-architecture.md`: 外部連携の記述にメール送信（Cloudflareの`send_email` binding、宛先は所有者本人のみ）を足す。
- `docs/deployment.md`: メール送信の設定手順（送信元ドメイン、宛先アドレスの検証、Secret `MAIL_FROM`、デプロイ後の確認、止め方）。
- `docs/ai-dlc/codekb/shared.md`: 本ボルトの事実と罠。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| `EMAIL` / `MAIL_FROM` / `OWNER_EMAIL`のいずれかが無い | 送信しない。`console.log`へ`{"event":"cycle_mail","outcome":"not_configured"}` |
| `EMAIL.send`が例外（`code`あり） | 例外を握る。`console.error`へ`{"event":"cycle_mail","outcome":"failed","code":"<code>"}` |
| `EMAIL.send`が例外（`code`なし・`Error`以外） | 同上で`code`は`"unknown"` |
| Cycle処理が例外 | 既存の失敗ログ → 失敗メール → 元の例外を再送出 |
| 失敗メールの送信も失敗 | `cycle_mail / failed`をログ。元の例外を再送出 |
| 保存の競合が3回 | 更新のメールは送らない。失敗メールを送る |

## テストケース

### `src/server/cycle-mail.test.ts`（単体）

- `[代表値]` 完了1件 → 件名`[Orbit] Cycleを更新しました`、本文`Cycle 1 が完了しました（繰越 3 件）`（AC-1）
- `[代表値]` 開始1件 → 本文`Cycle 2 を開始しました`（AC-1）
- `[境界値]` 繰越0件 / 1件 → `（繰越 0 件）` / `（繰越 1 件）`（AC-1）
- `[代表値]` 完了 → 開始の2件 → 2行がこの順で`\n`区切り（AC-2）
- `[同値分割]` `hasRemaining`が`true` / `false` → 末尾の残件の行あり（空行を挟む）/ なし（AC-9）
- `[代表値]` 件名にCycle名が入らない（Cycle名に改行を含めても件名は固定）（AC-1）
- `[代表値]` 失敗メール → 件名`[Orbit] Cycleの自動処理に失敗しました`、本文が`原因: <message>`を含む（AC-5）
- `[デシジョンテーブル]` `EMAIL` × `MAIL_FROM` × `OWNER_EMAIL`の有無（8通り。空文字は「無い」扱いの行を含む）→ 3つ揃ったときだけ`send`を1回呼び`"sent"`、それ以外は呼ばず`"not_configured"`（AC-6）
- `[代表値]` 送信時の引数が`{ from: MAIL_FROM, to: OWNER_EMAIL, subject, text }`と一致（AC-1）
- `[同値分割]` `send`の例外が、`code`を持つ`Error` / `code`の無い`Error` / `Error`でない値 → `"failed"`を返し、ログの`code`は`その値` / `"unknown"` / `"unknown"`。例外は投げない（AC-7）
- `[代表値]` 成功・失敗・未設定のログが、それぞれ`{event, outcome}` / `{event, outcome, code}` / `{event, outcome}`のキーだけ（AC-7, AC-8）
- `[代表値]` どのログにも送信元・宛先のアドレス、Cycle名、本文が含まれない（AC-8）

### `src/server/scheduled-cycles-mail.test.ts`（レイヤー内結合・FakeD1 + `vi.useFakeTimers()`）

- `[代表値]` 期限切れActiveを持つSnapshot → `send`が1回、`from` / `to` / `subject`が期待どおりで、本文に完了の行（AC-1）
- `[代表値]` 完了と開始を1回で処理するSnapshot → `send`は1回、本文は完了の行、開始の行の順（AC-2）
- `[同値分割]` 境界なし / Upcomingの補充だけ保存 / Manual Run実行中（`skipped`）/ Memory Store（`skipped`）→ `send`を呼ばない（AC-3）
- `[代表値]` `hasRemaining`が`true`の結果 → 本文の最後に残件の行が付く（AC-9）
- `[境界値]` 保存の競合が0 / 1 / 2回 → `send`は1回だけ。本文は再読込したD1の内容（完了したCycle名・繰越件数）と一致（AC-4）
- `[境界値]` 保存の競合が3回 → `send`は1回で件名が失敗のもの。更新のメールは無い。例外は`D1_WRITE_CONFLICT`（AC-4, AC-5）
- `[代表値]` Cycle処理が例外 → 失敗メール1通（本文に`message`）、同じ例外が再送出、既存の失敗ログは3キーのまま（AC-5）
- `[代表値]` 送信は保存のあと: `send`が呼ばれた時点で、D1のversionが進んでいる（AC-1）
- `[代表値]` `EMAIL` bindingなし → 戻り値とD1の内容は、bindingありの場合と同じ。`cycle_mail / not_configured`のログ（AC-6）
- `[代表値]` `send`が例外 → 戻り値は`completed`、D1は保存済み、例外は外へ出ない（AC-7）
- `[代表値]` Cycle処理が例外で、失敗メールの`send`も例外 → 再送出されるのはCycle処理の例外（AC-7）
- `[代表値]` Owner未設定（`OWNER_EMAIL`なし）で失敗 → `send`を呼ばず、元の例外を再送出（AC-6）
- `[代表値]` `scheduled_cycles`のログのキーと`ScheduledCyclesResult`の形が変わらない（AC-5）

### `src/server/store-scheduled-cycles.test.ts`（追記・単体）

- `[代表値]` 完了1件 → `transitions`が`[{ type: "completed", cycleId, name, moved }]`で、`moved`は移動したIssueの件数（AC-10）
- `[境界値]` 移動するIssueが0件 → `moved: 0`（AC-10）
- `[代表値]` 別Ownerが同じdedupe keyのOutboxを持っていても、その`moved`を読まない（AC-10）
- `[代表値]` 開始1件 → `[{ type: "started", cycleId, name }]`（AC-10）
- `[代表値]` 完了と開始 → 完了、開始の順（AC-10）
- `[同値分割]` `nameOverride`あり / なし → `name`が`nameOverride` / `name`（AC-10）
- `[代表値]` 処理0件 → `transitions: []`。`locked`の結果は`transitions`を持たない（AC-10）
- `[境界値]` 26件 → `processed`と`transitions.length`がともに25（AC-10）

### `scripts/worker-config.test.mjs`（追記）

- `[代表値]` `wrangler.jsonc`の`env.production.send_email`が`[{ name: "EMAIL" }]`で、トップレベルと`wrangler.local.jsonc`に`send_email`が無い（AC-11）

### 実測（Stage 5・テストコードなし）

- `CLOUDFLARE_ENV=production pnpm build`後の`dist/server/wrangler.json`の`send_email`に`EMAIL`がある（AC-11）
