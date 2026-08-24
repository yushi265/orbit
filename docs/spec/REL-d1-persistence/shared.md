# REL: D1永続化Adapter（shared）

## 担保AC

- **AC-3**: 同じOwnerの同時リクエストが同じD1スナップショットVersionを読んだ場合、先に保存した1件だけが成功し、後続は409 `D1_WRITE_CONFLICT`になり、後続の状態で先行更新を上書きしない。

## 公開契約

`src/shared/contracts/errors.ts`へ`D1_WRITE_CONFLICT`を追加し、HTTP status `409`へ対応付ける。ErrorEnvelopeのJSON形状、`message`、`requestId`、既存ErrorCodeの意味は変更しない。

## テストケース

- [代表値] `D1_WRITE_CONFLICT`をErrorCode schemaが受け入れ、HTTP status 409を返す。
- [同値分割] 既存ErrorCodeのstatus対応が変更されていない。
- [契約境界] ErrorEnvelopeへtokenやSnapshot JSONを追加できない。

## 異常系挙動

- D1 Version競合は409 ErrorEnvelopeへ変換し、内部SnapshotやOwner情報を返さない。
