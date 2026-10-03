# CYC-14: serviceレイヤー詳細設計

## 担保 AC（[index.md](./index.md) の AC からの引用）

- **AC-2**: 本人がCycle詳細のListでIssueをドラッグまたはキーボードの上下操作で並び替えると、`POST /api/v1/issues/reorder`へ`cycleId`付きの要求を送り、同一Cycle内の順序を保存する。Boardでは同一Status列内のドラッグまたは上下操作で同じ契約を使い、Status変更は発生させない。成功後のList / BoardとBootstrap再取得は同じ順序を返す。
- **AC-3**: Cycleスコープの並び替えは、対象Issue・移動先が同一Ownerかつ同一Cycle（Boardは同一Status）であること、対象Issueの`version`、既存のidempotency、Runtime lockを検証する。不正参照は404、version競合は409、lock中は423とし、失敗時にIssueのposition / version / cycleId、Activity、Outbox、Receiptを部分更新しない。成功時もCycle外Issueの相対順序とIssueのCycle / Status所属を変えない。
- **AC-4**: 既存のCycle Issue追加・解除は、並び替えの追加後もCurrent / Upcomingで利用でき、再読込後に所属と保存済みposition順を維持する。追加されたIssueは既存のposition順に従って表示し、解除されたIssueはCycleのList / Boardから除外する。Completed Cycleでは従来どおり追加・解除・並び替えを確定しない。

## このレイヤーが公開する契約（外部インターフェース）

| 操作 | 名前 / パス | 入出力・型・制約 | 認証・アクセス制御 | 用途 |
|---|---|---|---|---|
| 並び替え | `POST /api/v1/issues/reorder` | `{ idempotencyKey, issueId, version, beforeIssueId, cycleId?, statusId? }`。成功`200 { issue: Issue }` | `withOwner`、same-origin、Owner、Runtime lock | Cycle List / Boardと既存Issues List |
| 初期再取得 | `GET /api/v1/bootstrap` | 既存`BootstrapPayload.issues`を`position`順で返す | 既存Owner scoped Session | 保存後のList / Board確定 |
| Issue追加・解除 | `PATCH /api/v1/issues/:issueId` | 既存`UpdateIssueInput.patch.cycleId` | 既存Owner / version / Runtime lock | AC-4の回帰導線 |

`cycleId`のscope検証はbody値を信頼せず、Store内の対象Issue / 移動先 / WorkflowStateをOwner境界の内側で解決する。

## 動作契約

1. `assertOwner`、`assertUnlocked`、idempotency receipt確認、対象IssueのOwner・未削除・未アーカイブ・versionを、既存reorderと同じ順序で検証する。
2. `cycleId`ありの場合、対象Issueの`cycleId`が一致しなければ404にする。`beforeIssueId`がある場合は同じ条件を移動先にも適用する。
3. `statusId`ありの場合、`cycleId`も必須とし、対象Issueと移動先（指定時）が同じStatusであることを検証する。Status変更は行わない。
4. `cycleId`ありでは、OwnerのActive Issueを既存position順にした配列から、対象scopeのIssueだけを抽出する。scopeの既存position値を「slot」として保持し、対象を除外して`beforeIssueId`直前または末尾へ挿入した順序をslotへ割り当て直す。scope外Issueのpositionは変更しない。
5. 変更対象Issueのposition / version / updatedAtを更新し、Activity、Outboxは移動した対象Issueの1件ずつだけを既存reorderと同じ形式で記録し（[FIX-snapshot-growth](../FIX-snapshot-growth/service.md)で変更）、最後に対象IssueのReceiptを記録する。validation失敗時はこの手順へ入らない。
6. `cycleId`なしでは既存の全Active Issue再採番を維持する。

## 実装配置

- `src/server/api.ts`: 既存`reorderIssue`のparseとStore呼び出しを維持（入力型の更新のみ）。
- `src/server/store.ts`: `reorderIssue`のscope検証・Cycle / Status slot並び替え・副作用記録を実装。
- `src/server/api.test.ts`: Cycle scopeの正常系、404 / 409 / 423、再取得、追加・解除回帰。
- `src/server/store.test.ts`: position slot、Cycle外相対順序、Status scope、Owner / version / idempotency / lock境界。
- `src/server/store-persistence.test.ts` / `src/server/store-session.test.ts`: Snapshot / production Session再読込後の順序保持。

## 異常系挙動

| シナリオ | 本レイヤーの挙動（エラーコード・レスポンス／表示・ログ） |
|---|---|
| 対象Issue / 移動先が不存在、Owner外、削除済み、アーカイブ済み | 404 `RESOURCE_NOT_FOUND`。position、version、Activity、Outbox、Receiptを変更しない |
| Cycle scopeとIssueの所属Cycleが不一致 | 404 `RESOURCE_NOT_FOUND`。scope外の存在を詳細に返さない |
| Board scopeとIssue / 移動先のStatusが不一致 | 404 `RESOURCE_NOT_FOUND`。Status変更を行わない |
| Completed Cycleへの並び替え | 400 `VALIDATION_ERROR`。CycleとIssueを変更しない |
| `statusId`単独指定、self target | 400 `VALIDATION_ERROR`。副作用なし |
| target version不一致 | 409 `ISSUE_VERSION_CONFLICT`。並び替え計画の適用前に終了 |
| Runtime lock中 | 423 `OPERATION_IN_PROGRESS`。receiptを含め業務副作用なし |
| 同じidempotencyKey・同じRequest | 初回Responseを返し、二重position更新・Activity・Outboxを作らない |
| 同じidempotencyKey・異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED`。業務データを更新しない |
| Snapshot / D1 Session障害 | 既存500契約。内部IDや個人情報を本文へ出さずrequestIdのみログ |

## テストケース（技法注記付き）

- [代表値] Cycle List scopeでCycle内Issueを先頭 / 中間 / 末尾へ移動し、Bootstrap再取得後も順序が維持される。
- [代表値] Board scopeで同一Status列内を移動し、StatusとCycle所属が不変になる。
- [境界値] scopeの先頭でup、末尾でdown、`beforeIssueId: null`はNo-opまたは末尾確定になり、positionが重複しない。
- [デシジョンテーブル] `cycleId`なし / Cycle一致 / Cycle不一致 / `statusId`一致 / Status不一致を成功または404へ分ける。
- [デシジョンテーブル] target / beforeが同一Owner・有効、Owner外、削除済み、アーカイブ済み、不存在を判定する。
- [状態遷移] target version一致は保存、version不一致は409で全副作用なし。
- [状態遷移] Runtime lock中は423で順序・version・Activity・Outbox・Receiptを変更しない。
- [代表値] 同一Key同一Requestの再送は同じResponse、同一Key異なるRequestは409になる。
- [代表値] Cycle外Issueの相対順序と、scope IssueのCycle / Status所属が並び替え前後で不変になる。
- [状態遷移] Issue追加は保存済みposition順に現れ、解除後はList / Boardから消え、Snapshot再読込後も維持される。
- [状態遷移/禁止] Completed Cycleへの追加・解除・並び替え要求は既存どおり確定しない。
- [状態遷移/禁止] Completed Cycleへのscope付きreorderは400になり、Cycle・Issue・副作用を変更しない。
- [代表値] production SessionのSnapshot round-trip後に同じIssue position順を返す。
