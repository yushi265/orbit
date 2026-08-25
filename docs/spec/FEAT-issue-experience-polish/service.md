# FEAT-issue-experience-polish: service契約

## 担保 AC（[index.md](./index.md) の引用）

- **AC-3**: IssuesのList表示でOrderを「手動」にすると、Issueをドラッグ＆ドロップで別の位置へ移動でき、移動後の順序がBootstrap再取得・再読み込み後も保持される。Board表示は既存のList / Board共通Orderに従うが、Board内のDnD操作は追加しない。
- **AC-4**: 手動順の変更はOwner境界、Issue version、Runtime lock、冪等性を既存のMutation規約に従って検証し、競合・ロック・不正入力時は業務データを部分更新しない。ListではKeyboardの上移動・下移動も利用できる。
- **AC-5**: SettingsのAppearanceで既存の表示モード（Light / Dark / System）とは別に、Coral / Ocean / Violet / Forest / Amberからカラーテーマを1つ選択でき、選択値がユーザー設定として保存・再取得される。初期値はCoralとする。
- **AC-6**: 選択したカラーテーマがデスクトップ、タブレット、スマートフォンの主要画面へ反映され、390px幅で横overflowを発生させない。テーマ保存の400 / 423 / 500系失敗時は選択を確定せず、既存のエラー通知・再試行導線を表示する。既存のProject詳細（`/projects/:projectId`）は引き続き利用できる。

## 公開HTTP API

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/v1/issues/reorder` | `{ idempotencyKey: string, issueId: string, version: number, beforeIssueId: string \| null }` | `200 { issue: Issue }` |
| PATCH | `/api/v1/preferences` | `{ idempotencyKey: string, colorTheme?: ColorTheme, ...既存項目 }` | `200 { preferences }` |

Reorder requestはstrict schemaとし、`issueId` / `beforeIssueId`はopaque ID、`version`は0以上の整数、`beforeIssueId`は末尾移動時だけnullとする。両APIはsame-origin、`withOwner`、Runtime lock、idempotency receiptを適用する。

## エラー契約

| 条件 | HTTP / code | 業務効果 |
|---|---|---|
| body不正、colorTheme不正、空ID | 400 `VALIDATION_ERROR` | なし |
| target / beforeが不存在またはOwner外 | 404 `RESOURCE_NOT_FOUND` | なし |
| target version不一致 | 409 `ISSUE_VERSION_CONFLICT` | なし |
| 同じKeyで異なるrequest | 409 `IDEMPOTENCY_KEY_REUSED` | なし |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` | なし |
| 下位Store / D1障害 | 500 `INTERNAL_ERROR` | Storeの原子性により部分更新なし |

## 実装配置

- `src/shared/contracts/issues.ts`: `reorderIssueInputSchema`。
- `src/shared/contracts/enums.ts`: `ColorTheme` wire enum。
- `src/server/api.ts`: `reorderIssue` handler、Preferencesの許可フィールド追加。
- `src/routes/api/v1/issues/reorder.ts`: Reorder route。
- `src/routes/api/v1/preferences.ts`: 既存routeを再利用。
- `src/server/store.ts`: `reorderIssue` / `updatePreferences`の公開処理。
- `src/server/api.test.ts` / `src/server/store.test.ts`: APIとStoreの結合境界。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| Reorder validation | ErrorEnvelopeのfieldErrorsを返し、Storeを呼ばない |
| Owner外 target / before | 404を返し、bodyに対象データを露出しない |
| version conflict | 409を返し、UIがBootstrap再取得できる既存codeを使う |
| lock中 | 423を返し、同じidempotencyKeyの再試行契約を維持する |
| PreferencesのcolorTheme保存失敗 | 既存Preferencesを返却せず、保存前値を維持する |

## テストケース（技法注記付き）

- [代表値] Reorder POSTでtargetをbeforeの直前へ移動 → 200と更新後Issueを返す。
- [代表値] `beforeIssueId: null` → 末尾へ移動し、Bootstrapのmanual orderへ反映する。
- [デシジョンテーブル] target / beforeのOwner一致・不存在 → 成功 / 404。
- [状態遷移] version一致 → 成功、古いversion → 409、レスポンス後のbootstrap versionが単調に進む。
- [状態遷移] Runtime lock中のReorder → 423、後続GETで順序不変。
- [状態遷移] 同じKey同じrequestの再送 → 同じIssue、position / versionの追加変更なし。
- [デシジョンテーブル] 同じKey異なるrequest → 409 `IDEMPOTENCY_KEY_REUSED`。
- [同値分割] colorTheme 5値 → 200、`sepia` / 空文字 → 400。
- [代表値] Preferences PATCHのcolorTheme → 200、Bootstrap再取得で同じ値。
- [レイヤー内障害] Store保存失敗 → 500とErrorEnvelope、部分更新なし。
