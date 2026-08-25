# FEAT-issue-experience-polish: data契約

## 担保 AC（[index.md](./index.md) の引用）

- **AC-3**: IssuesのList表示でOrderを「手動」にすると、Issueをドラッグ＆ドロップで別の位置へ移動でき、移動後の順序がBootstrap再取得・再読み込み後も保持される。Board表示は既存のList / Board共通Orderに従うが、Board内のDnD操作は追加しない。
- **AC-4**: 手動順の変更はOwner境界、Issue version、Runtime lock、冪等性を既存のMutation規約に従って検証し、競合・ロック・不正入力時は業務データを部分更新しない。ListではKeyboardの上移動・下移動も利用できる。
- **AC-5**: SettingsのAppearanceで既存の表示モード（Light / Dark / System）とは別に、Coral / Ocean / Violet / Forest / Amberからカラーテーマを1つ選択でき、選択値がユーザー設定として保存・再取得される。初期値はCoralとする。
- **AC-6**: 選択したカラーテーマがデスクトップ、タブレット、スマートフォンの主要画面へ反映され、390px幅で横overflowを発生させない。テーマ保存の400 / 423 / 500系失敗時は選択を確定せず、既存のエラー通知・再試行導線を表示する。既存のProject詳細（`/projects/:projectId`）は引き続き利用できる。

## 公開契約 / 境界

- `OrbitStore.preferences`のPreferencesへ`colorTheme: ColorTheme`を追加する。初期Owner作成時は`coral`とする。
- D1の`user_preferences`へ`color_theme TEXT NOT NULL DEFAULT 'coral'`を追加し、`coral / ocean / violet / forest / amber`以外を拒否するcheck制約を持つ。既存行はmigrationのdefaultでCoralへ移行する。
- `issues.position`は既存列を再利用する。Reorder対象は`userId`一致かつ`deletedAt === null`かつ`archivedAt === null`のIssueのみとする。active IssueのpositionはReorder成功時に0始まりで連番化する。
- Snapshotの`preferences`要素へ`colorTheme`を保存し、旧Snapshotで値が欠落している場合はCoralへ補完する。不正な値は復元を拒否する。既存のD1 snapshot Version CASを通じて保存する。

## 実装配置

- `src/shared/contracts/enums.ts`: `colorThemeValues` / `colorThemeSchema` / `ColorTheme`。
- `src/shared/view-models.ts` / `src/server/model.ts`: Preferences公開型。
- `src/db/schema.ts` / `src/db/repositories/owner.ts`: D1列と初期Owner値。
- `drizzle/0002_known_scarlet_spider.sql`（生成物）: `user_preferences.color_theme` migration。
- `src/server/store.ts`: Snapshot validation / seed / Preferences更新 / Reorderのposition処理。
- `src/server/store-persistence.test.ts` / `src/db/schema.test.ts`: round-tripとschema検証。

## 異常系挙動

| シナリオ | 本レイヤーの挙動 |
|---|---|
| Reorder target / beforeが不存在またはOwner外 | 404、Issue / Activity / Outbox / Receiptを変更しない |
| target version不一致 | 409 `ISSUE_VERSION_CONFLICT`、全Issueのpositionを変更しない |
| Runtime lock | 423、position / Preferences / Activity / Outbox / Receiptを変更しない |
| colorTheme不正 | 400相当のvalidation error、Preferencesを変更しない |
| SnapshotのcolorTheme欠落 | 旧形式として`coral`を補完して復元する |
| SnapshotのcolorTheme不正 | `Invalid OrbitStore snapshot`として復元を拒否する |

## テストケース（技法注記付き）

- [代表値] active Issueを`beforeIssueId`の直前へ移動 → positionが0始まりで連番になり、対象Issueが返る。
- [代表値] `beforeIssueId: null` → 対象Issueがactive順の末尾へ移動する。
- [境界値] 先頭を先頭へ移動 / 末尾を末尾へ移動 → 順序とversionが不要に変化しない。
- [デシジョンテーブル] Owner一致 × version一致 × lock解除 → 成功、その他の組み合わせ → 404 / 409 / 423で副作用なし。
- [状態遷移] Reorder成功 → `toSnapshot` → `fromSnapshot` → Bootstrapの順序が一致する。
- [状態遷移] 同じidempotencyKey・同じ入力の再送 → 同じ結果でposition / versionを二重更新しない。
- [デシジョンテーブル] 同じKey・異なる入力 → `IDEMPOTENCY_KEY_REUSED`でposition不変。
- [同値分割] colorThemeの5値 → 保存成功、未知値・空文字 → validation error。
- [代表値] 旧Preferencesへ初期値coralをseed → Bootstrapに`colorTheme: coral`を返す。
- [代表値] colorThemeをsnapshotへ保存・復元 → 値が一致する。
- [状態遷移] 旧snapshotのcolorTheme欠落 → coralを補完して復元する。不正な値 → 復元を拒否する。
