# FEAT-daily-digest-email: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 送信対象は未削除・未アーカイブで状態カテゴリがcompleted / canceled以外のIssueとし、期限日がOwnerのtimezoneの今日より前なら「期限切れ」、今日なら「今日期限」、どちらでもなく状態がactiveのCycleに属すなら「Cycleの未完了」に、1件につき1区分だけ入れる。
- **AC-2**: 各区分は件数と、識別子・タイトル・Issue画面のURL（`<ORBIT_APP_URL>/issues/<Issue id>`）を並べたtext本文を持ち、1区分20件を超える分は「ほかN件」とまとめる。件名は日付と3区分の件数を含む。
- **AC-3**: 3区分がすべて0件の日はメールを送らない。
- **AC-4**: Cron Trigger（UTC 22:30＝JST 7:30）で起動し、`EMAIL` binding・`ORBIT_DIGEST_FROM`・`ORBIT_DIGEST_TO`・`ORBIT_APP_URL`のどれかが無い、またはD1のsnapshotがちょうど1件でない場合は送らずにスキップ理由だけをログに出す。
- **AC-5**: 送信に失敗したら、エラーコードだけをログに出して例外を投げ直す（Cron実行を失敗として残す）。ログにメールアドレス・Issueタイトルを出さない。
- **AC-6**: 既存のHTTP（fetch）の挙動を変えない。scheduled処理はD1へ書き込まない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|------|------------|-----------------|-------------------|------|
| 追加 | Worker `scheduled` handler（`src/server.ts` の default export） | `{ fetch, scheduled(controller, env, ctx) }`。fetch は TanStack Start の既定 handler に委譲。scheduled は `ctx.waitUntil(runDailyDigest(env, controller.scheduledTime))` | Cloudflareからの起動のみ | 毎朝の送信 |
| 追加 | `buildDailyDigest(store: OrbitStore, userId: string, now: number, appUrl: string): DailyDigest \| null` | `DailyDigest = { subject: string; text: string; counts: { overdue: number; today: number; cycle: number } }`。全区分0件なら null | 内部 | 本文生成（純粋関数） |
| 追加 | `runDailyDigest(env: DailyDigestEnv, now: number, log?: (line: string) => void): Promise<DailyDigestResult>` | `DailyDigestEnv = { DB?: D1Database; EMAIL?: { send(message): Promise<{ messageId: string }> }; ORBIT_DIGEST_FROM?: string; ORBIT_DIGEST_TO?: string; ORBIT_APP_URL?: string }`。`DailyDigestResult = { status: "sent"; counts } \| { status: "skipped"; reason: "missing-config" \| "snapshot-count" \| "empty" }` | 内部 | Cronの本体 |
| 変更 | `wrangler.jsonc` | `main` を `src/server.ts` に。top-level と `env.production` に `"send_email": [{ "name": "EMAIL" }]`。`env.production` に `"triggers": { "crons": ["30 22 * * *"] }` と `vars.ORBIT_APP_URL = "https://orbit.okogelab.com"` | — | binding・Cron・URL |

### 件名と本文（確定値）

件名: `orbit 11/26(木) 期限切れ2・今日3・Cycle5`（日付はOwnerのtimezone、`M/D(曜)`）

```text
おはようございます。orbitの今日のまとめです。

■ 期限切れ（2）
- TASK-12 請求書を送る（期限 11/24）
  https://orbit.okogelab.com/issues/<id>
...

■ 今日期限（3）
- TASK-15 ...
  https://orbit.okogelab.com/issues/<id>

■ Cycle 12 の未完了（5）
- TASK-20 ...
  https://orbit.okogelab.com/issues/<id>
- ほか2件

https://orbit.okogelab.com/
```

- 0件の区分は見出しごと出さない。
- 並び順: 期限切れ・今日期限は期限日昇順→priority順（urgent, high, medium, low, no_priority）→identifier。Cycleはpriority順→identifier。
- `appUrl` の末尾 `/` は取り除いて連結する。
- Cycle名は `nameOverride ?? name`。

## このレイヤーが依存する下位の契約（呼び出す相手）

- `listStoreSnapshotUserIds`（[data.md](./data.md)）、既存 `readStoreSnapshot`
- 既存 `decodeStoreSnapshot` / `OrbitStore.fromSnapshot`（persist しない）
- Cloudflare Email Sending Workers API `env.EMAIL.send({ from, to, subject, text })`。失敗時は `code` プロパティ付きの例外

## 実装配置

- `src/server.ts`（新規。TanStack Start のカスタム server entry）
- `src/server/daily-digest.ts`（新規）
- `src/server/daily-digest.test.ts`（新規）
- `wrangler.jsonc`
- `docs/requirements/02-functional.md`（通知節に毎朝メールを追記）、`docs/deployment.md`（運用手順: Email Sendingのドメイン登録・宛先確認・secret登録）

## 異常系挙動

- 設定不足: どれが無いかを `missing-config: EMAIL,ORBIT_DIGEST_TO` のように**キー名だけ**ログに出す。
- 送信失敗: `daily-digest send failed: <error.code ?? "unknown">` を出して再throw。
- 例外メッセージや本文をそのままログに出さない（タイトル・アドレス漏れ防止）。

## テストケース

- [デシジョンテーブル] 状態カテゴリ（backlog/unstarted/started/completed/canceled）× 期限（なし/昨日/今日/明日）× Cycle（active/upcoming/なし）× 削除・アーカイブ → 区分
- [境界値] timezone Asia/Tokyo で UTC 22:30 起動時の「今日」が翌日のJST日付になる。期限日が今日/昨日の境目
- [境界値] 1区分 19 / 20 / 21 件 → 21件で「ほか1件」
- [代表値] 件名の日付・件数、URL連結（末尾 `/` あり/なし）
- [代表値] 全区分0件 → null、runDailyDigest は send を呼ばず `empty`
- [異常系] EMAIL / FROM / TO / APP_URL / DB それぞれ欠落 → `missing-config`
- [境界値] snapshot 0件・2件 → `snapshot-count`、1件 → 送信
- [異常系] send が `{ code: "E_RECIPIENT_PLAN_RESTRICTED" }` で失敗 → ログにコード、再throw、ログに宛先・タイトルを含まない
- [代表値] D1 へ INSERT/UPDATE/DELETE を発行しない
- [代表値] server entry: fetch が既定 handler に委譲される、scheduled が waitUntil に runDailyDigest を渡す
