# CYC-14: uiレイヤー詳細設計

> 2026-10-02の追加依頼で、上下ボタンをDrag handle上のAlt+ArrowUp/Downへ置き換える。保存契約とDnDは維持する。最新UI契約は[FEAT-review-followup AC-12](../FEAT-review-followup/index.md)を参照。以下は初回実装時の記録。

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-1**: 本人がCyclesでCurrent / Upcoming / PastのCycleを選択すると、Cycle詳細のIssue領域をList / Boardで切り替えられ、両表示は選択中Cycleの本人所有・未削除Issueだけを同じ手動順で表示する。既存のCycle追加・解除導線（Current / Upcomingのみ、Completedは読み取り専用）は維持する。
- **AC-2**: 本人がCycle詳細のListでIssueをドラッグまたはキーボードの上下操作で並び替えると、`POST /api/v1/issues/reorder`へ`cycleId`付きの要求を送り、同一Cycle内の順序を保存する。Boardでは同一Status列内のドラッグまたは上下操作で同じ契約を使い、Status変更は発生させない。成功後のList / BoardとBootstrap再取得は同じ順序を返す。
- **AC-4**: 既存のCycle Issue追加・解除は、並び替えの追加後もCurrent / Upcomingで利用でき、再読込後に所属と保存済みposition順を維持する。追加されたIssueは既存のposition順に従って表示し、解除されたIssueはCycleのList / Boardから除外する。Completed Cycleでは従来どおり追加・解除・並び替えを確定しない。
- **AC-5**: Cycle詳細のList / Board切替と並び替えはDesktop（1200px以上）、Tablet（768〜1199px）、390px Mobileで横overflowを発生させず、PointerとKeyboardで操作できる。初期・Loading・空・成功・400 / 404 / 409 / 423 / 500系エラーを既存のCycle詳細導線で明示し、失敗時は表示順を確定せず再試行できる。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| Cycle一覧初期化 | `GET /api/v1/bootstrap` | `cycles`、`issues`、`workflowStates`を利用。Issueは`position`順へ変換 | 既存Owner scoped | Cycle詳細のList / Board表示 |
| Cycle並び替え | `POST /api/v1/issues/reorder` | `{ idempotencyKey, issueId, version, beforeIssueId, cycleId, statusId? }`。Listは`statusId`なし、Boardは列のStatus ID付き | 既存認証・Owner・Runtime lock | List / Board操作 |
| Issue追加・解除 | `PATCH /api/v1/issues/:issueId` | 既存`version`と`patch.cycleId` | 既存Owner / version / Runtime lock | AC-4の既存導線 |

Cycle詳細は新規Routeを作らず、既存`CyclesView`のselected Cycle領域へ表示状態を追加する。

## 実装配置

- `src/components/OrbitApp.tsx`: `CyclesView`へList / Board切替、scope付きreorder、List / Boardの操作状態・エラー・retryを追加。既存の`IssueRow` / `IssueCard`と`sortIssues` / `beforeIssueIdFor*`を再利用する。
- `src/components/issue-list.ts`: Cycle scopeの表示順・Board列順・drop前ID導出に必要な純粋関数を追加または既存関数を再利用する。
- `src/components/cycle-reorder.test.ts`（必要なら既存Cycle UI testへ統合）: scope別表示、List / Board操作、状態表示、アクセシビリティ、responsive DOMを検証する。
- `src/styles.css`: Cycle view toggle、reorder controls、Board cardのdrag / focus / disabled状態、390px縦積みを既存tokenで追加する。

## UI/UX 方針

- **画面フロー / 導線**: Current / Upcoming / PastのCycleを選ぶと、metrics・繰越表示・既存追加UIに続けてIssue view toggleを表示する。初期値はList。Cycle選択を変えても同じ画面内のList / Board選択は維持する。
- **主要操作とフィードバック**: Listは行のDrag & Dropまたは`↑` / `↓`ボタン、BoardはStatus列内のCard Drag & Dropまたは同じ上下ボタンで移動する。送信中は対象操作をdisabledにし、成功時は既存refresh後に成功Toast、409 / 423 / その他失敗は順序を確定せず既存retry Toastを出す。
- **状態設計（出し分け）**: 初期は既存Cycle詳細のloading導線、成功はselected CycleのIssue集合、0件は「このCycleにIssueはありません」と追加導線、並び替え中は対象操作disabled、400 / 404 / 409 / 423 / 500は既存error / Toast / retry導線を表示する。Completed Cycleはviewを表示するが並び替え操作と追加・解除をdisabledにする。
- **既存デザインシステムとの整合**: `cycle-detail`、`cycle-tabs`、`detail-section`、`view-toggle`、`issue-row`、`issue-card`、`button`、`text-button`、`toast`、既存のstatus / priority表示を再利用する。新しいDnDライブラリは追加しない。

### レスポンシブ / アクセシビリティ

- Desktop（1200px以上）はCycle詳細のIssue領域でListの密度とBoard列を横配置する。Tablet（768〜1199px）はBoard列を横スクロール、Listは1カラム寄りにする。Mobile（390pxを主対象、767px以下）はListを縦積み、BoardはStatus列を横スクロールし、操作ボタンを常時表示する。
- Dragだけに依存せず、各Issueに可視テキストまたは`aria-label`付きの`上へ` / `下へ`操作を置く。先頭・末尾・Completed・送信中は該当ボタンをdisabledにする。
- Cardは操作ボタン内へ別のbuttonを入れない。Issueを開く操作と並び替え操作を別要素にし、Tab順・focus ring・Enter / Space操作を維持する。
- List / Board切替には`aria-pressed`または同等の選択状態を付け、Statusは色だけでなく名称を表示する。390pxでタイトル・操作ボタンが画面外へはみ出さない。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| Bootstrap Loading | Cycle詳細の既存loading表示を維持し、操作を表示しない |
| Cycle Issue 0件 | 空状態と既存Issue追加導線を表示する |
| 400 / 404 | 送信前の順序を維持し、エラー内容とretryを表示する |
| 409 `ISSUE_VERSION_CONFLICT` | 最新Bootstrapを再取得し、古い順序を確定せず競合を通知する |
| 423 `OPERATION_IN_PROGRESS` | 操作を確定せず、Runtime lock解除後のretryを表示する |
| 500 / network error | 操作前の順序を表示し、既存の再試行Toastを利用する |
| Completed Cycle | List / Boardの閲覧は許可するが、reorder / add / removeをdisabledにする |

## テストケース（技法注記付き）

- [状態遷移] Cycle詳細でList / Boardを切り替え、同じCycle Issue集合とmanual orderを表示する。
- [代表値] Listの`↑` / `↓`とDragが`cycleId`付きreorder要求を作る。
- [代表値] BoardのCardを同一Status列内で上下・Drag移動し、`cycleId + statusId`を送る。
- [デシジョンテーブル] Current / Upcoming / Completed × List / Board × 操作可否を表示する。
- [状態遷移] reorder成功後にrefreshして順序を表示し、成功Toastを出す。
- [状態遷移/失敗系] 400 / 404 / 409 / 423 / 500で順序を確定せずretryを表示する。
- [境界値] 先頭・末尾の上下ボタンをdisabledにし、Issue0件は追加導線を表示する。
- [アクセシビリティ] view toggle、reorder button、Issue openがTab / Enter / Spaceで操作でき、aria-labelとfocus状態を持つ。
- [代表値] 390 / 768 / 1200pxのDOM / CSSで横overflowを発生させない。
