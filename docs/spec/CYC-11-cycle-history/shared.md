# CYC-11: shared 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人がIssue詳細を開くと、既存の`GET /api/v1/issues/:issueId`は`cycleHistory`（新しい順）と`carryoverCount`を返す。`cycleHistory`の各項目は`id`、対象Issueの`issue`（`id` / `identifier` / `title`）、`fromCycle` / `toCycle`（`id` / `number` / 表示名`name`）、`movedAt`を持ち、`carryoverCount`は配列件数と一致する。履歴がない場合は空配列と0を返し、手動割当・CYC-10の自動割当は繰越として数えない。
- **AC-2**: 本人がCyclesを開くと、既存の`GET /api/v1/bootstrap`は本人の`cycleHistory`だけを返し、Cycle履歴の各Cycle行にそのCycleへ繰り越されたIssue数（`toCycle.id`単位）を表示する。Cycleを選択した詳細では、繰越Issueのidentifier / titleと`元Cycle`（`fromCycle.name`）を表示し、履歴がないCycleは件数0と空状態を表示する。
- **AC-3**: `cycleHistory`は既存のOwner単位Snapshotから投影し、production Store Sessionの再読込後も同じ内容を返す。未認証・認証設定不備・本番D1障害は既存の401 / 500契約を維持し、別OwnerのIssueまたは履歴は返さず、存在しないIssueは既存どおり404になる。履歴が参照するIssueまたはCycleを解決できない不正レコードは公開投影から除外し、内部IDや個人情報をエラー本文へ出さない。

## このレイヤーが公開する契約（外部インターフェース）

```typescript
export interface CycleHistoryIssueViewModel {
  id: string;
  identifier: string;
  title: string;
}

export interface CycleHistoryCycleViewModel {
  id: string;
  number: number;
  name: string; // nameOverride ?? name
}

export interface CycleHistoryViewModel {
  id: string;
  issue: CycleHistoryIssueViewModel;
  fromCycle: CycleHistoryCycleViewModel;
  toCycle: CycleHistoryCycleViewModel;
  movedAt: number; // Unix milliseconds
}
```

既存の公開型を次のように拡張する。

```typescript
interface IssueDetailViewModel {
  // existing fields...
  cycleHistory: CycleHistoryViewModel[];
  carryoverCount: number;
}

interface BootstrapViewModel {
  // existing fields...
  cycleHistory: CycleHistoryViewModel[];
}
```

`src/shared/contracts/issue-detail.ts`には`cycleHistoryEntrySchema`を追加し、`issueDetailResponseSchema`をstrictに拡張する。`id` / `identifier` / `title` / Cycle summary fieldsは1文字以上のstring、`number`は整数、`movedAt`は0以上の整数とする。追加の書き込み入力やidempotency契約は作らない。

## このレイヤーが依存する下位の契約

- 呼び出す相手: serviceが返す既存Issue Detail / BootstrapのJSON
- 受け渡し: 認証・Owner境界は既存のAPI経路へ委譲し、shared層は内部TokenやCookieを受け取らない。

## 実装配置

- `src/shared/view-models.ts`: `CycleHistoryIssueViewModel`、`CycleHistoryCycleViewModel`、`CycleHistoryViewModel`、Issue Detail / Bootstrap型の拡張
- `src/shared/contracts/issue-detail.ts`: 履歴公開schemaとIssue Detail response schemaの拡張
- `src/shared/contracts.test.ts` または `src/shared/issue-detail.test.ts`: 有効値、空配列、strict schemaの契約テスト

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 履歴0件 | `cycleHistory: []` と `carryoverCount: 0` を受理する |
| unknown key / 型不正 | strict schemaで受理せず、serviceの既存ErrorEnvelope変換へ委譲する |
| 参照先不整合 | serviceが公開投影前に除外する。shared schemaへnullや内部IDの代替値を追加しない |
| private field混入 | 既存公開Activity schemaと同じ公開境界を維持し、Token / Cookie / email等をschemaへ追加しない |

## テストケース（技法注記付き）

- [代表値] `issue`、`fromCycle`、`toCycle`、`movedAt`を含む1件の履歴をschemaが受理する。
- [状態遷移] Issue Detailの履歴0件を空配列・count 0として受理し、1件以上ではcountフィールドを要求する。
- [境界値] `number` / `movedAt`の整数・0を受理し、小数・負数・空文字を拒否する。
- [同値分割] `fromCycle` / `toCycle` / `issue`の必須文字列を受理し、欠落・null・配列を拒否する。
- [異常系] entryのunknown key、Issue Detailのunknown key、private fieldを含む値をstrict schemaが拒否する。
