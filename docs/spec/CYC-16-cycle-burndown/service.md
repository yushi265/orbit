# CYC-16: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: Issueの作成・更新・一括更新・Archive / Trash / 復元、Cycleの開始・完了・繰越・自動追加など、本人のIssueまたはCycleを変えるリクエストの後、Active Cycleごとに「その日（Owner timezoneの日付）の終わり時点の値」として scope（Cycle所属かつ未Archive・未Trashの件数）、completed（そのうちWorkflow categoryがcompleted）、canceled（同canceled）、added / removed（その日に所属へ入った / 出たIssue件数）を記録する。値が直前の記録と同じなら新しい記録を書かない。Cycleを完了したリクエストでは、完了直前の状態を完了日の値として確定し、以後そのCycleには記録しない。
- **AC-2**: 既存の `GET /api/v1/bootstrap` は本人の `cycleProgress` を返す。各要素は `cycleId`・`trackedFrom`（記録開始日 `YYYY-MM-DD`）・`days` を持ち、`days` はCycle開始日から「今日とCycle終了日の早い方」（完了Cycleは完了日）までの全日を昇順で1件ずつ持つ。各日は `date`・`tracked`・`scope`・`completed`・`canceled`・`remaining`（= scope − completed − canceled）・`added`・`removed` を持ち、記録のない日は直前の記録日の値を引き継ぎ（added / removedは0）、`trackedFrom` より前の日は `tracked: false` で数値をすべて `null` にする。Upcoming Cycleと記録が1件もないCycleは要素を返さない。
- **AC-3**: 本機能リリース時点で既にActiveなCycleは、最初の記録時点の所属・状態を基準にし、それより前の日を `tracked: false` とする。リリース後に開始したCycleは開始時点の所属を基準（その日の added に開始時の所属を数えない）として、開始日から `tracked: true` になる。
- **AC-4**: `cycleProgress` はOwner単位Snapshotに保存し、production Store Sessionの再読込後も同じ内容を返す。旧Snapshot（`cycleProgress` なし）は空配列として読み込める。別Ownerの進捗は返さず、未認証・認証設定不備・本番D1障害は既存の401 / 500契約を維持する。参照先CycleがSnapshotにない記録は公開投影から除外する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 変更 | `GET /api/v1/bootstrap` | responseに `cycleProgress: CycleProgressViewModel[]` を追加（[shared.md](./shared.md)） | 既存どおり本人限定 | Cycles UI |
| 追加 | `OrbitStoreSnapshot.cycleProgress` | 下記の保存形式 | Owner単位Snapshot | 永続化 |

保存形式（Snapshot内部。公開しない）:

```ts
cycleProgress: Array<{
  userId: string;
  cycleId: string;
  trackedFrom: string;        // 最初の記録日 "YYYY-MM-DD"（理想線の始点は trackedFrom 日の scope）
  lastIssueIds: string[];     // 最新記録時点の所属Issue ID（added / removed の差分計算用）
  points: Array<{ date: string; scope: number; completed: number; canceled: number; added: number; removed: number }>;
  closed: boolean;            // Cycle完了で確定したら true。以後記録しない
}>
```

## 実装配置

- `src/server/store.ts`: `cycleProgress` の保持・Snapshot入出力、`recordCycleProgress(userId)`、`listCycleProgress(userId)`（時刻は既存の `clock`）、`bootstrap` への追加
- `src/server/cycle-progress.ts`（新規・純関数）: 日付キー算出、点の更新、日別展開
- `src/server/store.ts` の `fromSnapshot`: 旧Snapshotで `cycleProgress` 欠落時に `[]`（既存の欠落キー補完と同じ場所）
- `src/server/http.ts` の `withOwner`（Mutationの共通出口）: Mutation成功後・保存前に `recordCycleProgress` を呼ぶ（GETでは呼ばない）
- `src/server/model.ts`: `BootstrapPayload.cycleProgress`

## 記録ルール（AC-1 / AC-3）

1. 対象: 本人の `status === "active"` のCycle。Cycle完了時は完了処理の中で直前の状態を観測する（記録がまだ無いCycleは、完了日を `trackedFrom` とする1点だけの記録を `closed: true` で作る）。
2. 所属 = `issue.cycleId === cycle.id` かつ未Archive・未Trash。completed / canceled はIssueのWorkflow stateのcategoryで判定。
3. 日付 `d` = `now` をOwner timezoneで丸めた日付。
4. 記録が無い場合: `trackedFrom = d`、`lastIssueIds = 所属`、`points = [{date:d, ..., added:0, removed:0}]`（基準時点の所属はaddedに数えない）。
5. 記録がある場合: `added = |所属 − lastIssueIds|`、`removed = |lastIssueIds − 所属|`。最終点の `date === d` なら、最終点の値を更新し added / removed は加算する。`date < d` なら新しい点を追加する。scope / completed / canceled / added / removed がすべて最終点と同じ（同日・差分0）なら何も書かない。
6. Cycle完了: 完了処理の直前の所属で上記5を行い `closed = true`。完了後のIssue繰越で所属が変わっても完了済みCycleの記録は変えない。

## 日別展開（AC-2）

- 表示終端日 = 完了Cycleは `completedAt` の日付、それ以外は `min(今日, endsAt の日付)`。
- 開始日 = `startsAt` の日付。開始日〜終端日の各日について: `date < trackedFrom` → `tracked:false`、数値null。それ以外 → その日以前で最新の点の scope / completed / canceled（その日に点がなければadded / removed は0）。
- Upcoming Cycle、記録なしCycle、参照先Cycleが無い記録は返さない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| 未認証 / 認証設定不備 | 既存の401 / 500（変更なし） |
| D1 / Snapshot障害 | 既存の500 ErrorEnvelope |
| 旧Snapshot | `cycleProgress: []` として復元 |
| 参照先Cycle欠落・別Ownerの記録 | 公開投影から除外 |
| timezone未設定・不正 | UTCで丸める |

## テストケース（技法注記付き）

- [境界値] Asia/Tokyoで 14:59:59Z と 15:00:00Z → 別の日付キー
- [状態遷移] 記録なし → 初回記録（baseline）→ 同日更新 → 翌日追加 → 完了で closed → 以後記録しない
- [デシジョンテーブル] 同日/翌日 × 値変化あり/なし: 同日×なし=書かない / 同日×あり=上書き / 翌日×なし=書かない / 翌日×あり=追加
- [代表値] Issueを所属に追加 → added 1、外す → removed 1、同日に追加して外す → added 1・removed 1
- [代表値] Archive / Trash → scopeから外れる（removed）、復元 → 戻る（added）
- [代表値] Issue更新でDoneへ → completed +1、Canceledへ → canceled +1
- [代表値] Cycle開始（Maintenance Run / 手動開始）直後の初回記録はbaseline、added 0
- [代表値] Cycle完了 → 完了前の所属で確定し、繰越先Cycleには新しいbaselineができる
- [境界値] 日別展開: 開始日=今日 → 1日、終了日超過 → endsAtの日まで、完了Cycle → completedAtの日まで
- [代表値] trackedFrom より前の日は tracked:false・数値null
- [代表値] GET /bootstrap だけではSnapshotを書かない
- [代表値] Snapshot round-trip（production Store Session再読込）で同じ `cycleProgress`、旧Snapshotは `[]`
- [代表値] 別Ownerの記録は返さない、401 / 500 は既存どおり
