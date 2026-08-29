# CYC-14: Cycle内Issueの並び替え

## 概要

Cycle詳細で、選択中CycleのIssueをList / Boardの両方から手動で並び替えられるようにする。
既存のIssue追加・解除と手動順APIを再利用し、Cycle外のIssue順序とCycle / Statusの所属は変更しない。

## 対象範囲

- 対象レイヤー: shared / service / ui
  - [shared.md](./shared.md)
  - [service.md](./service.md)
  - [ui.md](./ui.md)
- 対象ドメイン: cycles / issues / Owner scoped manual ordering
- 対象画面: `/cycles` のCycle詳細ワークスペース
- 対象外（やらないこと）:
  - 新規D1 table、Migration、Cycle専用position列の追加
  - 既存のCycle Issue追加・解除契約の変更
  - BoardのStatus列をまたぐドラッグによるStatus変更
  - `/issues` 全体BoardへのDrag & Drop追加
  - 複数Issueの一括並び替え、Realtime同期、履歴編集・Undo
  - Completed CycleへのIssue追加・解除の解禁

## ユニット計画

単一ユニット（Cycle内Issue並び替えのvertical slice）。既存Issueの手動順をCycleスコープへ限定するshared / service契約と、Cycle詳細のList / Board UIを同一変更で接続する。

| # | ユニット | 含む AC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Cycle内IssueのList / Board並び替え | AC-1〜5 | 既存`Issue.position` / reorder API | 未着手 |

## 受け入れ基準（AC）

- [x] **AC-1**: 本人がCyclesでCurrent / Upcoming / PastのCycleを選択すると、Cycle詳細のIssue領域をList / Boardで切り替えられ、両表示は選択中Cycleの本人所有・未削除Issueだけを同じ手動順で表示する。既存のCycle追加・解除導線（Current / Upcomingのみ、Completedは読み取り専用）は維持する。
- [x] **AC-2**: 本人がCycle詳細のListでIssueをドラッグまたはキーボードの上下操作で並び替えると、`POST /api/v1/issues/reorder`へ`cycleId`付きの要求を送り、同一Cycle内の順序を保存する。Boardでは同一Status列内のドラッグまたは上下操作で同じ契約を使い、Status変更は発生させない。成功後のList / BoardとBootstrap再取得は同じ順序を返す。
- [x] **AC-3**: Cycleスコープの並び替えは、対象Issue・移動先が同一Ownerかつ同一Cycle（Boardは同一Status）であること、対象Issueの`version`、既存のidempotency、Runtime lockを検証する。不正参照は404、version競合は409、lock中は423とし、失敗時にIssueのposition / version / cycleId、Activity、Outbox、Receiptを部分更新しない。成功時もCycle外Issueの相対順序とIssueのCycle / Status所属を変えない。
- [x] **AC-4**: 既存のCycle Issue追加・解除は、並び替えの追加後もCurrent / Upcomingで利用でき、再読込後に所属と保存済みposition順を維持する。追加されたIssueは既存のposition順に従って表示し、解除されたIssueはCycleのList / Boardから除外する。Completed Cycleでは従来どおり追加・解除・並び替えを確定しない。
- [x] **AC-5**: Cycle詳細のList / Board切替と並び替えはDesktop（1200px以上）、Tablet（768〜1199px）、390px Mobileで横overflowを発生させず、PointerとKeyboardで操作できる。初期・Loading・空・成功・400 / 404 / 409 / 423 / 500系エラーを既存のCycle詳細導線で明示し、失敗時は表示順を確定せず再試行できる。

## アーキテクチャ / レイヤー間フロー

```text
Cycle詳細（selectedCycle）
  ├─ Cycle Issues を Issue.position 順に表示
  ├─ List: 全Cycle Issueを対象に reorder
  └─ Board: Status列ごとに同一列のCycle Issueを対象に reorder
       │
       └─ POST /api/v1/issues/reorder
            { idempotencyKey, issueId, version, beforeIssueId,
              cycleId, statusId? }
                 │
                 └─ Owner scoped OrbitStore.reorderIssue
                      ├─ 同一Cycle / 同一Statusを検証
                      ├─ 既存Issue.positionのスロットをCycle内で置換
                      └─ Snapshot再取得でList / Boardへ反映
```

`cycleId`なしの既存要求は従来の全Active Issue向けreorderとして後方互換に扱う。`cycleId`ありでは、全Active Issueのうち同一Cycle（`statusId`指定時は同一Status）に属するIssueの既存positionスロットだけを並べ替え、Cycle外のIssueの相対順序を保持する。`beforeIssueId: null`は指定スコープの末尾を表す。

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service | 表示層の挙動 |
|---|---|---|---|
| 未認証 / 認証設定不備 | 公開schemaを適用しない | 既存401 / 500契約 | 既存の認証・読み込みエラー導線 |
| 入力不正 / self target / `statusId`単独指定 | strict schemaで400 | 業務データ・Activity・Outbox・Receiptを変更しない | 入力順を確定せず、エラーToastと再試行 |
| Cycle / Status / Issue不存在・Owner外・スコープ外 | 型は受理してserviceで拒否 | 404 `RESOURCE_NOT_FOUND`、部分更新なし | 順序を戻し、最新Bootstrap再取得導線 |
| Completed Cycleへの並び替え | — | 400 `VALIDATION_ERROR`、副作用なし | 閲覧のみを維持し、操作を確定しない |
| version競合 | `version`必須 | 409 `ISSUE_VERSION_CONFLICT`、部分更新なし | 最新Bootstrapを取得して競合通知 |
| Runtime lock | — | 423 `OPERATION_IN_PROGRESS`、副作用なし | 順序を確定せずRetry表示 |
| Snapshot / D1障害 | responseを生成しない | 既存500 `INTERNAL_ERROR`、requestIdのみログ | 既存の再試行導線 |
| 履歴0件 / Issue0件 | — | 200の正常系 | 説明的な空状態と追加導線 |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | Cycle Issueのmanual sort / Board group mapper | Bootstrap・Cycle詳細への表示集合とOwner境界 |
| AC-2 | scope別の`beforeIssueId`導出 | reorder APIとSnapshot再取得、List / Board操作配線 |
| AC-3 | scope判定・position slot permutation | Storeの404 / 409 / 423 / idempotency / side-effect境界 |
| AC-4 | 末尾追加・解除後の表示集合 | 既存Issue PATCHとCycle詳細の回帰 |
| AC-5 | 表示状態・Keyboard / Pointer handler・responsive CSS | Cycle詳細の状態表示とretry導線 |

正常系と異常系のデータ境界はStore / APIテストで担保し、position計算・scope判定・表示順変換は単体テストで担保する。実ブラウザの実測はRelease hardeningの任意Smokeへ残す。

## 既存実装との関係（再利用 / 差分 / 衝突）

- 再利用するもの: `Issue.position`、`reorderIssueInputSchema`、`POST /api/v1/issues/reorder`、`OrbitStore.reorderIssue`のOwner / version / Runtime lock / idempotency / Activity / Outbox / Receipt、`CyclesView`のCycle選択・追加・解除・metrics、`sortIssues`、`beforeIssueIdForDrop` / `beforeIssueIdForMove`。
- 差分: reorder入力へ任意の`cycleId`と`statusId`を追加し、Cycle詳細にList / Board切替とCycleスコープの操作を配線する。BoardのIssueCardにも同一列内のPointer / Keyboard操作を追加する。
- 衝突回避: 既存の`cycleId`変更はIssue PATCHのまま維持し、reorderでStatusやCycle所属を変更しない。`cycleId`なしの全体Issues Listの挙動と既存のIssue Board表示は変更しない。
- data層: `Issue.position`を再利用するため、schema / Migration / D1 tableの変更は行わない。production Snapshotの既存Issue位置をそのままRound-tripする。

## 実装に効く制約

- Cycleスコープの対象は本人所有・未削除・未アーカイブで、対象Issueと移動先は同一Cycleでなければならない。
- Boardのスコープは`cycleId + statusId`で、対象Issueと移動先を同一Statusに限定する。列間ドラッグはStatus変更として扱わない。
- `beforeIssueId: null`はCycle ListまたはBoardの該当Status列の末尾。非表示Issueを暗黙の移動先にしない。
- position slotの並べ替えは既存のposition値の集合を再利用し、Cycle外Issueの相対順序を保持する。失敗時は全副作用を発生させない。
- Cycle外の全体List reorder、Cycle追加・解除、Cycle close / start、CYC-10自動追加、Cycle繰越履歴は変更しない。
- 操作中はボタン・ドラッグをdisabledにし、既存のToast retryとBootstrap refreshを再利用する。

## 判断根拠 / 未決事項

- Cycle専用のposition列や新規`cycle_issue_order` tableは、現在のSnapshot bridgeとD1 Migrationの範囲を広げるため却下した。既存`Issue.position`のCycle内positionスロットを置換することで、Cycle表示の順序を保存しつつCycle外の相対順序を壊さない。
- 新規endpointではなく既存`POST /api/v1/issues/reorder`へ任意のscope値を追加する。既存Issues画面の要求を壊さず、Owner / version / lock / idempotencyの処理を一箇所へ集約できる。
- BoardはStatus列をまたぐ操作を並び替えと混同しないよう、同一Status列内だけを対象とする。列間のStatus変更は既存Issue PATCHの責務として残す。前段specでBoard DnDを対象外とした範囲を、Cycle詳細の同一列操作として最小限拡張する。
- 既存のCycle追加・解除は実装済みのため再実装せず、AC-4は回帰条件として検証する。Completed Cycleを変更可能にする判断は別チケットへ分離する。
- 未決事項なし。Gate 1で「既存position再利用」「同一Status列内Board操作」「Cycle詳細List / Board切替」の方針が承認され、Gate 2はユーザー指定により委任する。
