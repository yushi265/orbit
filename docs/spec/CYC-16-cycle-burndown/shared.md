# CYC-16: shared 詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-2**: 既存の `GET /api/v1/bootstrap` は本人の `cycleProgress` を返す。各要素は `cycleId`・`trackedFrom`（記録開始日 `YYYY-MM-DD`）・`days` を持ち、`days` はCycle開始日から「今日とCycle終了日の早い方」（完了Cycleは完了日）までの全日を昇順で1件ずつ持つ。各日は `date`・`tracked`・`scope`・`completed`・`canceled`・`remaining`（= scope − completed − canceled）・`added`・`removed` を持ち、記録のない日は直前の記録日の値を引き継ぎ（added / removedは0）、`trackedFrom` より前の日は `tracked: false` で数値をすべて `null` にする。Upcoming Cycleと記録が1件もないCycleは要素を返さない。
- **AC-4**: `cycleProgress` はOwner単位Snapshotに保存し、production Store Sessionの再読込後も同じ内容を返す。旧Snapshot（`cycleProgress` なし）は空配列として読み込める。別Ownerの進捗は返さず、未認証・認証設定不備・本番D1障害は既存の401 / 500契約を維持する。参照先CycleがSnapshotにない記録は公開投影から除外する。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 追加 | `CycleProgressViewModel`（`src/shared/view-models.ts`） | 下記 | — | Bootstrapの公開型 |
| 追加 | `cycleProgressSchema`（`src/shared/contracts`、strict Zod） | 下記の検証 | — | response検証・テスト |
| 変更 | `BootstrapViewModel.cycleProgress` | `CycleProgressViewModel[]`（必須、空配列可） | 既存Bootstrapと同じ本人限定 | Cycles UI |

```ts
export interface CycleProgressDayViewModel {
  date: string;            // "YYYY-MM-DD"（Owner timezone）
  tracked: boolean;        // false のとき数値はすべて null
  scope: number | null;    // 0以上の整数
  completed: number | null;
  canceled: number | null;
  remaining: number | null; // scope - completed - canceled
  added: number | null;
  removed: number | null;
}
export interface CycleProgressViewModel {
  cycleId: string;
  trackedFrom: string;     // "YYYY-MM-DD"
  days: CycleProgressDayViewModel[]; // 開始日〜表示終端日の全日、昇順、1件以上
}
```

制約: `date` / `trackedFrom` は `^\d{4}-\d{2}-\d{2}$`。`tracked: true` の日は全数値が0以上の整数で `remaining === scope - completed - canceled`。`tracked: false` の日は全数値が `null`。未知キーは拒否（strict）。

## 実装配置

- `src/shared/view-models.ts`（型）
- `src/shared/contracts/`（Zod schema。既存の `cycleHistoryEntrySchema` と同じ置き場所）

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| 不正値（負数・小数・日付形式違反・tracked:falseなのに数値あり・remaining不一致） | schemaで拒否 |

## テストケース（技法注記付き）

- [同値分割] tracked:true の正常日 → 成功 / tracked:false で数値null → 成功
- [境界値] scope 0 → 成功 / -1 → 失敗 / 1.5 → 失敗
- [デシジョンテーブル] tracked × 数値有無: true×数値=成功 / true×null=失敗 / false×null=成功 / false×数値=失敗
- [代表値] remaining が scope-completed-canceled と不一致 → 失敗
- [境界値] date "2026-11-14" → 成功 / "2026-11-4" → 失敗
- [代表値] 未知キーあり → 失敗
