# FEAT-cycle-settings: Cycle期間・開始曜日設定

## 概要

SettingsからCycleの期間と開始曜日を本人が設定できるようにする。
保存した設定をBootstrapで返し、未開始のUpcoming CycleだけをユーザーTimezoneの開始曜日00:00基準で再計算する。

## 対象範囲

- 対象レイヤー: shared / service / ui（詳細は [shared.md](./shared.md) / [service.md](./service.md) / [ui.md](./ui.md)）
- 対象ドメイン: cycles / settings / production snapshot
- 対象外（やらないこと）: CycleSettingsの`enabled`・Cooldown・futureCountの編集、Cycleの手動作成、Active / Completed Cycleの日付変更、`scheduleOverridden = true`のCycle変更、D1スキーマ／Migration変更

## ユニット計画

単一ユニット（Cycle設定の保存とUpcoming再計算）。既存のBootstrap、Owner / lock / idempotency、D1 Snapshot CASを再利用する。

## 受け入れ基準（AC）

- [x] **AC-1**: Bootstrapは本人の`cycleSettings`（`enabled`、`durationWeeks`、`cooldownWeeks`、`startWeekday`、`futureCount`）を返し、設定の再取得で保存値を保持する。
- [x] **AC-2**: 本人が`PATCH /api/v1/cycle-settings`へ`durationWeeks`（1〜8の整数）と`startWeekday`（0〜6の整数、0=日曜）を送ると保存でき、未知フィールド・範囲外・Owner外・Runtime lock中・同一Keyの異なるRequestを既存契約どおり拒否する。
- [x] **AC-3**: Cycle設定保存後、Active / Completed CycleのID・日時・状態は変わらず、未開始かつ`scheduleOverridden = false`のUpcoming Cycleだけが、本人Timezoneの指定曜日00:00開始・指定期間で番号順に再計算される。`scheduleOverridden = true`のUpcoming Cycleは日時を保持し、後続自動Cycleの計算アンカーになる。
- [x] **AC-4**: 設定変更後に生成される新規Upcoming CycleとCycle開始・完了時の後続自動Cycleは、保存済みの期間と開始曜日を使う。
- [x] **AC-5**: SettingsにCycle設定カードを表示し、期間と開始曜日を選択して保存できる。保存中は対象操作を無効化し、成功時はUpcomingの再計算結果を再表示し、400 / 409 / 423 / 500では入力値と再試行導線を保持する。390pxで横overflowを出さない。

## アーキテクチャ / レイヤー間フロー

```text
Settings UI
  ├─ Bootstrap ← cycleSettings + preferences.timezone
  └─ PATCH /api/v1/cycle-settings
       → shared Zod契約
       → Owner / Runtime lock / idempotency
       → OrbitStore.updateCycleSettings
           ├─ 設定値を保存
           └─ 未調整Upcomingの日付をTimezone基準で再計算
       → production D1 Snapshot Version CAS
```

`startWeekday`はJavaScriptの曜日値（`0=日曜`、`1=月曜`、…、`6=土曜`）とする。自動Upcomingの開始時刻はPreferencesのIANA timezoneにおける指定曜日00:00、終了時刻は開始日から`durationWeeks * 7`暦日後の同Timezone 00:00とする。手動の次Cycle開始は既存CYC-08どおり現在時刻開始を維持する。

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | service | 表示層の挙動 |
|---|---|---|---|
| 入力範囲外・unknown key | `VALIDATION_ERROR` / 400 + fieldErrors | 設定・Cycle・台帳を変更しない | 入力を保持しfield errorを表示 |
| Owner外・設定なし | `RESOURCE_NOT_FOUND` / 404 | 対象Owner以外を変更しない | エラーと再試行を表示 |
| Runtime lock | `OPERATION_IN_PROGRESS` / 423 | 設定・Cycle・Activity・Outbox・Receiptを変更しない | 保存前の入力を保持 |
| 同じKeyの異なるRequest | `IDEMPOTENCY_KEY_REUSED` / 409 | 初回結果以外の副作用を発生させない | 最新Bootstrapを再取得 |
| D1 Snapshot競合 | `D1_WRITE_CONFLICT` / 409 | 競合Sessionを保存しない | 最新値を再取得 |

設定変更のActivity / Outboxは既存のStore記録形式を使い、秘密情報と内部Tokenは記録・返却しない。

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | ViewModelの設定形状 | Bootstrap / Snapshot再読込 |
| AC-2 | duration / weekday Schema | API 400 / 404 / 409 / 423、Store idempotency |
| AC-3 | Timezone曜日00:00計算 | StoreのActive / Completed / override維持とUpcoming再計算 |
| AC-4 | 次Cycle日付計算 | close / start後の後続Cycle生成 |
| AC-5 | Settings表示・保存状態 | Settings callbackとエラー表示 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- `CycleSettings`モデルと既存`OrbitStore`のSnapshot保存を再利用し、D1 Schema / Migrationは追加しない。
- 既存`PATCH /api/v1/preferences`とは混在させず、Cycleドメイン専用の`PATCH /api/v1/cycle-settings`を追加する。
- `BootstrapPayload` / `BootstrapViewModel`へ`cycleSettings`を追加し、Settings UIが現在値を表示できるようにする。
- `createNextCycle`、`closeCycle`、`startCycle`の既存ライフサイクルを再利用し、自動生成日付だけ新しいschedule helperへ集約する。
- 既存のCycle metadata編集で日付を変更するUIはなく、`scheduleOverridden`がtrueの手動調整データだけを保護する。

## 実装に効く制約

- 全Mutationは`withOwner`、same-origin、Owner scope、Runtime lock、idempotencyを通す。
- `durationWeeks`は1〜8、`startWeekday`は0〜6の整数のみ受け付ける。
- Active / Completed Cycleは設定変更で変更しない。
- 自動再計算対象は`status === "upcoming" && scheduleOverridden === false`だけとする。
- 時刻はUTC Unix millisecondsで保存し、表示／計算時の曜日と00:00はIANA timezoneで解決する。
- D1の書き込みは既存のProduction Snapshot Version CASに限定する。

## 判断根拠 / 未決事項

- Settings専用APIを追加する。Preferencesに混在させるよりCycle設定のOwner / lock / 再計算副作用を一つの境界で検証でき、既存APIの入力互換性を保てる。
- 設定変更はActive / Completedを保護し、Upcomingだけを即時再計算する。進行中の作業期間を遡及変更せず、ユーザーが次回以降の計画をすぐ確認できるためである。
- `scheduleOverridden`のUpcomingは手動計画を尊重し、後続の自動Cycleはその終了時刻をアンカーにする。個別調整を上書きしない既存要件と整合する。
- 設定変更時の曜日計算はサーバーのIntl IANA timezoneを使い、クライアントTimezoneや固定オフセットに依存しない。
- 未決事項なし。Gate 1で「Active / Completed維持・Upcomingのみ再計算」の仕様を承認済み、Gate 2は本spec要点承認済みとして進める。
