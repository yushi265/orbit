# FEAT-issue-experience-polish: Issue操作性とカラーテーマの改善

## 概要

Issue作成時の日本語IME操作を安全にし、Issue一覧のPriorityをアイコン表示へ変更する。
あわせて、IssuesのList表示だけで手動並び替えを保存できるようにし、ユーザー設定へ複数のカラーテーマを追加する。

## 対象範囲

- 対象レイヤー: データ（[data.md](./data.md)） / サービス（[service.md](./service.md)） / 表示（[ui.md](./ui.md)）
- 対象ドメイン: Issue作成・一覧・手動順、個人設定の外観
- 対象外: Board表示のDnD、Project詳細の新規追加、Saved Viewへの手動順・カラーテーマの個別保存、Priorityのwire値変更

## ユニット計画

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Issue入力とPriority表示 | AC-1, AC-2 | — | 完了 |
| 2 | Issue List手動順 | AC-3, AC-4 | 既存`issues.position` | 完了 |
| 3 | カラーテーマ | AC-5, AC-6 | 既存Preferences / D1 snapshot | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: PCの新規Issue composerでIME変換中にEnterを押してもIssueを作成せず、変換確定後のEnterで1回だけ作成する。Shift + Enterは改行として扱い、既存の空タイトル拒否を維持する。
- [x] **AC-2**: IssuesのList表示でPriorityを文字バッジではなく、No priority / Low / Medium / High / Urgentを識別できるアイコンで表示する。アイコンには画面読み上げ用のPriority名を付け、既存のインライン更新操作は維持する。
- [x] **AC-3**: IssuesのList表示でOrderを「手動」にすると、Issueをドラッグ＆ドロップで別の位置へ移動でき、移動後の順序がBootstrap再取得・再読み込み後も保持される。Board表示は既存のList / Board共通Orderに従うが、Board内のDnD操作は追加しない。
- [x] **AC-4**: 手動順の変更はOwner境界、Issue version、Runtime lock、冪等性を既存のMutation規約に従って検証し、競合・ロック・不正入力時は業務データを部分更新しない。ListではKeyboardの上移動・下移動も利用できる。
- [x] **AC-5**: SettingsのAppearanceで既存の表示モード（Light / Dark / System）とは別に、Coral / Ocean / Violet / Forest / Amberからカラーテーマを1つ選択でき、選択値がユーザー設定として保存・再取得される。初期値はCoralとする。
- [x] **AC-6**: 選択したカラーテーマがデスクトップ、タブレット、スマートフォンの主要画面へ反映され、390px幅で横overflowを発生させない。テーマ保存の400 / 423 / 500系失敗時は選択を確定せず、既存のエラー通知・再試行導線を表示する。既存のProject詳細（`/projects/:projectId`）は引き続き利用できる。

## アーキテクチャ / レイヤー間フロー

```text
Issues List / Settings UI
  ├─ IME-aware IssueComposer
  ├─ PriorityIcon + manual List reorder
  └─ colorTheme selector
       │
       ├─ GET /api/v1/bootstrap
       ├─ POST /api/v1/issues/reorder
       └─ PATCH /api/v1/preferences
             │
             └─ Owner-scoped OrbitStore
                  ├─ existing issues.position
                  └─ user_preferences.color_theme / snapshot Preferences.colorTheme
```

手動順は既存の`issues.position`を再利用する。Reorder APIは対象Issueを並びから抜き、`beforeIssueId`の直前へ挿入したうえで、Ownerのactive Issueのpositionを0始まりへ再採番する。順序変更と関連するActivity / Outbox / ReceiptはMemory Store上で1操作として確定する。

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service / data | 表示層の挙動 |
|---|---|---|---|
| IME変換中のEnter | — | API呼び出しなし | 作成せず、入力中のタイトルを保持 |
| Reorder対象・移動先が不存在 / Owner外 | strict contract | 404 `RESOURCE_NOT_FOUND`、Issue / Activity / Outbox / Receipt不変 | 順序を戻し、エラーToastと再試行 |
| Reorderのversion競合 | `version`必須 | 409 `ISSUE_VERSION_CONFLICT`、部分更新なし | 最新Bootstrapを取得し、順序を確定しない |
| Runtime lock | — | 423 `OPERATION_IN_PROGRESS`、副作用なし | 順序・テーマを確定せず、既存Retryを表示 |
| カラーテーマ入力不正 | `colorThemeSchema` | 400 `VALIDATION_ERROR` + `fieldErrors` | 選択値を保持し、保存済みテーマを変えない |
| Preferences保存の内部障害 | — | 500 `INTERNAL_ERROR`、保存前値を維持 | エラー通知と再試行を表示 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | IME submit判定 | — |
| AC-2 | Priority icon mapping / accessibility label | — |
| AC-3 | reorder insertion / position normalization | Reorder API・snapshot再取得 |
| AC-4 | — | Owner / version / lock / idempotency境界 |
| AC-5 | colorTheme schema / theme resolver | Preferences API・snapshot round-trip |
| AC-6 | — | UIの失敗状態・responsive smoke相当 |

UIのレイヤー内テストは、現行プロジェクトのVitest Node環境で実行可能な構造スモーク（UI配線・ARIA・responsive CSS・既存route）を一次証跡とする。実ブラウザでのIME / DnD / スクリーンリーダー / overflow実測は要件を変更しない任意Browser SmokeとしてRelease hardeningへ残す。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用: `OrbitStore.issues.position`、既存のIssue version / Runtime lock / Receipt / Activity / Outbox、Bootstrap、`resolveTheme`、Preferences PATCH、`ProjectsView`の既存Project詳細。
- 差分: shared contractへ`reorderIssueInputSchema`と`colorTheme` enumを追加し、`POST /api/v1/issues/reorder`とPreferencesの`colorTheme`を公開する。UIは`OrbitApp.tsx`と`issue-list.ts`へ配線する。
- 衝突回避: Priorityのwire値は変更せず、表示だけを`PriorityIcon`へ置き換える。BoardにはDnD配線を追加しない。既存Project詳細APIは増やさない。

## 実装に効く制約

- DnDとKeyboard移動UIはList表示かつ`manual` orderの時だけ有効にする。Boardは既存のList / Board共通Orderを表示するが、Board内DnDは追加しない。
- Reorderは対象Issueと移動先を同じOwnerの未アーカイブ・未削除Issueとして検証する。
- Reorder成功時にactive Issueのpositionを一意な0始まりへ正規化し、再読み込みで同じ順序を返す。
- `colorTheme`は`coral / ocean / violet / forest / amber`以外を受け付けず、既存の`theme`（表示モード）と別フィールドで扱う。
- UIは色だけでPriorityやStatusを表現せず、Priorityアイコンへ可視ラベルまたはアクセシブルな名前を付ける。
- D1 migrationを追加する場合も既存Snapshot bridgeとMemory Storeのround-tripを同一変更で更新し、旧SnapshotのcolorTheme欠落はCoralへ補完する。

## 判断根拠 / 未決事項

- Reorderは既存Issue PATCHへpositionを直接渡すのではなく専用APIにする。複数Issueのpositionを再採番するため、途中状態を外部へ見せず、Owner / version / lock / idempotencyの契約を1操作に集約できる。
- `beforeIssueId`方式を採用し、フィルターで非表示のIssueがあってもサーバー側の全active順へ挿入できる。Listのみを対象にしてBoardの状態グループ間移動という別の意味を持ち込まない。
- カラーテーマは表示モードと別の単一選択とする。サーバー保存により端末を変えても設定を再現し、CSS変数の`data-color-theme`で既存デザインへ最小限に統合する。
- Project詳細ページは既存実装（`src/routes/projects/$projectId.tsx` / `ProjectsView`）で要件を満たしているため、新規画面は作らない。
- 未決事項なし。Gate 1でList限定、テーマ名、単一選択、サーバー保存が確定した。
