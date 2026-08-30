# FEAT-home-project-inbox-ux: Home・Project詳細・Inbox UX

## 概要

Homeを「今日やることが分かる」入口へ再構成し、Project詳細をIssue一覧相当の作業画面へ刷新する。
ProjectごとのIssue表示設定はサーバーへ保存して別端末へ同期し、Inboxには通知の役割と使い方を明示する。

## 対象範囲

- 対象レイヤー: [shared](./shared.md) / [data](./data.md) / [service](./service.md) / [ui](./ui.md)
- 対象ドメイン: home / projects / issues / views（表示設定） / notifications（Inbox UX）
- 対象環境: 既存のMemory Store、D1 Snapshot bridge、同一Origin API、Desktop / Tablet / Mobile
- 対象外（やらないこと）:
  - Inbox通知の新規生成ルール、Scheduler、Push通知、外部配送
  - 通知種別ごとの設定CRUD、通知削除・スヌーズの新規API
  - Issue一覧のSaved View仕様変更、複雑なAND / OR Filter、Project graph / milestone
  - Homeカードのユーザー自由配置・カード構成のサーバー保存
  - Access認証、所有者モデル、D1正規化テーブルの再設計

## ユニット計画

| # | ユニット | 含むAC | 依存 | 状態 |
|---|---|---|---|---|
| 1 | Project表示設定の共有契約・永続化 | AC-3, AC-4 | — | 完了 |
| 2 | Project Issue workspace | AC-2, AC-3, AC-5 | Unit 1 | 完了 |
| 3 | Home actionable dashboard | AC-1, AC-5 | Unit 2 | 完了 |
| 4 | Inbox guidance UX | AC-4, AC-5 | Unit 1 | 完了 |

## 受け入れ基準（AC）

- [x] **AC-1**: Homeは本人の表示名と本人のTimezoneに基づく日付を表示し、期限超過、今日が期限、今日から7日以内が期限、Current Cycleの未完了Issue、更新日時順の最近更新Issueを、該当するものから確認できる。各Issueと主要カードからIssue一覧、Issue詳細、Cycle、Projectへ移動でき、該当0件の状態では次の操作を案内する。
- [x] **AC-2**: `/projects/:projectId` はProject一覧の下に詳細を埋め込まず、Project概要・Status・期限・進捗と、対象Projectに限定したIssue workspaceを表示する。Issue workspaceは既存Issue一覧と同じList / Board、検索、Status / Priority / Label / 期限Filter、並び順、完了Issue表示切替、インライン更新、一括更新、手動並び替えを提供し、完了カテゴリだけを非表示にできる。CanceledカテゴリのIssueは完了Issueとして扱わない。
- [x] **AC-3**: ProjectごとのIssue workspace表示設定（List / Board、検索、Status / Priority / Label / 期限Filter、並び順、完了Issue表示切替）はOwner scopedなサーバー状態として保存され、別端末のBootstrap再取得後に同じProjectで復元される。設定未保存のProjectは定義済み初期値で表示する。
- [x] **AC-4**: Project表示設定のMutationは既存のOwner境界、same-origin、idempotencyKey、Runtime lockを守る。同じKey・同じRequestの再送は同じ設定を返し、同じKey・異なるRequestは409、入力不正は400、存在しないまたはOwner外Projectは404、Runtime lock中は423になり、設定を部分更新しない。Inboxは既存通知の既読化・対象遷移を維持したまま、Inboxの役割、通知の読み方、通知がない場合の次の行動を画面上で説明する。
- [x] **AC-5**: Home、Project詳細、InboxはLoading、空、保存中、400 / 404 / 409 / 423 / 500系エラー、成功状態を既存のエラー表示方針で示し、Pointer / Keyboardの双方で主要操作を実行できる。Desktop（1200px以上）、Tablet（768〜1199px）、Mobile（767px以下、390pxを含む）で横方向の表示崩れを起こさない。

## アーキテクチャ / レイヤー間フロー

```text
GET /api/v1/bootstrap
  ├─ Home selectors ───────────────→ Home actionable cards / lists
  ├─ projects + issues + states ───→ Project detail Issue workspace
  └─ projectDisplayPreferences ────→ Project settings draft

Project workspace control change
  └─ PATCH /api/v1/projects/:projectId
       { idempotencyKey, displayPreferences }
          ↓
       Owner-scoped OrbitStore
          └─ OrbitStoreSnapshot / D1 snapshot bridge

Bootstrap.notifications → Inbox guidance + existing read / target navigation
```

レイヤー間の具体的な型・入力・出力は各レイヤー specを正本とする。

## エラー・ログ方針（横断サマリ）

| シナリオ | shared | data | service | 表示層の挙動 |
|---|---|---|---|---|
| Project不存在 / Owner外 | ID形式を検証 | 業務データ不変 | 404 `RESOURCE_NOT_FOUND` | Not FoundとProjectsへ戻る導線 |
| 表示設定入力不正 | strict schema、fieldErrors | 保存しない | 400 `VALIDATION_ERROR` | draftを保持し、入力箇所またはalertで示す |
| 同じKeyの異なるRequest | request hash不一致 | 保存しない | 409 `IDEMPOTENCY_KEY_REUSED` | 最新Bootstrapを取得しConflictを示す |
| Runtime lock | — | 保存しない | 423 `OPERATION_IN_PROGRESS` | draftを確定せずRetry / Overlayを示す |
| Bootstrap / API障害 | — | — | 500 / transport分類 | 既存表示を保持しRetryを示す |
| Inbox対象なし | — | — | — | Inboxに留まり、通知の役割と次の行動を示す |

## テスト戦略

| AC | 単体 | レイヤー内結合 |
|---|---|---|
| AC-1 | Home集計・Timezone日付・期限分類 | HomeViewの表示とIssue / Cycle / Project遷移 |
| AC-2 | Project scope・完了判定・Filter / sort mapper | Project detailとIssue mutation / bulk / reorderの接続 |
| AC-3 | 表示設定schema・初期値・正規化 | Snapshot round-trip、別SessionのBootstrap復元 |
| AC-4 | request shape・idempotency入力 | APIのOwner / 400 / 404 / 409 / 423境界、既読遷移 |
| AC-5 | 状態・表示mapper | UIの空 / error / retry、390 / 768 / 1200px構造検査 |

## 既存実装との関係（再利用 / 差分 / 衝突）

- `IssuesView`、`IssueRow`、`IssueCard`、`filterCompletedIssues`、`filterIssuesByProject`、`sortIssues`、既存のIssue PATCH / Bulk / Reorderを再利用する。
- 既存の`ProjectsView`はProject一覧と詳細を同一画面へ描画しているため、`/projects/:projectId`では詳細を主画面とし、Issue workspaceを差し込む構造へ変更する。
- 既存のProject Issue表示はBootstrapのactive Issueを直接mapしている。新実装ではProject IDを固定scopeとしてFilter・選択・Bulk・Reorderへ渡す。
- Project表示設定は既存のD1正規化テーブルを増やさず、`OrbitStoreSnapshot`へOwner scopedな配列として追加する。ProductionのSnapshot CASで別端末同期を実現する。
- 既存の`Bootstrap.notifications`、`PATCH /api/v1/notifications/:notificationId`、Inboxの対象遷移は再利用し、通知生成は追加しない。
- 作業開始前から存在するProject Filter関連の未コミット変更はユーザー変更として保持し、重複実装を避けて統合する。

## 実装に効く制約

- 完了Issue判定は表示名でなくWorkflow category `completed`だけを使い、`canceled`は表示対象から除外しない。
- Project workspaceの全Issue操作は対象ProjectのIssue IDだけをUIから選択し、既存Owner / version / lock / idempotency契約を通す。
- Project表示設定の初期値は `mode=list`、Filter全件、`showCompleted=true`、`order=updated_desc` とする。
- 期限超過・今日・7日以内の判定は本人PreferencesのIANA timezoneで行う。7日以内は今日を含む範囲としてUI上は今日と近日期限を分けて表示する。
- Homeは既存Bootstrapから導出し、Home専用APIを追加しない。
- Inboxの既存通知状態・対象遷移を壊さず、説明追加だけで通知生成を先取りしない。
- 表示設定Mutationは業務データのActivity / Outboxを増やさず、既存Receiptで再送を制御する。

## 判断根拠 / 未決事項

- Project詳細のIssue workspaceは既存`IssuesView`を共通化して使う。別実装を作るとList / Board、Filter、Bulk、Rollbackの挙動が分岐するため。
- 表示設定はlocalStorageではなくSnapshotへ保存する。ユーザーが別端末同期を明示したためであり、既存のProduction Snapshot CASを使えば新しいD1 Migrationを避けられる。
- Project表示設定専用の新Routeは増やさず、既存Project PATCHへ`displayPreferences`サブ契約を追加する。Route treeとOwner入口を増やさず、metadata PATCHとはstrict branchで分離する。
- Inboxは通知生成と分離する。今回確定した要望は使い方の説明であり、生成ルールまで同時に入れるとCycle / Run / 期限の発火契約が膨らむため。
- 既存`dev-owner`のサンプル通知seedはローカルsmoke用fixtureとして維持し、本チケットの通知生成ルール・本番発火契約には含めない。
- Homeの「近日期限」はユーザー回答に基づき今日から7日以内と確定した。
- 未決事項なし。Gate 2では、本書と各レイヤーの具体契約・テストケースを承認対象とする。
