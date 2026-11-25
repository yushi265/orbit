# FEAT-daily-digest-email AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: FEAT-daily-digest-email
- 機能概要: Cloudflare Email Sending（Workers Free）と Cron Trigger で、毎朝7:30 JSTに期限切れ・今日期限・Cycle未完了のIssueをメール1通で送る
- Stage 宣言の結果: Tier 1（cycle-automation の tier-trigger）。全 Stage 実行、Gate 2 委任なし
- トークン実測: 未計測
- 着手日 / 完了日: 2026-11-25 / 2026-11-25

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 2 spec 作成 | `main` は既定エントリのままで `src/server.ts` が自動で拾われると書いたが誤り。ビルド成果物の grep で発覚し、spec を先に直してから `main` を変えた |
| 3+4 TDD | `src/server-entry.test.ts` は実装と同時に書き、RED を先に確認していない |
| 6 セルフレビュー | Must 0（Claude 3体）。PR後のCodexレビューで、送信対象をsnapshot件数でなく`OWNER_USER_ID`で決めるべき、送信失敗の元例外に宛先が残る、不正な期限1件で全体が止まる、の3点を指摘され修正。除外確認が `タイトル\n` 前提で空振りする、並び順テストが indexOf=-1 でも通る、format 対象に新規ファイルが入っていない、を修正 |

## 振り返り（KPT）

### Keep
- ビルド成果物を grep し、`vite preview` の `/cdn-cgi/handler/scheduled` で scheduled を実際に起動して確認した

### Problem
- `[spec]` フレームワークのエントリ解決を、コードを読んだだけでビルド確認前に spec へ書いた
- `[tdd]` 小さい配線ファイルのテストを後追いにした
- `[security]` 送信対象と例外内容の個人情報の扱いを、Claudeのセルフレビューでは拾えずCodexレビューで拾った
- `[tooling]` `format` / `format:check` が個別列挙なので、`src/` 直下の新規ファイルが自動では検査対象にならない

### Try
- 一人専用でも「対象Owner」はHTTP認証と同じ根拠（`OWNER_USER_ID`）で決める。データ件数から推測しない
- 例外を投げ直すときは、ログに出す文字列だけでなく投げる例外の中身にも個人情報が無いかを見る
- Worker の entry や binding を変える spec は、契約確定の前にビルド成果物で確認する
- 配線ファイルも「テスト追加 → 失敗確認 → 実装」の順を崩さない

## フロー改善アクション

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| Worker entry / binding 変更はビルド成果物で確認してから spec に書く | docs/ai-dlc/codekb/shared.md | 反映済み（本ボルト） |
| 配線ファイルも test-first | .claude/skills/tdd-cycle/SKILL.md | 見送り（既存ルールで足りる。運用で守る） |
