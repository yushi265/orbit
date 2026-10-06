# FEAT-cycle-cron: Cron TriggerによるCycle境界処理の自動実行

> 薄い実装 spec の入口。レイヤー詳細は [service.md](./service.md)。

## 概要

Cloudflare WorkersのCron Trigger（毎時0分・UTC）でWorkerの`scheduled`ハンドラを起動し、Cycleの補充・終了・繰越・開始をブラウザなしで自動実行する。SettingsのManual Runはそのまま残す。

本specは、[FEAT-cycle-boundary-transition](../FEAT-cycle-boundary-transition/index.md)の対象外「自動Scheduler、Cron」と制約「ユーザーが起動したHTTP Chunk Runnerだけを境界処理の入口とする」を置き換える。

## 対象範囲

- 対象レイヤー: service（[service.md](./service.md)）。Worker entry（`src/server.ts`）とWrangler設定もserviceに含める。
- 対象ドメイン: cycles
- 対象外（やらないこと）:
  - メール通知（次ボルト`FEAT-cycle-email`。送信手段は未定）
  - Inbox通知（`cycle_started` / `cycle_completed` / `automation_failed`）の生成
  - Purge、Outbox再送（`pending`→`sent`）、`sent` Outboxの削除。CronはManual Runの`purge` / `outbox_retry`を実行しない
  - Background Run（`background_runs`）の作成、Run契約（`kind` / step）の変更
  - UI、共有契約（`src/shared/`）、Server Route、D1 Schema / Migrationの変更
  - Cron頻度の設定画面、Cronの有効/無効の切替

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: Activeの`endsAt <= now`のとき、scheduled実行1回でそのCycleが`completed`になり、Workflow categoryが`unstarted` / `started`のIssueだけが次のCycleへ移動する。繰越履歴は移動したIssueごとに1件、Outbox `cycle.completed`は1件作られ、D1 Snapshotへ保存される。
- [ ] **AC-2**: Activeが無く、最も番号の小さいUpcomingの`startsAt <= now`のとき、scheduled実行でそのCycleが予定の`startsAt` / `endsAt`を保ったまま`active`になり、Activity（`cycle` / `started`）がactor `system:automation`で1件、Outbox `cycle.started`が1件記録される。
- [ ] **AC-3**: 境界に達したCycleが無いとき（Activeの`endsAt > now`、またはActiveが無くUpcomingの`startsAt > now`）、scheduled実行はCycle・Issue・Activity・Outboxを変更せず、D1 Snapshotのversionを進めない。
- [ ] **AC-4**: 後続Upcomingが`futureCount`に足りないとき、scheduled実行で不足分が補充されてD1 Snapshotへ保存される。Cycleが0件のOwnerでは初期Active Cycle 1が作られる。
- [ ] **AC-5**: 同じ時刻のままscheduled実行を2回続けても、2回目はCycle・繰越履歴・Activity・Outboxを増やさず、D1 Snapshotのversionを進めない。
- [ ] **AC-6**: Manual RunがLockを保持している（Leaseが有効）とき、scheduled実行は何も変更・保存せず`{ outcome: "skipped", reason: "run_in_progress" }`を返す。Leaseが切れているときはRunを`paused`にしてLockを解放したうえでCycle処理を行い、保存する。
- [ ] **AC-7**: 保存時に`D1_WRITE_CONFLICT`が起きたら最新のSnapshotを読み直してやり直し、合計3回まで試行する。途中で成功すればCycle処理は1回分だけ反映される。3回とも競合したら例外を投げ、D1は競合相手が保存した内容のまま残る。
- [ ] **AC-8**: Cycle処理の途中で例外が起きたら、D1へ何も保存せず、`console.error`へ`event` / `outcome` / `message`だけを持つJSONを1行出して例外を再送出する。ログにメールアドレス・Issue本文・Tokenを出さない。
- [ ] **AC-9**: Ownerは次のとおり解決する。productionは`OWNER_USER_ID` / `OWNER_EMAIL`を使い、`users`行のemail一致を確認する。未設定・行なし・email不一致・D1 Bindingなしは、保存せず例外を投げる。localは固定の`local-owner`を使う。development（Memory Store）は`{ outcome: "skipped", reason: "memory_storage" }`を返す。Access JWTは使わない。
- [ ] **AC-10**: 境界に達した処理が26件以上たまっているとき、1回のscheduled実行は25件まで処理して`hasRemaining: true`を返し、次の実行が残りを処理する。ちょうど25件のときは`hasRemaining: false`を返す。
- [ ] **AC-11**: Worker entry `src/server.ts`のdefault exportが`fetch`（TanStack Startのserver entryの`fetch`そのもの）と`scheduled`を持つ。`wrangler.jsonc`と`wrangler.local.jsonc`の`main`は`src/server.ts`、`wrangler.jsonc`のトップレベルに`"triggers": { "crons": ["0 * * * *"] }`がある。`CLOUDFLARE_ENV=production pnpm build`が生成する`dist/server/wrangler.json`に同じ`triggers`と`APP_ENV=production`が出る。
- [ ] **AC-12**: Manual Runの挙動、Server Route、共有契約、D1 Schemaは変わらない。Manual Runによる予定開始のActivity actorは`system:manual-run`のまま。既存テストは変更なしで通る。
- [ ] **AC-13**: 要件・設計・運用ドキュメントの「手動実行のみ」「自動スケジューラは対象外」の記述が、Cron併用の内容へ更新されている（対象は[service.md](./service.md)の「ドキュメント更新」）。

## アーキテクチャ / レイヤー間フロー

```
Cron Trigger（毎時0分 UTC）
  └─ src/server.ts  scheduled(controller, env)
       └─ runScheduledCycles(env)                  … src/server/scheduled-cycles.ts
            ├─ resolveRuntimeConfig / Owner解決（env + users行）
            └─ 最大3回:
                 openStoreSession(userId, email, env)   … Snapshot読込 + ensureUpcomingCycles
                 store.runScheduledCycleTransitions(userId)
                 session.persist()                      … Version CAS。競合なら読み直し
```

- `fetch`はTanStack Startのハンドラをそのまま渡す。HTTPの経路・Access JWT検証は変えない。
- `scheduled`はHTTPを通らないため、Cloudflare AccessとJWT検証の対象外。Ownerはenvと`users`行で確認する。
- CronはBackground Runを作らず、Lockも保存しない。1回の実行内で読込・処理・保存を終える。

## エラー・ログ方針（横断サマリ）

| シナリオ | service | 表示層の挙動 |
|---|---|---|
| 正常終了 | `console.log`へ結果JSONを1行 | 変更なし。Bootstrap再取得（focus復帰など）で反映 |
| Manual Run実行中 | 何もせず`skipped`をログ | 変更なし |
| Snapshot競合 | 3回まで再試行。超えたら例外 | Cron側の保存が先なら、利用者の操作は既存の409（`D1_WRITE_CONFLICT`）処理で再試行 |
| Owner設定不備・D1 Bindingなし | 保存せず`console.error` + 例外 | 変更なし |
| Cycle処理中の例外 | 保存せず`console.error` + 例外 | 変更なし |

例外を再送出するのは、Cloudflareの実行結果を失敗として記録させるため。次の毎時実行が同じ処理をやり直す。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|----|------|--------------|
| AC-1 | Store: 繰越対象のcategory別判定 | FakeD1へ保存される |
| AC-2 | Store: 予定日時の保持・actor | — |
| AC-3 | Store: 境界値（`endsAt` / `startsAt`） | version不変 |
| AC-4 | — | 補充・0件Ownerの初期化が保存される |
| AC-5 | Store: 再実行で増えない | version不変 |
| AC-6 | Store: Lease境界 | 保存しない / paused保存 |
| AC-7 | — | 競合1回→成功、3回→例外 |
| AC-8 | — | 例外時に保存なし・ログ内容 |
| AC-9 | — | mode × 設定のデシジョンテーブル |
| AC-10 | Store: 25 / 26件 | — |
| AC-11 | entryのexport形・設定ファイル | 本番buildの生成物（Stage 5で実測） |
| AC-12 | 既存テスト（無変更） | 既存テスト（無変更） |
| AC-13 | — | —（レビューで確認） |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `OrbitStore.closeCycle`、`nextCycleTransition`、`activateScheduledCycle`、`ensureUpcomingCycles`、`openStoreSession`（Request非依存）、`findOwnedUser`、`resolveRuntimeConfig`、`LOCAL_OWNER`、Snapshot Version CAS。
- 差分: Request非依存のOwner解決、Cycleだけを処理するStoreの公開メソッド、Worker entry、Cron Triggerが無い。`activateScheduledCycle`はactorと`mutationKey`がManual Run専用。
- 衝突:
  - 利用者の操作とCronが同じ時間帯に保存すると、後から保存した側が`D1_WRITE_CONFLICT`になる。Cronは再試行し、利用者側は既存の409処理で受ける。
  - `createServerEntry`は`fetch`以外を落とすため、entryは素のオブジェクトで書く。
  - `package.json`の`format` / `format:check`は対象を列挙しており、`src/server.ts`を追加しないと検査されない。
- 依存: 本番のSecret `OWNER_USER_ID` / `OWNER_EMAIL`（登録済み）、D1 Binding `DB`。新しいSecretは不要。

## 実装に効く制約

- Snapshotの形状を変えない。actorは既存の`system:automation`を使い、新しい値を足さない（旧Worker Versionが読めなくなるため）。
- 自動開始は予定日時を保持する。日付を現在へ動かす手動の`startCycle`と混ぜない。
- Cycle 0件の初回状態をテストに含める。
- ログにメールアドレス・`userId`・Issue本文・Tokenを出さない。
- mainへのマージは本番デプロイであり、その時点でCronが有効になる。マージ前に[docs/deployment.md](../../deployment.md) 5章の確認（D1バックアップを含む）を行う。

## 判断根拠 / 未決事項

- **Background Runを使わず、Cycle処理だけを直接呼ぶ**。Runは3ステップ固定で、使うとPurge（30日経過データの完全削除）とOutbox再送まで走り、スコープを超える。Runを作らなければLockを保存せずに済み、利用者の操作を423で止めない。Settingsの最終Run表示や完了toastにも影響しない。却下: Cron用のRun kind追加（契約・CHECK制約・Migration・UIの変更が要る）。
- **actorは`system:automation`を再利用する**。新しい`system:cron`はSnapshot検証（`isSnapshot`）とD1のCHECK制約の変更が必要で、旧Versionへのロールバックで読めなくなる。「自動処理」という意味も合う。
- **保存は「処理した」か「sessionが初期保存を要する」ときだけ**。何もない時間帯に毎時Snapshotを書くと、利用者の操作との競合機会が増える。
- **Manual Run実行中はスキップ**。Runの`cycle_transition`が同じ処理を行うため、次の毎時実行で足りる。
- **競合は3回まで再試行**。Cycle処理は冪等なので読み直してやり直せる。回数は固定値とし、設定にしない（YAGNI）。超えた場合も次の毎時実行が拾う。
- **1回25件まで**。Manual Runの`CHUNK_SIZE`と同じ値を使い、長期停止後の追い付きで1回の実行が伸びすぎないようにする。
- **entryは`src/server.ts`**。TanStack Startは`src/server.*`をserver entryとして解決し、Cloudflare Vite pluginは`main`のdefault exportをそのまま出す。捨てコードで本番buildを行い、`dist/server/wrangler.json`に`triggers`と`APP_ENV=production`が出ること、`scheduled`がbundleに入ることを確認した。
- **受け入れるトレードオフ**: Cycleの切替は境界時刻から最大約1時間遅れる。Cronが作るOutbox（`cycle.*`）は、Manual Runの`outbox_retry`が走るまで`pending`のまま残る（現状と同じ。件数はCycle1つにつき2件）。
- 未決事項: なし。
