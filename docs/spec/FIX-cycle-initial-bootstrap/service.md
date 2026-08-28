# FIX-cycle-initial-bootstrap: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Cycleが0件のOwnerをBootstrapすると、現在時刻開始・設定期間終了の`Cycle 1`（Active）を1件作成し、`futureCount`件のUpcoming Cycle（既定では`Cycle 2`〜`Cycle 4`）を連続して作成する。
- **AC-2**: 初回生成済みOwnerがBootstrapまたはproduction Store Sessionを再実行しても、Cycle・番号・開始終了日時を重複または変更せず、既存Snapshotへ保存された4件（Active 1件＋Upcoming 3件）を返す。
- **AC-3**: 既存Cycleが1件以上あるOwnerでは初回Active Cycleを追加せず、既存のUpcoming補充（不足時のみ`futureCount`件）と既存Cycleの内容を維持する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Bootstrap | `OrbitStore.bootstrap(userId)` | `BootstrapPayload`。Cycle 0件の場合はActive 1件＋`futureCount`件のUpcomingを含む | `userId`でOwner scoped | UIへCurrent / Upcomingを返す |
| 初期化 | `OrbitStore.ensureUpcomingCycles(userId)` | `void`。Cycle 0件時だけ初期Activeを作成し、その後Upcomingを補充 | 呼び出し元のOwner `userId`だけを対象 | Bootstrap / production Sessionから呼ぶ |
| Production Session | `openStoreSession(userId, email)` | 既存D1 Snapshotを読み、成功Requestのpersistで生成結果をVersion CAS保存 | Cloudflare Accessで解決済みのOwnerのみ | 本番Snapshotのロード／保存 |

生成される初期Cycleは次の形とする。

```ts
{
  number: 1,
  name: "Cycle 1",
  status: "active",
  startsAt: clock(),
  endsAt: startsAt + settings.durationWeeks * 7 * DAY,
  nameOverride: null,
  description: "",
  completedAt: null,
  scheduleOverridden: false,
}
```

## このレイヤーが依存する下位の契約

- 呼び出す相手: `readStoreSnapshot` / `writeStoreSnapshot`
- 受け渡し: Owner `userId`、D1 SnapshotのVersion。書き込みは成功Requestの既存Version CASを利用する。

## 実装配置

- `src/server/store.ts`: Cycle 0件時の初期Active生成、既存Upcoming補充、Bootstrap
- `src/server/store-session.ts`: production Sessionの既存初回Snapshot保存
- `src/server/store-cycle.test.ts`: Cycle生成・冪等性・既存Cycle維持
- `src/server/store-session.test.ts`: production D1 Snapshotへの初回生成保存・再読込

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| OwnerのCycleが0件、`futureCount > 0` | エラーなし。初期Activeを1件作成し、後続Upcomingを補充する |
| `futureCount <= 0` | 既存どおり生成せず、BootstrapはCycle 0件を返す |
| Ownerに既存Cycleがある | 初期Activeは作らず、既存の不足Upcoming補充だけを行う |
| production Snapshot保存のVersion競合 | 既存の`D1_WRITE_CONFLICT`へ変換し、競合Sessionの結果を保存しない |

## テストケース（技法注記付き）

- [代表値] Cycle 0件のOwnerをBootstrap → Active `Cycle 1` 1件とUpcoming `Cycle 2`〜`Cycle 4` 3件を返す。
- [境界値] `durationWeeks = 1` / `8` → 初期Activeの終了日時がそれぞれ設定期間どおりになる。
- [状態遷移] Cycle 0件 → Bootstrap再実行 → 同じ4件・同じ時刻を返し、件数を増やさない。
- [状態遷移] production空Snapshot → 初回成功GET → 4件をSnapshotへ保存 → 次回Sessionで4件を再読込する。
- [デシジョンテーブル] 既存Cycleなし / 既存Activeあり / 既存Upcomingあり → 初期Activeの追加有無と不足Upcoming補充結果が仕様どおりになる。
- [代表値] 既存CycleがあるOwnerのBootstrap → 既存CycleのID・番号・日時を変更しない。
