# CYC-11: service 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人がIssue詳細を開くと、既存の`GET /api/v1/issues/:issueId`は`cycleHistory`（新しい順）と`carryoverCount`を返す。`cycleHistory`の各項目は`id`、対象Issueの`issue`（`id` / `identifier` / `title`）、`fromCycle` / `toCycle`（`id` / `number` / 表示名`name`）、`movedAt`を持ち、`carryoverCount`は配列件数と一致する。履歴がない場合は空配列と0を返し、手動割当・CYC-10の自動割当は繰越として数えない。
- **AC-2**: 本人がCyclesを開くと、既存の`GET /api/v1/bootstrap`は本人の`cycleHistory`だけを返し、Cycle履歴の各Cycle行にそのCycleへ繰り越されたIssue数（`toCycle.id`単位）を表示する。Cycleを選択した詳細では、繰越Issueのidentifier / titleと`元Cycle`（`fromCycle.name`）を表示し、履歴がないCycleは件数0と空状態を表示する。
- **AC-3**: `cycleHistory`は既存のOwner単位Snapshotから投影し、production Store Sessionの再読込後も同じ内容を返す。未認証・認証設定不備・本番D1障害は既存の401 / 500契約を維持し、別OwnerのIssueまたは履歴は返さず、存在しないIssueは既存どおり404になる。履歴が参照するIssueまたはCycleを解決できない不正レコードは公開投影から除外し、内部IDや個人情報をエラー本文へ出さない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Issue詳細取得 | `GET /api/v1/issues/:issueId` | 既存responseへ`cycleHistory: CycleHistoryViewModel[]`、`carryoverCount: number`を追加。履歴は`movedAt DESC, id ASC` | 既存`withOwner`。本人のIssueのみ | Issue Detailの繰越回数・元Cycle表示 |
| Bootstrap取得 | `GET /api/v1/bootstrap` | 既存responseへ`cycleHistory: CycleHistoryViewModel[]`を追加。Ownerの有効な投影だけ | 既存`withOwner`。別Ownerを除外 | Cycles画面のincoming件数・Issue表示 |

`CycleHistoryViewModel`の各entryはshared specの型に従う。`fromCycle.name` / `toCycle.name`は`nameOverride ?? name`、`issue`は現在のOwner Issueの`id` / `identifier` / `title`を使う。

## このレイヤーが依存する下位の契約

- 呼び出す相手: `OrbitStoreSnapshot.cycleHistory`、`OrbitStore.cycles`、`OrbitStore.issues`、既存の`withOwner` / `openStoreSession`
- 受け渡し: `userId`を投影関数へ渡し、全レコードのOwner一致を確認する。DB binding、lock token、認証Cookieは投影結果へ渡さない。

## 実装配置

- `src/server/model.ts`: `IssueDetail` / `BootstrapPayload`がsharedの`CycleHistoryViewModel`を保持
- `src/server/store.ts`: Owner scopedな履歴投影（Issue単位・全件）、`getIssueDetail`と`bootstrap`への組み込み
- `src/server/api.ts`: 既存handlerと`issueDetailResponseSchema`を再利用し、新規routeは追加しない
- `src/server/store.test.ts` / `src/server/api.test.ts`: projection、Issue Detail / Bootstrap、Owner境界、0件、参照不整合
- `src/server/store-persistence.test.ts`: Snapshot round-trip後の履歴投影

投影の処理規則:

1. `cycleHistory`から`userId`が一致し、対象Issueまたは対象Cycleを解決できるrecordだけを選ぶ。
2. Issue Detailでは対象`issueId`に絞り、BootstrapではOwnerの全有効recordを対象にする。
3. Issue / Cycleの表示用summaryを組み立てる。Cycle名はoverrideを優先する。
4. `movedAt`降順、同値時は`id`昇順で並べる。
5. Issue Detailの`carryoverCount`は投影後配列のlengthから算出する。

既存の`closeCycle`、`startCycle`、Issue Mutation、Snapshot write、D1 Migrationは変更しない。`cycle_issue_history`正規化tableへ直接queryせず、現行production Snapshotを唯一のread sourceにする。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 未認証 / Access設定不備 | 既存`withOwner`の401 `AUTH_REQUIRED`または認証設定不備の500を返す。新しい認証経路を作らない |
| Issue不存在 / Owner外 | `getIssue`の既存404 `RESOURCE_NOT_FOUND`を返し、履歴を返さない |
| 履歴のIssue / Cycle参照先なし、Owner不一致 | 該当entryだけを公開投影から除外する。別Ownerのidentifier / title / Cycle名を返さない |
| D1 / Snapshot障害 | 既存の500 ErrorEnvelopeへ変換し、内部snapshot・email・Tokenをログへ書かない |
| 履歴0件 | 200で空配列を返し、Issue Detailはcount 0、BootstrapはCycle画面で0件として扱える |
| 既存履歴の重複 | 読出しは保存されたrecord単位で行う。今回のread-only機能は新たな履歴を作らない |

## テストケース（技法注記付き）

- [代表値] 1件の`cycleHistory`を持つIssue Detailが、Issue summary、元Cycle、移行先Cycle、時刻、count 1を返す。
- [状態遷移] C1→C2→C3の2件を同じIssueへ設定し、Issue Detailが新しい順・count 2で返す。
- [状態遷移] 同じIssueを手動でCycleへ追加したrecordなしの状態では、carryoverCountを増やさない。
- [代表値] BootstrapがOwnerのcycleHistoryを返し、Cycles画面が`toCycleId`ごとにincoming履歴を数えられる形を返す。
- [デシジョンテーブル] recordのuserId、Issue所有者、from/to Cycle所有者の各組み合わせで、全て本人 = 公開 / いずれか不一致または不存在 = entry除外を確認する。
- [境界値] 履歴0件、同じ`movedAt`の複数entry、nameOverrideあり / なしを確認する。
- [レイヤー内結合] `GET /api/v1/issues/:issueId`の正常系、Owner外 / 不存在404、`GET /api/v1/bootstrap`のOwner scoped responseを確認する。
- [レイヤー内結合] Snapshotを保存してproduction Sessionを再オープンし、同じ履歴投影が返ることを確認する。
