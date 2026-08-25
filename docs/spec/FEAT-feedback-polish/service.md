# FEAT-feedback-polish: Service 詳細設計

## 担保 AC

- **AC-2**: Issue一覧・詳細・新規作成でタイトルが主要領域を確保して表示され、PriorityをNo priority / Low / Medium / High / Urgentから選択・保存できる。保存失敗時は既存のrollback / retry契約を維持する。
- **AC-3**: Upcoming Cycleの詳細から「Cycleを開始」を実行できる。対象が現在Cycleの次Cycleである場合、現在Cycleを既存の繰越処理で完了し、対象Cycleを現在時刻開始・設定期間終了のActiveへ遷移する。同じKeyの再送はNo-op、lock中は423になる。
- **AC-4**: Settingsで選択したLight / Dark / Systemが保存後に画面全体へ反映され、再読み込み後も維持される。Darkでは主要カード、入力、一覧、Navigation、Modalの文字と背景のコントラストを確保する。

## 公開契約

| 操作 | パス | 入出力 | エラー |
|---|---|---|---|
| Issue作成 | `POST /api/v1/issues` | 既存`createIssueInputSchema`の`priority` | 400 / 404 / 423 |
| Issue更新 | `PATCH /api/v1/issues/:issueId` | 既存`updateIssueInputSchema`の`version` + `patch.priority` | 400 / 404 / 409 / 423 |
| Cycle開始 | `POST /api/v1/cycles/:cycleId/start` | `{ idempotencyKey: string }` | 400 / 404 / 409 / 423 |
| Theme | `PATCH /api/v1/preferences` | 既存`theme: light | dark | system` | 400 / 423 |

Cycle startの成功レスポンスは`{ cycle: CycleViewModel }`、HTTP 200とする。`idempotencyKey`はJSON bodyで必須とし、headerの暗黙生成には依存しない。対象Cycleが`upcoming`で、現在Cycleが存在する場合は`number + 1`が一致することを検証する。現在Cycleの完了は既存`closeCycle`へ内部委譲し、対象Cycleを`active`へ更新する。後続の未調整upcoming Cycleは設定期間で再計算し、個別調整済みCycleと重なる場合は開始を拒否する。

## 実装配置

- `src/server/store.ts`: `startCycle`と状態・冪等性・Owner / lock検証
- `src/server/api.ts`: `startCycle` handler
- `src/routes/api/v1/cycles/$cycleId/start.ts`: Cycle start route
- `src/server/store-cycle.test.ts` / `src/server/api.test.ts`: 状態遷移・HTTP契約

## 異常系挙動

| 条件 | 挙動 |
|---|---|
| Cycle不存在・Owner外 | 404、副作用なし |
| upcoming以外 | 400、Cycleを変更しない |
| 現在Cycleの次Cycleでない・個別調整Cycleと重複 | 400 `VALIDATION_ERROR`、既存Cycleを変更しない |
| Runtime lock | 423、副作用なし |
| 同じidempotencyKey | 保存済みCycleを返す |

## テストケース

- [状態遷移] upcomingの次Cycle開始で、前Cycleがcompleted、対象がactive、startsAt / endsAtが再計算される
- [代表値] activeがない場合のupcoming開始
- [状態遷移] 同じKeyの再送は同じCycleを返し、副作用を増やさない
- [デシジョンテーブル] completed / active / 非連続upcomingは拒否する
- [セキュリティ境界] 他Owner / 不存在Cycleは404で副作用なし
- [状態遷移] Runtime lock中は423でCycle / Issue / Activity / Outbox / Receipt不変
