# AI-DLC Codex 実行アダプタ

この文書は、AI-DLC の正本である [`ai-dlc-flow`](../../.claude/skills/ai-dlc-flow/SKILL.md) と
横断ルール（[`../../.claude/rules/`](../../.claude/rules/)）を Codex で実行するためのホスト差分を定義する。
Stage / Tier / Gate / spec / TDD の意味は変更しない。

## 入口と正本

- Codexの入口はルートの [`AGENTS.md`](../../AGENTS.md) と本書。
- AI-DLCの正本は `.claude/skills/` と `.claude/rules/`。`.codex/` はCodex用の配線・委譲定義であり、ルールを再定義しない。
- プロダクト要件の正本は [`REQUIREMENTS.md`](../../REQUIREMENTS.md)。実装予定の依存方向は [`../architecture.md`](../architecture.md)。
- 人間ゲート（Gate 1 / Gate 2 / Gate 3）は省略しない。Codexが自分で承認済みにはしない。

## 現在のプロジェクト状態

現在は要件定義・ハーネス導入段階で、アプリ本体のルート依存関係・lint・format・testコマンドは未設定である。
そのため、導入直後に実行できる検証は AI-DLC engine 自体とハーネスの構造検査に限られる。
アプリ実装を開始したら、Stage 5の検証コマンドを `.claude/aidlc/referee.config.json`、`lefthook.yml`、
本書へ同じ変更で追加する。

## 開始前

1. `AGENTS.md`、`REQUIREMENTS.md`、`docs/index.md`、`docs/architecture.md` を読む。
2. タスクに応じて `.claude/rules/` の risk-tiers / spec-driven / simplicity / testing / task-and-pr を読む。
3. チケットに紐づく実装は `docs/spec/<TICKET>-*/` を確認する。無い・曖昧な場合は推測でコードを書かず、spec作成または人間確認へ戻る。
4. engineを使う場合、依存導入が必要なことを人間に明示してから実行する。

```bash
pnpm -C .claude/aidlc install --ignore-workspace
pnpm -C .claude/aidlc run doctor -- --fast
```

`doctor` は pnpm の組み込みコマンド名と衝突するため、`run doctor --` 形式で呼ぶ。
環境制約でengineを実行できない場合は、GREENと扱わず「未実測（環境制約）」と記録する。

## Stage と担当

| Stage | Codexでの担当 | 完了条件 |
|---|---|---|
| 0+1 | メインループ | 要件、Tier、Stage宣言、未決事項、Gate 1承認を確定 |
| 2 | メインループ。調査のみworkerへ委譲可 | 既存実装調査、レイヤー間契約、spec、テストケース一覧を確定。Gate 2承認または明示委任 |
| 3+4 | レイヤー別Codex worker | specのテストケースを起点にRED → GREEN → REFACTOR。担当範囲外を変更しない |
| 5 | メインループ | workerの自己申告ではなく、検証コマンドを独立再実行 |
| 6 | Codex worker 3体または別コンテキスト | code / spec-conformance / test-quality を独立レビューし、メインループが裏取り・裁定 |
| 8 | メインループ + 人間 | ACと証跡、未確認範囲、Gate 3、コミット対象を提示。承認前にcommitしない |

## Codex worker の委譲契約

`.codex/agents/*.toml` はCodexの役割入口で、役割の詳細は対応する `.claude/agents/*.md` が正本である。
委譲時は次の契約をプロンプトへ明示する。

```text
あなたの役割は <role>。
必読: AGENTS.md / REQUIREMENTS.md / docs/spec/<TICKET>-*/ の該当ファイル / .claude/rules/*.md / <role定義>
担当範囲: <レイヤーまたはレビュー観点>
書込範囲: <許可するファイルまたは読み取り専用>
spec外の設計判断、不明点の推測、担当外ファイルの変更は禁止。
完了時は変更ファイル、実行コマンド、結果、未確認範囲、次の一手を返す。
```

`implementer` は `## RED 証跡`、`## GREEN 証跡`、`## 変更ファイル一覧`、`## 申し送り` を返す。
レビュー担当は読み取り専用とし、「問題なし」も差分とコマンドで裏取りする。

## Claude hooks の Codex 代替

`.codex/hooks.json` は、Codexが対応するイベントで次の既存hookを呼び出す配線である。
`codex-edit-adapter.sh` が Codex の編集payloadを Claude hook が期待する `tool_input.file_path` へ変換する。

| Claude Code | Codex |
|---|---|
| SessionStart bootstrap | 初回に `pnpm -C .claude/aidlc install --ignore-workspace` を明示実行 |
| PostToolUse formatter | Stage 5で `prettier --check` 等を独立実行。現段階はアプリformatter未設定 |
| PostToolUse sensor | spec・codekb・learnings・高リスク変更後に必要なファイルへ手動実行 |
| spec編集時のengine nudge | Stage/Gate完了ごとに `report` を手動実行 |
| PreToolUse context guard | 委譲前に `progress.md` のworklogを確定。Codex transcript形式は前提にしない |
| Stop stop-guard | 中断は `report <state> park`、再開は `unpark`。自動検査は期待しない |

engine stateを使う場合の例:

```bash
pnpm -C .claude/aidlc run report -- state/<TICKET>.md init scope=feature
pnpm -C .claude/aidlc run report -- state/<TICKET>.md stage-done 0+1
pnpm -C .claude/aidlc run report -- state/<TICKET>.md gate-approve gate1
```

stateはadvisoryであり、Gate承認の代替ではない。

## Stage 5 の権威検証

アプリ実装開始後の権威コマンドは `referee.config.json` に定義し、workerの報告だけでGREENにしない。
少なくとも次をプロジェクトの実コマンドへ置き換えて独立実行する。

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm -C .claude/aidlc run referee-check -- --layer all
```

未設定のコマンドは実行済みと報告しない。Cloudflare Workers runtimeなどの環境制約で失敗した場合も、
「未実測（Codex環境制約）」として記録し、CIまたは別環境で再検証する。

## Codex対応の完了条件

1. 新規Codexセッションが `AGENTS.md` から本書へ到達できる。
2. Stage宣言、Gate、spec、progress、TDD証跡がClaude Codeと同じ意味で残る。
3. worker役割を明示プロンプトと `.codex/agents/` で再現できる。
4. Claude hooksが動かなくても、Stage 5・Stage 6・Gate 3の証跡が欠落しない。
5. Codex経路にClaude固有のMCP名・hook入力・モデル名を必須条件として残さない。
