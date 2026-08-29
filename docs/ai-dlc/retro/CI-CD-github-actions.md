# CI-CD-github-actions AI-DLC 振り返り学習ノート（retro note）

## メタ

- ticket: CI-CD-github-actions
- 機能概要: GitHub Actionsで品質ゲートとSecret検知を実行し、Cloudflare Workers BuildsをCDの正本として責務分担を明確にする。
- Stage 宣言の結果: Stage 0+1 / 2 / 3+4 / 5 / 6 / 8を実行。Tier 2。Gate 2は委任。
- トークン実測: 未計測
- 着手日 / 完了日: 2026-08-29 / 2026-08-29

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | Cloudflare Workers BuildsのCD設定は既に整っていたため、GitHub Actionsへデプロイ経路を追加すると二重化する。 |
| 2 spec 作成 | `build:production`でViteのCloudflare環境を選択する既存契約を、CIとWorkers Buildsの両方で共有する必要がある。 |
| 3+4 TDD | 契約テストを先に追加した。最初はx64 Nodeとarm64 optional dependencyの不一致でVitestが起動前停止したが、既存arm64 Node経路へ切り替えて7 tests GREENを確認した。 |
| 5 静的解析 | arm64 Node経路でformat・lint・typecheck・全test・production build・refereeを完了した。 |
| 6 セルフレビュー | 3観点レビューでGitleaksのイベント差分scanと契約テストの接頭辞一致による逃げ道を検出し、全履歴scan・job境界・完全一致・異常系へ修正した。 |
| 8 成果提示 | AC・品質ゲート・未確認範囲・コミット対象を提示し、Gate 3承認待ち。 |

## 振り返り（KPT）

### Keep（効いた・次も続ける）

- 既存のWorkers Builds設定とリポジトリのproduction build scriptを先に照合する。

### Problem（詰まった・摩擦・想定外）

- `[tooling]` ローカルのx64 Nodeとarm64用optional dependencyが不一致で、標準コマンドが起動前に停止した。
- `[security]` Gitleaks Action v3の`fetch-depth: 0`だけではイベント差分scanに留まり、全履歴scanの契約を満たさなかった。
- `[tdd]` 生テキストの接頭辞一致は、`pnpm lint-removed`を`pnpm lint`として通す逃げ道になった。
- `[gate]` Branch protectionを対象外としたため、設定前は`main`への直接pushでCIとWorkers Builds CDが独立起動する。

### Try（次ボルト以降でフローをこう変える）

- CI workflowの契約テストは、job境界・stepの完全一致・禁止条件の異常系を最初から含める。
- GitHub Actionの内部挙動が契約（全履歴scan）と異なる場合は、Actionの補助利用と明示CLIの最終判定を分ける。
- mainを保護ブランチにする場合は、CIの必須status checkとWorkers Buildsのデプロイ開始条件を別ユニットで合意する。

## フロー改善アクション

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| CI workflowのjob境界・完全一致テストを標準化 | create-spec / tdd-cycle | 反映済み（本spec） |
| Actionの内部scan範囲を仕様確認する | codekb shared.md | 反映済み |
