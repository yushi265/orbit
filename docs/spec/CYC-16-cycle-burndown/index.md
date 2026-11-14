# CYC-16: Cycleの日別バーンダウン（Completed / Remaining / Scope change）

## 概要

Cycle詳細に、日ごとの Completed / Remaining / Scope change をグラフと表で表示する。
過去の履歴は現状のActivityから正確に再現できないため、本機能のリリース以降にOwner単位Snapshotへ「Cycleの日別進捗」を記録し、記録開始より前の日は「記録なし」と明示する（推測で埋めない）。

## 対象範囲

- 対象レイヤー: shared / service / ui
  - [shared.md](./shared.md)
  - [service.md](./service.md)
  - [ui.md](./ui.md)
- 対象ドメイン: cycles / issues / owner-scoped snapshot read model
- 対象外（やらないこと）:
  - 本機能リリース前の期間の遡及再構成（Activityからの推定を含む）
  - 新規D1 table / Migration、正規化Repositoryへの書込み
  - 新規API endpoint（既存 `GET /api/v1/bootstrap` に載せる）
  - Estimate（ポイント）ベースのバーンダウン、Project別・Label別の分解、CSV出力
  - 記録データの編集・削除UI

## ユニット計画

単一ユニット（進捗の記録 → 公開投影 → Cycle詳細の表示を縦に貫く）。

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Cycle日別進捗の記録と表示 | AC-1〜5 | 既存Cycle / Issue / Workflow / Preferences.timezone | 未着手 |

## 受け入れ基準（AC）

- [ ] **AC-1**: Issueの作成・更新・一括更新・Archive / Trash / 復元、Cycleの開始・完了・繰越・自動追加など、本人のIssueまたはCycleを変えるリクエストの後、Active Cycleごとに「その日（Owner timezoneの日付）の終わり時点の値」として scope（Cycle所属かつ未Archive・未Trashの件数）、completed（そのうちWorkflow categoryがcompleted）、canceled（同canceled）、added / removed（その日に所属へ入った / 出たIssue件数）を記録する。値が直前の記録と同じなら新しい記録を書かない。Cycleを完了したリクエストでは、完了直前の状態を完了日の値として確定し、以後そのCycleには記録しない。
- [ ] **AC-2**: 既存の `GET /api/v1/bootstrap` は本人の `cycleProgress` を返す。各要素は `cycleId`・`trackedFrom`（記録開始日 `YYYY-MM-DD`）・`days` を持ち、`days` はCycle開始日から「今日とCycle終了日の早い方」（完了Cycleは完了日）までの全日を昇順で1件ずつ持つ。各日は `date`・`tracked`・`scope`・`completed`・`canceled`・`remaining`（= scope − completed − canceled）・`added`・`removed` を持ち、記録のない日は直前の記録日の値を引き継ぎ（added / removedは0）、`trackedFrom` より前の日は `tracked: false` で数値をすべて `null` にする。Upcoming Cycleと記録が1件もないCycleは要素を返さない。
- [ ] **AC-3**: 本機能リリース時点で既にActiveなCycleは、最初の記録時点の所属・状態を基準にし、それより前の日を `tracked: false` とする。リリース後に開始したCycleは開始時点の所属を基準（その日の added に開始時の所属を数えない）として、開始日から `tracked: true` になる。
- [ ] **AC-4**: `cycleProgress` はOwner単位Snapshotに保存し、production Store Sessionの再読込後も同じ内容を返す。旧Snapshot（`cycleProgress` なし）は空配列として読み込める。別Ownerの進捗は返さず、未認証・認証設定不備・本番D1障害は既存の401 / 500契約を維持する。参照先CycleがSnapshotにない記録は公開投影から除外する。
- [ ] **AC-5**: Cycles画面のCycle詳細に「バーンダウン」セクションを追加し、日別のRemaining（折れ線）と理想線（開始時scopeから終了日に0へ向かう直線）、Scope change（その日の +added / −removed）を表示する。グラフと同じ値を日別の表（日付・Completed・Remaining・Scope change）でも確認できる。`tracked: false` の日はグラフ上で値を描かず「記録なし」と表示し、進捗が1件もないCycleは「このCycleの日別記録はまだありません」の空状態を表示する。Desktop / Tablet / 390px Mobileで横overflowを発生させず、ライト / ダークテーマで読める。

## アーキテクチャ / レイヤー間フロー

```text
Mutation request (Issue / Cycle / Maintenance Run)
  └─ OrbitStore mutation
       └─ OrbitStore.recordCycleProgress(userId)   ← 変化がある時だけ Snapshot.cycleProgress を更新
            └─ Store Session save (既存のSnapshot保存。変化がなければ書かない)

GET /api/v1/bootstrap
  └─ OrbitStore.bootstrap(userId)
       └─ listCycleProgress(userId): 記録 → 日別に展開（carry forward / tracked:false）
            └─ Cycles UI: Cycle詳細「バーンダウン」(SVG + 表)
```

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service | 表示層の挙動 |
|---|---|---|---|
| 未認証 / 認証設定不備 | 公開schemaを適用しない | 既存の401 `AUTH_REQUIRED` / 500契約 | 既存の再認証・読み込みエラー導線 |
| Snapshot / D1障害 | responseを生成しない | 既存の500 ErrorEnvelope | 既存のRetry導線 |
| 旧Snapshot（`cycleProgress` なし） | — | 空配列として復元 | 空状態 |
| 記録の参照先Cycle欠落 | strict schemaに不正値を通さない | 公開投影から除外 | 該当Cycleは空状態 |
| 記録0件 / Upcoming Cycle | 空配列 | 200の正常系 | 空状態の文言 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | 日付キー算出（timezone / 日付境界）、差分判定、added / removed 算出 | Issue作成・更新・一括・Archive・Cycle開始 / 完了 / 繰越後のSnapshot記録 |
| AC-2 | 日別展開（carry forward / 期間端 / 完了Cycle） | Bootstrap responseの `cycleProgress` |
| AC-3 | 基準（baseline）判定 | リリース時Active / リリース後開始の2経路 |
| AC-4 | Snapshot encode / decode互換、strict schema | production Store Session再読込、Owner境界、401 / 500 |
| AC-5 | グラフ座標・理想線・表の値変換 | Cycles画面の表示状態（記録あり / 一部記録なし / 空）・390px |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `OrbitStoreSnapshot`、Store Sessionの「変化時だけ保存」、`Preferences.timezone`、`cycle-schedule.ts` のtimezone日付処理、Workflow category（completed / canceled）判定、既存Cycle詳細のmetrics・breakdown表示。
- 差分: Snapshotに `cycleProgress` を追加、`BootstrapViewModel` に `cycleProgress` を追加、Cycle詳細にバーンダウンセクションを追加。
- 衝突回避: Activity / Outbox / Receipt / cycleHistory の形式は変えない。記録は既存Mutationの結果を読むだけで、Issue / CycleのVersionやLockに影響させない。

## 実装に効く制約

- 日付はOwnerの `preferences.timezone`（未設定時UTC）で `YYYY-MM-DD` に丸める。
- 記録は「その日の最終値」を上書きする（1 Cycle × 1日 = 最大1点）。Snapshot増加は Active Cycle数 × 日数 に比例し、1点あたりの所属Issue IDは最新点にだけ保持する。
- GETリクエストでは記録しない（読み取りでSnapshotを書かない）。

## 判断根拠 / 未決事項

- **採用: 日別スナップショットを前向きに記録する**。既存Activityは `created` にcycleId / statusIdを持たず、`updated` のbeforeにもcycleIdがないため、所属の出入りを正確に再現できない。Activityの記録内容を増やして再生する案は、全Mutationの記録形式に触れて影響が広く、リリース前の期間はどちらにしても再現できないため却下。
- **採用: 既存 bootstrap に載せる**。CYC-11の `cycleHistory` と同じ経路で、Cycle数・日数とも小さい（1 Cycle最大8週 = 56点）。専用endpointは今は不要（YAGNI）。
- **採用: 依存ライブラリを増やさずSVGで描く**。グラフは1種類だけで、チャートライブラリ追加のバンドル増に見合わない。
- **採用: 記録のない日は直前値を引き継ぐ**。値の変化はすべてMutation経由なので、Mutationのない日は値が変わっていない。
- トレードオフ: Mutationを伴わない時間経過（Cycle終了日の到来のみ等）では新しい点は書かれないが、展開時の引き継ぎで日別表示は欠けない。
- 未決事項: なし
