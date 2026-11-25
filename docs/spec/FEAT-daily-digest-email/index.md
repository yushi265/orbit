# FEAT-daily-digest-email: 毎朝のダイジェストメール

## 概要

毎朝7:30（JST）に、Ownerの「期限切れ」「今日期限」「今のCycleの未完了」Issueを1通のメールにまとめて送る。Cloudflare Email Sending（Workers Freeでは確認済み宛先のみ送信可、2026-11-24に提供開始）とCron Triggerを使う。

## 対象範囲

- 対象レイヤー: service（ダイジェスト生成・送信・Worker entry）。data層は既存の `readStoreSnapshot` を使うだけで変更しない
  - [service.md](./service.md)
- 対象ドメイン: Issue / Cycle（読み取りのみ）
- 対象外（やらないこと）: 送信時刻の設定UI、Settings画面のON/OFF、HTMLメール、昨日完了したIssue、該当ゼロ日の送信、送信済み記録、D1への書き込み・Migration、Inbox通知（NOTIF-01〜04）の実装

## ユニット計画

単一ユニット。

## 受け入れ基準（AC）

- [ ] **AC-1**: 送信対象は未削除・未アーカイブで状態カテゴリがcompleted / canceled以外のIssueとし、期限日がOwnerのtimezoneの今日より前なら「期限切れ」、今日なら「今日期限」、どちらでもなく状態がactiveのCycleに属すなら「Cycleの未完了」に、1件につき1区分だけ入れる。期限日がDateで表せない値のIssueは期限なしとして扱い、他のIssueの送信を止めない。
- [ ] **AC-2**: 各区分は件数と、識別子・タイトル・Issue画面のURL（`<ORBIT_APP_URL>/issues/<Issue id>`）を並べたtext本文を持ち、1区分20件を超える分は「ほかN件」とまとめる。件名は日付と3区分の件数を含む。
- [ ] **AC-3**: 3区分がすべて0件の日はメールを送らない。
- [ ] **AC-4**: Cron Trigger（UTC 22:30＝JST 7:30）で起動し、`EMAIL` binding・`ORBIT_DIGEST_FROM`・`ORBIT_DIGEST_TO`・`ORBIT_APP_URL`・`OWNER_USER_ID`のどれかが無い、または`OWNER_USER_ID`のsnapshotがD1に無い場合は送らずにスキップ理由だけをログに出す。他のuser_idのsnapshotは読まない。
- [ ] **AC-5**: 送信に失敗したら、エラーコードだけをログに出し、エラーコードだけをメッセージに持つ新しい例外を投げる（Cron実行を失敗として残す）。ログにも投げる例外にもメールアドレス・Issueタイトルを含めない。
- [ ] **AC-6**: 既存のHTTP（fetch）の挙動を変えない。scheduled処理はD1へ書き込まない。

## アーキテクチャ / レイヤー間フロー

```text
Cron Trigger (30 22 * * *)
  ↓ scheduled(controller, env, ctx)          src/server.ts（新規 server entry）
runDailyDigest(env, now)                      src/server/daily-digest.ts
  ├─ 設定チェック（binding / env）→ 不足ならskip
  ├─ readStoreSnapshot(DB, OWNER_USER_ID) → OrbitStore.fromSnapshot（読むだけ・persistしない）
  ├─ buildDailyDigest(store, userId, now, appUrl) → { subject, text } | null
  └─ env.EMAIL.send({ from, to, subject, text })
fetch は従来どおり TanStack Start の handler へ委譲
```

## エラー・ログ方針（横断サマリ）

| シナリオ | data | service | ログ |
|---|---|---|---|
| 設定不足（binding / env） | — | 送らずreturn | `daily-digest skipped: <reason>` |
| `OWNER_USER_ID`のsnapshotが無い | null | 送らずreturn | `daily-digest skipped: snapshot-missing` |
| 該当Issue 0件 | — | 送らずreturn | `daily-digest skipped: empty` |
| snapshot JSON不正 | 既存の例外 | そのまま投げる | Cron失敗 |
| 送信失敗（`E_RECIPIENT_PLAN_RESTRICTED`等） | — | コードだけの新しい例外をthrow | `daily-digest send failed: <code>` |
| 送信成功 | — | — | `daily-digest sent: overdue=<n> today=<n> cycle=<n>` |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|----|------|--------------|
| AC-1 | buildDailyDigest の区分判定（デシジョンテーブル・期限日境界・timezone・不正な期限） | — |
| AC-2 | 本文・件名・20件境界（19/20/21） | — |
| AC-3 | 0件でnull | runDailyDigest が send を呼ばない |
| AC-4 | — | runDailyDigest の設定不足6種・Ownerのsnapshot有無・他Ownerのsnapshotを読まない |
| AC-5 | — | send失敗でログ＋コードだけの例外、ログと例外に宛先・タイトルが出ない |
| AC-6 | — | server entry の fetch 委譲・scheduled の waitUntil、D1書き込みSQLを発行しない |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `readStoreSnapshot` / `decodeStoreSnapshot` / `OrbitStore.fromSnapshot`、`calendarDateKeyInTimeZone` / `issueDueDateKey`（期限判定は既存Issue一覧の due filter と同じ基準）、Owner preferences の timezone。
- 差分: `src/server.ts` を新設し、`wrangler.jsonc` の `main` を `@tanstack/react-start/server-entry` から `src/server.ts` に変える。`src/server.ts` は既定エントリ（`@tanstack/react-start/server-entry`）の `fetch` をそのまま使い、`scheduled` を足す。`main` を変えないとCloudflareのビルドが既定エントリを使い、`scheduled` が含まれないことをビルド成果物で確認した（2026-11-25）。ローカル用 `wrangler.local.jsonc` は変えない（ローカルでは送らない）。
- 衝突: `openStoreSession` は開くと Cycle補完などでsnapshotを書き換えうるので使わない（読み取り専用で `fromSnapshot` だけ呼ぶ）。

## 実装に効く制約

- 一人専用。Workers Free の Email Sending は確認済み宛先にしか送れないため、宛先は Owner の確認済みアドレス1つだけ（`ORBIT_DIGEST_TO`）。
- 宛先・送信元は `wrangler secret put` で登録し、リポジトリにメールアドレスを書かない。`ORBIT_APP_URL` は production の vars に置く。
- `send_email` binding と `triggers` は production env に明示する（env 間で継承しない前提で書く）。
- 本番への反映（ドメインのEmail Sending登録、宛先確認、secret登録、デプロイ）はユーザーのMacとCloudflareダッシュボードで行う。

## 判断根拠 / 未決事項

- 送信時刻はCronで7:30 JST固定（Gate 1で1-a）。設定可能にすると毎時起動と送信済み記録（snapshot書き込み）が要り、Tier 1の書き込み経路が増えるため却下。
- 中身は期限切れ・今日期限・Cycle未完了（2-a）。0件の日は送らない（3-a）。ON/OFFは環境変数の有無だけ（4-a）。
- 1Issueは1区分にだけ出す（期限切れ > 今日期限 > Cycle）。同じIssueが重複すると件数がわかりにくいため。
- 本文はtextのみ。HTMLにするとテンプレートとエスケープの保守が増え、スマホのメールアプリでもURLはリンクになるため。
- 送信対象はHTTP側の認証と同じ`OWNER_USER_ID`で決める。当初は「snapshotが1件のときだけ」としたが、Owner切替や復元で旧Ownerのsnapshotだけが残ると旧OwnerのIssueを送ってしまうとCodexレビューで指摘され変更した（2026-11-25）。これで新しいdata関数も不要になった。
- 送信失敗の元の例外はメッセージに宛先を含みうるため、Workersの例外ログに渡さずコードだけの例外に置き換える（Codexレビュー指摘）。
- 不正な期限1件でダイジェスト全体が止まらないよう、Dateで表せない期限は期限なし扱いにする（Codexレビュー指摘。入力側の範囲検証は既存仕様のため本PRの範囲外）。
- Cron時刻はOwnerのtimezoneを追わない（UTC固定）。「今日」の判定にはtimezoneを使う。
- 未決事項: なし
