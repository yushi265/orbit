# CYC-14: sharedレイヤー詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-2**: 本人がCycle詳細のListでIssueをドラッグまたはキーボードの上下操作で並び替えると、`POST /api/v1/issues/reorder`へ`cycleId`付きの要求を送り、同一Cycle内の順序を保存する。Boardでは同一Status列内のドラッグまたは上下操作で同じ契約を使い、Status変更は発生させない。成功後のList / BoardとBootstrap再取得は同じ順序を返す。
- **AC-3**: Cycleスコープの並び替えは、対象Issue・移動先が同一Ownerかつ同一Cycle（Boardは同一Status）であること、対象Issueの`version`、既存のidempotency、Runtime lockを検証する。不正参照は404、version競合は409、lock中は423とし、失敗時にIssueのposition / version / cycleId、Activity、Outbox、Receiptを部分更新しない。成功時もCycle外Issueの相対順序とIssueのCycle / Status所属を変えない。

## このレイヤーが公開する契約（外部インターフェース）

既存の`reorderIssueInputSchema`を後方互換で拡張する。

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Cycleスコープ並び替え | `reorderIssueInputSchema` / `POST /api/v1/issues/reorder` | `idempotencyKey: string`、`issueId: string`、`version: int >= 0`、`beforeIssueId: string \| null`、`cycleId?: string`、`statusId?: string`。全体並び替えは`cycleId`省略。Boardは`cycleId`と`statusId`を両方指定 | serviceのOwner境界・Runtime lock | List / Boardの順序保存 |

```ts
{
  idempotencyKey: string;
  issueId: string;
  version: number;
  beforeIssueId: string | null;
  cycleId?: string;
  statusId?: string;
}
```

- `cycleId`なし: 既存の全Active Issue向け契約を維持する。
- `cycleId`あり・`statusId`なし: 対象Cycleの全Active Issueをスコープにする。
- `cycleId`あり・`statusId`あり: 対象Cycleかつ指定StatusのActive Issueをスコープにする。
- `statusId`だけの指定、空文字、未知の追加フィールドはstrict schemaで拒否する。
- `beforeIssueId: null`は指定スコープの末尾を表す。

レスポンスschemaは既存の`{ issue: Issue }`を維持する。複数Issueのpositionが変わっても返却するのは対象Issueであり、再取得は既存Bootstrapを使う。

## 実装配置

- `src/shared/contracts/issues.ts`: `reorderIssueInputSchema`へ`cycleId` / `statusId`のoptional fieldを追加。
- `src/shared/contracts/contracts.test.ts`または`src/shared/contracts/issues.test.ts`: scope組合せ、strict、境界値の契約テスト。
- `src/shared/view-models.ts`: 既存Issue / Cycle / WorkflowState view modelを再利用し、新規公開型は追加しない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| `version`が負数・小数・文字列 | schema parse失敗。serviceへ渡さない |
| `cycleId` / `statusId`が空文字、`statusId`単独、未知フィールド | strict schema parse失敗。serviceへ渡さない |
| `beforeIssueId: null` | valid。指定スコープの末尾としてserviceへ渡す |
| `beforeIssueId === issueId` | schemaでは構造を受理し、serviceの既存validationで400にする |

## テストケース（技法注記付き）

- [代表値] `cycleId`付きList要求がschemaを通過する。
- [代表値] `cycleId`と`statusId`付きBoard要求がschemaを通過する。
- [境界値] `beforeIssueId: null`、`version: 0`を受理し、負数・小数・空文字を拒否する。
- [デシジョンテーブル] `cycleId`なし / `cycleId`あり / `statusId`単独 / 両方ありの組合せを、後方互換・Board scope・不正として判定する。
- [代表値] 未知フィールドをstrict schemaが拒否する。
