# FEAT-cycle-workspace: service契約

## 担保AC

- **AC-1**: 本人がCyclesを開くと、Current / Upcoming / Pastを切り替えられ、各タブはOwner scopedなCycleだけを表示し、Cycleがない場合は空状態と次の導線を表示する。
- **AC-2**: Cycle詳細でnameOverride（nullまたはUnicode 1〜100文字）とdescription（0〜2,000文字）を保存でき、成功時は同じCycleの再表示に反映され、同じidempotencyKeyの再送はNo-op、異なるRequestは409になる。Runtime lock中は423で副作用がない。
- **AC-3**: Current / Upcoming Cycleの詳細で、Cycle未所属の本人所有Issueを追加し、所属Issueを解除できる。Issue version CAS、Owner境界、Runtime lock、409 / 423の既存契約を維持する。
- **AC-4**: Cycle詳細にIssue総数、Completed数、進捗率、Canceledを除外したEstimate合計を表示し、Canceled Issueは完了率の分母から除外する。Active Cycleの完了操作は既存の繰越処理を呼び出し、処理中は画面をブロックする。

## 公開HTTP API

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/v1/cycles` | — | `200 { items: Cycle[] }`（既存） |
| PATCH | `/api/v1/cycles/:cycleId` | `CycleMetadataMutation` | `200 { cycle: Cycle }` |
| POST | `/api/v1/cycles/:cycleId` | `Idempotency-Key` | `200 { cycle: Cycle }`（既存 close） |
| PATCH | `/api/v1/issues/:issueId` | 既存 `UpdateIssueInput` + `patch.cycleId` | `200 { issue }`（既存） |

全Mutationにsame-origin、Owner、idempotency、Runtime lockを適用する。

## 異常系挙動

| シナリオ | 挙動 |
|---|---|
| metadata validation | 400 `VALIDATION_ERROR` + fieldErrors |
| Cycle不存在 / Owner外 | 404 `RESOURCE_NOT_FOUND` |
| 同一Keyで異なるRequest | 409 `IDEMPOTENCY_KEY_REUSED` |
| Runtime lock | 423 `OPERATION_IN_PROGRESS` |
| Issue assignment version conflict | 409 `ISSUE_VERSION_CONFLICT` |

## テストケース

- [代表値] PATCH metadataが200で更新後Cycleを返す。
- [デシジョンテーブル] 404 / 400 / 409 / 423をErrorEnvelopeへ変換する。
- [状態遷移] Issue cycleIdを未所属→Cycle→nullへ更新し、versionが進む。
- [状態遷移] Active closeは既存`closeCycle`を呼び、移動対象を次Cycleへ渡す。
