# 共有契約

## 担保AC

- **AC-18**: 成功したRunをSettingsの最後の実行として表示できる。

## 契約

Bootstrapのbackgroundへ`lastRun: PublicRunViewModel | null`を追加する。これはOwnerの最新requested_atのRunで、既存PublicRunの全statusを許す。Owner ID、Lease token、内部stepCursors、receipt等の非公開値は既存publicRunで除去する。

既存`background.run`はpending/running/paused/failedの進行中・復旧対象だけを返す。`GET /api/v1/background-runs/current`のnull/active契約は変更しない。`BootstrapViewModel.background.lastRun`はoptionalとし、旧Snapshot/既存test fixtureを受け入れる。StoreのBootstrapは常にlastRunを返す。

## テスト

- [状態遷移] 初期null、成功Runを含む最新結果、active優先の画面表示、再読込後も最後の実行を表示する。
- [アクセス境界] 他Ownerの最新Runを返さず、publicRunの非公開値を返さない。
