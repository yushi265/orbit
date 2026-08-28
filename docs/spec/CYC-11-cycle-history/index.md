# CYC-11: IssueのCycle繰越履歴表示

## 概要

既存の `cycleHistory` に保存されている繰越記録を、Issue詳細とCycles画面のCycle履歴で確認できるようにする。
Issueごとの繰越回数・各回の元Cycleと移行先Cycle、およびCycleごとの繰越Issue数と元Cycleを、Owner scopedなread-only情報として表示する。

## 対象範囲

- 対象レイヤー: shared / service / ui
  - [shared.md](./shared.md)
  - [service.md](./service.md)
  - [ui.md](./ui.md)
- 対象ドメイン: cycles / issues / owner-scoped snapshot read model
- 対象外（やらないこと）:
  - 繰越履歴を新たに記録するMutation、Cycle終了・繰越ロジックの変更
  - 手動Cycle割当やCYC-10の自動追加を繰越履歴へ変換すること
  - 新規API endpoint、履歴の編集・削除・並べ替え操作
  - 新規D1 table / Migration、正規化Repositoryからの履歴読出しへの移行
  - Cycleの日別グラフ、Scope change分析、無限スクロールやページング

## ユニット計画

単一ユニット（既存Snapshot履歴の公開投影と2画面への表示）。shared契約、既存Issue Detail / Bootstrap、Cycles / Issue Detail UIを1本のread-only縦切りで接続する。

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Cycle繰越履歴の公開投影と表示 | AC-1〜4 | 既存`cycleHistory` / Cycle・Issueモデル | 未着手 |

## 受け入れ基準（AC）

- [x] **AC-1**: 本人がIssue詳細を開くと、既存の`GET /api/v1/issues/:issueId`は`cycleHistory`（新しい順）と`carryoverCount`を返す。`cycleHistory`の各項目は`id`、対象Issueの`issue`（`id` / `identifier` / `title`）、`fromCycle` / `toCycle`（`id` / `number` / 表示名`name`）、`movedAt`を持ち、`carryoverCount`は配列件数と一致する。履歴がない場合は空配列と0を返し、手動割当・CYC-10の自動割当は繰越として数えない。
- [x] **AC-2**: 本人がCyclesを開くと、既存の`GET /api/v1/bootstrap`は本人の`cycleHistory`だけを返し、Cycle履歴の各Cycle行にそのCycleへ繰り越されたIssue数（`toCycle.id`単位）を表示する。Cycleを選択した詳細では、繰越Issueのidentifier / titleと`元Cycle`（`fromCycle.name`）を表示し、履歴がないCycleは件数0と空状態を表示する。
- [x] **AC-3**: `cycleHistory`は既存のOwner単位Snapshotから投影し、production Store Sessionの再読込後も同じ内容を返す。未認証・認証設定不備・本番D1障害は既存の401 / 500契約を維持し、別OwnerのIssueまたは履歴は返さず、存在しないIssueは既存どおり404になる。履歴が参照するIssueまたはCycleを解決できない不正レコードは公開投影から除外し、内部IDや個人情報をエラー本文へ出さない。
- [x] **AC-4**: Issue詳細の繰越表示とCycles画面のCycle履歴表示は、既存のDesktop / Tablet / 390px Mobileレイアウトで横overflowを発生させず、初期・読込中・空・エラー・成功の状態を既存導線で示し、既存のCycle選択とIssue詳細表示を壊さない。表示はread-onlyで、既存のキーボード / Pointer操作とアクセシビリティ方針に従う。

## アーキテクチャ / レイヤー間フロー

```text
Owner-scoped Store Snapshot
  └─ existing cycleHistory[{ issueId, fromCycleId, toCycleId, movedAt }]
       └─ service projection (resolve current Issue / Cycle display summaries)
            ├─ GET /api/v1/issues/:issueId
            │    └─ Issue Detail: cycleHistory + carryoverCount
            └─ GET /api/v1/bootstrap
                 └─ Cycles UI: incoming count + carried Issue / fromCycle
```

履歴投影はOwner境界の内側で行う。新規MigrationやD1の正規化履歴テーブルへの直接アクセスは行わず、productionの現行Snapshot Adapterを再利用する。

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service | 表示層の挙動 |
|---|---|---|---|
| 未認証 / 認証設定不備 | 公開schemaを適用しない | 既存の401 `AUTH_REQUIRED` / 500契約 | 既存の再認証または読み込みエラー導線 |
| Issue不存在 / Owner外 | — | 既存の404 `RESOURCE_NOT_FOUND` | Issue詳細のNot found表示 |
| Snapshot履歴の参照先不整合 | strict responseに不正値を通さない | 該当履歴だけ公開投影から除外し、個人情報をログ・本文へ出さない | 有効な履歴だけ表示。不正履歴の詳細は表示しない |
| Snapshot / D1障害 | responseを生成しない | 既存の500 ErrorEnvelope、requestIdのみログ | 既存のRetry導線 |
| 履歴0件 | 空配列・`carryoverCount: 0` | 200の正常系 | 件数0と説明的な空状態 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | 履歴projectionのソート・表示名・count mapper、strict response schema | Issue Detail APIの正常系、0件、Issue不存在 / Owner境界 |
| AC-2 | Cycleごとのincoming集計 | BootstrapのOwner scoped履歴と既存Cycle一覧の結合 |
| AC-3 | 不正参照の除外判定 | Snapshot round-trip / production Sessionの再読込、認証・障害境界 |
| AC-4 | UIの表示状態・空状態・レスポンシブDOM | Issue Detail / Cycles componentの既存導線との結合 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用するもの: `OrbitStoreSnapshot.cycleHistory`、`closeCycle`が作成する`fromCycleId` / `toCycleId` / `movedAt`、既存の`getIssueDetail`、`bootstrap`、`CycleViewModel`、`IssueDetailViewModel`、`CyclesView`、`IssueDetailPanel`。
- 差分: `CycleHistoryViewModel`をsharedへ追加し、既存のIssue Detail responseへ`cycleHistory` / `carryoverCount`、BootstrapへOwner scopedな`cycleHistory`を追加する。Cycles UIは既存のCycle行・選択詳細へ表示情報を足す。
- 衝突回避: `Activity`を繰越履歴の正本にせず、手動割当・自動追加Activityと混同しない。既存のCycle close / start / auto-add MutationとVersion、Lock、Receipt、Outboxは変更しない。
- productionの現行永続化はSnapshot Adapterであり、正規化`cycle_issue_history` tableは今回の公開読出し経路に接続しない。これにより新規Migrationと二重の履歴正本を避ける。

## 実装に効く制約

- 繰越履歴1件は、既存Snapshotの`cycleHistory`レコード1件に対応する。手動割当・CYC-10自動追加は含めない。
- Issue Detailの`carryoverCount`は公開投影後の`cycleHistory.length`と一致させる。
- 公開Cycle名は`nameOverride ?? name`を使い、内部のmutation key・lock token・Cookie・email・D1 bindingを返さない。
- 履歴は`movedAt`降順、同時刻は`id`昇順で安定ソートする。Cycle画面のincoming件数は`toCycle.id`で集計する。
- 既存のOwner scoped `withOwner`境界とSnapshotのOwner検証を変更しない。
- 表示はread-onlyとし、新しいDatePicker、Modal、外部UIライブラリ、履歴編集操作を追加しない。

## 判断根拠 / 未決事項

- 既存Snapshotに繰越のfrom / to / 時刻が揃っているため、履歴専用endpointや新規D1 Migrationを追加せず、既存GETの公開投影へ集約する。APIを増やさず、Issue DetailとCycles画面で同一データを使える。
- Issue Detailには各履歴の`fromCycle` / `toCycle`を返し、Cycle画面には`toCycle`単位のincoming件数とIssueごとの`fromCycle`を返す。これにより「繰越回数」「元Cycle」「Cycle履歴」の3つを同じ記録から観測できる。
- 欠損参照は全レスポンスを失敗させず該当項目だけ除外する。既存Snapshotの他データを表示できる可用性を保ちつつ、解決できない内部IDをUIやエラーへ露出しないためである。
- 390pxでは既存の縦積み・wrap方針へ合わせ、履歴行を固定幅にしない。表示のみのため、既存のCycle mutation状態やIssue refresh経路を再利用する。
- 未決事項なし。Gate 1で確認した表示範囲（Cycle行の繰越件数、選択Cycle内の繰越Issueと元Cycle）を本契約として実装し、Gate 3提示へ進む。
