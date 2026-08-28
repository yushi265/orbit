# FIX-cycle-initial-bootstrap: 初回Cycleの自動初期化

## 概要

Cycleが1件もない本番Ownerに対して、Bootstrap時に利用可能な初回Active Cycleと後続Upcoming Cycleを作成する。
既存Cycleを持つOwnerの状態は変更せず、既存のD1 Snapshot保存経路で初回生成結果を永続化する。

## 対象範囲

- 対象レイヤー: service（詳細は [service.md](./service.md)）
- 対象ドメイン: cycles / production snapshot session
- 対象外（やらないこと）: Cycle作成API・UIの追加、CycleSettings編集、D1スキーマ／Migration変更、既存Cycleの再スケジュール、既存Cycleを持つOwnerへの新規Active Cycle追加

## ユニット計画

単一ユニット（初回Cycle自動初期化）。既存のOrbitStore BootstrapとD1 Snapshot Sessionを再利用する。

## 受け入れ基準（AC）

- [x] **AC-1**: Cycleが0件のOwnerをBootstrapすると、現在時刻開始・設定期間終了の`Cycle 1`（Active）を1件作成し、`futureCount`件のUpcoming Cycle（既定では`Cycle 2`〜`Cycle 4`）を連続して作成する。
- [x] **AC-2**: 初回生成済みOwnerがBootstrapまたはproduction Store Sessionを再実行しても、Cycle・番号・開始終了日時を重複または変更せず、既存Snapshotへ保存された4件（Active 1件＋Upcoming 3件）を返す。
- [x] **AC-3**: 既存Cycleが1件以上あるOwnerでは初回Active Cycleを追加せず、既存のUpcoming補充（不足時のみ`futureCount`件）と既存Cycleの内容を維持する。

## アーキテクチャ / レイヤー間フロー

```text
production GET /api/v1/bootstrap
  → withOwner
  → openStoreSession (D1 Snapshot load)
  → ensureOwner
  → ensureUpcomingCycles
      ├─ cycles 0件: Active Cycle 1を現在時刻から生成
      └─ Upcoming不足: 既存の設定期間で後続Cycleを生成
  → bootstrap payload
  → 成功GETだけD1 SnapshotへVersion CAS保存
```

初回Cycleの生成は`CycleSettings.durationWeeks`を使い、`startsAt = clock()`、`endsAt = startsAt + durationWeeks * 7 * DAY`とする。後続Upcomingは既存の`createNextCycle`で連続生成する。

## エラー・ログ方針（横断サマリ）

| シナリオ | service | 表示層の挙動 |
|---|---|---|
| D1 Snapshot読み込み失敗 | 既存の`INTERNAL_ERROR`／既存の失敗処理を維持 | 既存の接続エラー表示 |
| D1 Version CAS競合 | 既存の`D1_WRITE_CONFLICT`（409）を維持 | 既存の再取得／再試行導線 |
| Cycle 0件の初回Bootstrap | エラーなし。Owner scopedに初期Cycleを生成し、成功GETで保存 | CurrentとUpcomingを表示 |

初回自動生成自体にActivity / Outbox / Receiptは追加しない。既存のCycle自動補充と同じBootstrap副作用として扱う。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | 初期Cycleの時刻・番号・状態・期間 | — |
| AC-2 | 2回目Bootstrapの冪等性 | production Snapshot初回GET保存と再読込 |
| AC-3 | 既存Active / Upcomingの維持 | 既存Snapshotへの補充保存 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- `OrbitStore.ensureUpcomingCycles`、`createNextCycle`、`bootstrap`を再利用し、Cycle専用の新APIやスキーマを追加しない。
- `openStoreSession`のproduction初回GET保存をそのまま利用するため、既存の空Snapshotも次回の成功Bootstrapでバックフィルされる。
- 開発環境の`dev-owner`デモSeedとは分離し、本番でも通常Ownerが同じ初期状態へ到達できるようにする。
- 既存のActive / Upcomingが存在するケースは現行の補充ロジックを維持し、Cycle自動遷移・Issue繰越の仕様を変更しない。

## 実装に効く制約

- OwnerのCycleだけを参照・作成し、他Ownerのデータへ触れない。
- `futureCount`が0以下の場合は既存どおり何も作成しない。
- 生成日時はテスト可能な`OrbitStore`の`clock`を使い、`Date.now()`を直接使わない。
- Production D1への書き込みは成功したRequest Sessionの既存Version CASに限定する。
- 既存Cycleがある場合は初期Cycle生成を行わない。

## 判断根拠 / 未決事項

- 初回Cycleは既存の開発用デモと同じくActiveとして現在時刻から開始する。これにより本番初回ログイン直後からCurrent / Upcomingの両方を利用できる。
- 既存の`ensureUpcomingCycles`が「前のCycleなし」を正常に扱わず終了していたため、初期Cycle生成を同じメソッド内に置く。別の手動作成APIを追加するより変更範囲と認証面を増やさない。
- 空Snapshotのバックフィルは、既存のproduction Sessionが成功GET後にSnapshotを保存する契約を利用する。手動SQLで全データを直接書き換えず、Owner単位の既存CASを維持する。
- 未決事項なし。Gate 1で初期状態の仕様を承認済み、Gate 2で本specの要点を承認済みとして進める。
