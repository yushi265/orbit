# FEAT-cycle-workspace: shared契約

## 担保AC

- **AC-2**: Cycle詳細でnameOverride（nullまたはUnicode 1〜100文字）とdescription（0〜2,000文字）を保存でき、成功時は同じCycleの再表示に反映され、同じidempotencyKeyの再送はNo-op、異なるRequestは409になる。Runtime lock中は423で副作用がない。

## 公開契約

```ts
type CycleMetadataMutation = {
  idempotencyKey: string
  nameOverride?: string | null
  description?: string
}
```

- `nameOverride`: 未指定は変更なし、`null`は自動生成名へ戻す、文字列はUnicode code point 1..100。
- `description`: 未指定は変更なし、指定時はUnicode code point 0..2,000。
- 未知のキー、空文字nameOverride、2,001文字以上はstrict schemaで拒否する。

## 異常系挙動

| シナリオ | 契約 |
|---|---|
| nameOverride / description境界外 | `VALIDATION_ERROR` / 400 |
| 未知キー | `VALIDATION_ERROR` / 400 |
| 内部Token混入 | strict schema decode拒否 |

## テストケース

- [境界値] nameOverride 0 / 1 / 100 / 101 code points、description 0 / 2,000 / 2,001。
- [同値分割] null / string / omitted metadata fields。
- [契約] unknown key / lock token混入は拒否。
