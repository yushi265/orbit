# FEAT-inbox-notifications AI-DLC 振り返り学習ノート

## メタ

- ticket: FEAT-inbox-notifications
- 機能概要: Inbox通知の既読化と対象遷移を実装する。
- Stage宣言の結果: Tier 1 / spec / TDD / 品質ゲート / self-reviewを実行。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-24 / 2026-08-24

## 各Stageの気づき

| Stage | 気づき |
|---|---|
| 1 要件整理＋Stage宣言 | Notification model / Store / APIは存在し、UIのread操作だけが未接続だった。 |
| 2 spec作成 | 通知生成を先取りせず、既存データのread / navigationに限定した。 |
| 3+4 TDD | strict read契約、Store/APIのOwner / lock / replay、Inboxの個別・全件既読を分けて検証した。 |
| 5 品質ゲート | 19 files / 100 tests、typecheck / lint / format / build / refereeを通過した。 |
| 6 self-review | 個別retry、Cycle deep link、deleted通知、fieldErrors、empty導線の指摘を反映した。 |
| 8 成果提示 | 変更をmainへコミットし、Mobile / PWA polishへ引き継ぐ。 |

## 振り返り（KPT）

### Keep

- 既存Bootstrap、Notification Receipt、Router deep linkを再利用する。

### Problem

- [scope] Notification生成は発火元が多いため、Inbox read機能と分離した。
- [test] Browser smokeは実際のIssue通知遷移を確認し、生成ルールとD1統合はRelease hardeningへ残した。

### Try

- read mutationのstrict入口とUI遷移を同じ契約テストで固定する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|---|---|---|
| Notification生成とInbox readを別ボルトに分離する | create-spec | 実施中 |
| read mutationのstrict入口と対象遷移を同じ契約で確認する | self-review | 完了 |
