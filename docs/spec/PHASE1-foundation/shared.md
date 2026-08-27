# PHASE1: shared

## 担保 AC（[index.md](./index.md) の引用）

- **AC-3**: 本人のPreferencesは`timezone`、`locale`、`theme`、`colorTheme`、`estimateEnabled`を既存の`PATCH /api/v1/preferences`で更新でき、許可値・IANA timezone・Owner境界・idempotencyを検証し、成功値が再取得後も保持される。Settingsでは各項目の初期・保存中・成功・失敗状態を操作可能に表示する。
- **AC-4**: 本人はWorkflow stateを一覧・追加・名称/色/順序/既定値変更・削除できる。カテゴリは`backlog / unstarted / started / completed / canceled`に限定し、Owner外の参照を拒否し、既定stateは常に1件、Issueが参照中または既定stateの削除は拒否し、同じidempotencyKeyの再送はNo-opになる。
- **AC-5**: Background Runが`pending`または`running`の間、Preferences / Workflowを含む業務Mutationは423 `OPERATION_IN_PROGRESS`で拒否され、Issue・Activity・Outbox・Receipt・設定値を変更しない。`GET /api/v1/background-runs/current`とBootstrapは本人のRun状態だけを返し、`lock_token`と`admission_token`を公開しない。

## このレイヤーが公開する契約

### Preferences

```ts
type PreferencesMutation = {
  idempotencyKey: string
  timezone?: string
  locale?: 'ja' | 'en'
  theme?: 'light' | 'dark' | 'system'
  colorTheme?: 'coral' | 'ocean' | 'violet' | 'forest' | 'amber'
  estimateEnabled?: boolean
}
```

`idempotencyKey`は1〜200文字、その他の値は既存enumを使う。`timezone`はIANA timezoneまたは`UTC`とし、空文字・不明なtimezoneを拒否する。入力objectはstrictとし、未指定の項目は変更しない。

### Workflow

```ts
type WorkflowStateCreateMutation = {
  idempotencyKey: string
  name: string // Unicode 1..100
  category: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
  color: `#${string}` // #RRGGBB
  isDefault?: boolean
}

type WorkflowStateUpdateMutation = {
  idempotencyKey: string
  name?: string // Unicode 1..100
  color?: `#${string}` // #RRGGBB
  position?: number // integer >= 0
  isDefault?: boolean
}
```

Schemaは`zod`で検証し、unknown keyを拒否する。Workflow stateのcategoryは作成時だけ指定し、更新で変更しない。

## 異常系挙動

| シナリオ | sharedの挙動 |
|---|---|
| enum / 型 / unknown key不正 | `VALIDATION_ERROR`のfieldErrorsへ変換できる失敗結果 |
| timezone不正 | `timezone`のfieldErrorsへ変換できる失敗結果 |
| Workflow color / name / position不正 | 対象fieldのfieldErrorsへ変換できる失敗結果 |
| Token混入 | strict public schemaでparseを拒否する |

## テストケース（技法注記付き）

- [同値分割] Preferencesのlocale / theme / colorThemeの各許可値と不許可値を分け、strict unknown keyを拒否する。
- [境界値] idempotencyKeyの1 / 200文字を受理し、0 / 201文字を拒否する。
- [代表値] `UTC`、`Asia/Tokyo`を受理し、存在しないIANA timezoneと空文字を拒否する。
- [境界値] Workflow nameのUnicode 1 / 100文字を受理し、0 / 101文字を拒否する。
- [境界値] Workflow colorの`#000000` / `#FFFFFF`を受理し、短縮形・英数字以外を拒否する。
- [境界値] Workflow positionの0を受理し、負数・小数を拒否する。
- [代表値] Public Run summaryは`lock_token` / `admission_token`を含まない。
