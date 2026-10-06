# FEAT-cycle-email: Cycle自動処理のメール通知

> 薄い実装 spec の入口。レイヤー詳細は [service.md](./service.md)。[FEAT-cycle-cron](../FEAT-cycle-cron/index.md) の上に積む。

## 概要

Cron TriggerによるCycle自動処理（[FEAT-cycle-cron](../FEAT-cycle-cron/index.md)）でCycleが完了・開始したとき、または自動処理が失敗したときに、Cloudflareの`send_email` bindingで所有者本人へメールを1通送る。

## 対象範囲

- 対象レイヤー: service（[service.md](./service.md)）。Wrangler設定もserviceに含める。
- 対象ドメイン: cycles、notifications
- 対象外（やらないこと）:
  - 通知種別ごとのON/OFF設定（NOTIF-04）、設定画面
  - Inbox通知（`cycle_started` / `cycle_completed` / `automation_failed`）の生成
  - Manual Run、手動の「次のCycleを開始」・Cycle完了でのメール送信
  - 期限接近・期限超過のメール
  - HTMLメール、アプリへのリンク、本文の多言語対応
  - 送信の再試行、送信履歴の保存、失敗メールの重複抑止
  - UI、共有契約（`src/shared/`）、Server Route、D1 Schema / Migrationの変更

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: scheduled実行でCycleが完了または開始し、保存に成功したとき、`EMAIL.send`が1回だけ呼ばれる。引数は`from`が`MAIL_FROM`、`to`が`OWNER_EMAIL`、`subject`が`[Orbit] Cycleを更新しました`で、`text`は処理した順に、完了は`<Cycle名> が完了しました（繰越 <件数> 件）`、開始は`<Cycle名> を開始しました`の行を持つ。
- [ ] **AC-2**: 1回のscheduled実行で完了と開始の両方を処理したとき、メールは1通で、本文は完了の行、開始の行の順に並ぶ。
- [ ] **AC-3**: 処理が0件（`processed: 0`。Upcomingの補充だけを保存した場合を含む）、または`skipped`のとき、メールを送らない。
- [ ] **AC-4**: 保存の競合を再試行して成功したとき、メールは成功した試行の内容で1通だけ送られる。3回とも競合して失敗したときは、更新のメールを送らず、失敗のメールを1通送る。
- [ ] **AC-5**: scheduled実行が例外で失敗したとき、`subject`が`[Orbit] Cycleの自動処理に失敗しました`、`text`に例外の`message`を含むメールを1通送り、元の例外を再送出する。失敗ログ（`event` / `outcome` / `message`の3キー）は変えない。
- [ ] **AC-6**: `EMAIL` binding、`MAIL_FROM`、`OWNER_EMAIL`のいずれかが無いとき、送信を試みず、`console.log`へ`{"event":"cycle_mail","outcome":"not_configured"}`を出す。Cycle処理の保存内容と戻り値は変わらない。
- [ ] **AC-7**: `EMAIL.send`が例外を投げても、Cycle処理の保存内容と戻り値は変わらず、例外は外へ出ない。`console.error`へ`event` / `outcome` / `code`だけを持つJSON（`outcome`は`failed`）を出す。失敗のメールの送信が失敗したときも、元の例外がそのまま再送出される。
- [ ] **AC-8**: 送信に成功したとき`console.log`へ`{"event":"cycle_mail","outcome":"sent"}`を出す。メールに関するログに、送信元・宛先のアドレス、Cycle名、メール本文を出さない。
- [ ] **AC-9**: `hasRemaining`が`true`のとき、本文の最後に`未処理のCycleが残っています。次回の自動実行で処理します。`の行が付く。`false`のときは付かない。
- [ ] **AC-10**: `OrbitStore.runScheduledCycleTransitions`の`done`の結果が、処理した順の`transitions`を持つ。完了は`{ type: "completed", cycleId, name, moved }`、開始は`{ type: "started", cycleId, name }`で、`name`は`nameOverride`があればそれ、無ければ`name`、`moved`は次のCycleへ移動したIssueの件数。`processed`は`transitions`の件数と等しい。
- [ ] **AC-11**: `wrangler.jsonc`の`env.production`に`"send_email": [{ "name": "EMAIL" }]`があり、トップレベルと`wrangler.local.jsonc`には無い。`CLOUDFLARE_ENV=production pnpm build`が生成する`dist/server/wrangler.json`の`send_email`に`EMAIL`が出る。
- [ ] **AC-12**: 要件にメール通知（NOTIF-05）が追加され、`docs/deployment.md`にメール送信の設定手順（送信元ドメイン、宛先アドレスの検証、Secret `MAIL_FROM`、確認方法、止め方）が書かれている。

## アーキテクチャ / レイヤー間フロー

```
scheduled → runScheduledCycles(env)
  ├─ 成功（transitionsが1件以上）: persist成功のあと sendCycleMail(env, buildTransitionMail(...))
  └─ 例外: 失敗ログ → sendCycleMail(env, buildFailureMail(message)) → 例外を再送出
sendCycleMail: EMAIL / MAIL_FROM / OWNER_EMAIL が揃っていれば env.EMAIL.send({ from, to, subject, text })
```

メールは保存に成功したあとで送る。送信の成否はCycle処理に影響しない。

## エラー・ログ方針（横断サマリ）

| シナリオ | service | 表示層の挙動 |
|---|---|---|
| 送信成功 | `console.log`へ`cycle_mail / sent` | 変更なし |
| 設定なし | 送信せず`console.log`へ`cycle_mail / not_configured` | 変更なし |
| 送信失敗 | 例外を握り、`console.error`へ`cycle_mail / failed`と`code` | 変更なし |
| Cycle処理の失敗 | 既存の失敗ログのあと失敗メールを送り、例外を再送出 | 変更なし |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|----|------|--------------|
| AC-1 | メール本文の組み立て | `runScheduledCycles`から`EMAIL.send`の引数 |
| AC-2 | 行の順序 | 完了と開始を1回で処理 |
| AC-3 | — | 0件・補充のみ・`skipped` |
| AC-4 | — | 競合1回→1通、3回→失敗メール |
| AC-5 | 失敗メールの組み立て | 例外時の送信と再送出 |
| AC-6 | 設定のデシジョンテーブル | Cycle処理は不変 |
| AC-7 | `send`の例外 | Cycle処理は不変・元の例外を保持 |
| AC-8 | ログのキーと内容 | — |
| AC-9 | `hasRemaining`の有無 | — |
| AC-10 | Store: `transitions` | — |
| AC-11 | 設定ファイル | 本番buildの生成物（Stage 5で実測） |
| AC-12 | — | —（レビューで確認） |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `runScheduledCycles`の成功・失敗の分岐、Outbox `cycle.completed`の`payload.moved`、Cycleの表示名（`nameOverride ?? name`）、Secret `OWNER_EMAIL`。
- 差分: `runScheduledCycleTransitions`は件数しか返さない。メール送信のコードと`send_email` bindingが無い。
- 衝突: `runScheduledCycleTransitions`の戻り値に`transitions`を足すため、FEAT-cycle-cronのテストのうち戻り値全体を`toEqual`で比べているものは期待値の更新が要る。
- 依存: Cloudflareの`send_email` binding、Secret `MAIL_FROM`（新規）、宛先アドレスの検証（Cloudflare側の設定）。

## 実装に効く制約

- メール送信はscheduledの経路からだけ呼ぶ。HTTPの経路（Manual Run、Cycleの手動操作）へ足さない。
- 送信元・宛先のアドレスをリポジトリ、ログ、テストの期待値以外の場所へ書かない。`wrangler.jsonc`にアドレスを書かない。
- 件名は固定文言にし、利用者が入力した値（Cycle名）を入れない。
- Snapshotの形状を変えない。
- `send_email`は環境へ継承されないため、`env.production`の下に書く。
- mainへのマージは本番デプロイである。`send_email` bindingを含むデプロイの前に、Cloudflare側のメール設定を済ませる。

## 判断根拠 / 未決事項

- **1回の実行につき1通**。完了と開始は同じ実行で続けて起きることが多く、別々に送ると2通届く。
- **メールは保存成功のあと**。保存が競合で捨てられた試行の内容を送らないため。
- **送信失敗でCycle処理を失敗にしない**。Cycleの切替が本体で、メールは付随する。再試行もしない（YAGNI）。届かなかった場合は`cycle_mail / failed`のログで分かる。
- **設定が無ければ黙って送らない**。メールの設定前でもCronは動かせる。ローカルとdevelopmentはbindingを持たないため、追加の分岐なしで送信されない。
- **`runScheduledCycles`の戻り値は変えない**。メールの結果は別のログ行（`cycle_mail`）に出す。戻り値へ足すとFEAT-cycle-cronの結合テストの期待値を広く書き換えることになる。
- **`moved`はOutboxの`cycle.completed`から読む**。`closeCycle`の戻り値を変えずに済む。
- **構造化API（`send({ from, to, subject, text })`）を使う**。MIMEを組み立てるライブラリが要らない。導入済みの`@cloudflare/workers-types`の`SendEmail`にこのoverloadがある。
- **受け入れるトレードオフ**: 失敗が続く間、失敗メールが毎時届く。失敗時は保存できないため、重複を抑える状態を持てない。Owner設定の不備で`OWNER_EMAIL`が無い場合は、失敗メールも送れない（ログのみ）。
- **要件の追加**: メール通知は既存の要件に無いため、NOTIF-05として`docs/requirements/02-functional.md`へ追加する（Gate 3で提示）。
- 未決事項: なし。
