# 開発ハーネス 取扱説明書

このリポジトリは、`orbit` を **AI 駆動開発・仕様書駆動開発・TDD** で進めるためのガードレール（ハーネス）です。本書はハーネスの**正本**（AI + 人間共通）として、運用方法・構成・機械強制・**導入時に差し替える箇所**を網羅します。

> このテンプレートを自分のプロジェクトに導入したら、まず「[7. 導入時に差し替える箇所](#7-導入時に差し替える箇所)」を読んでプレースホルダを埋めてください。

## 関連ドキュメント

| ドキュメント | 役割 | 主な読者 |
|------------|------|---------|
| **本書（`.claude/README.md`）** | ハーネスの取扱説明書（正本）。運用・構成・機械強制・導入手順 | AI + 人間 |
| [`docs/ai-dlc-flow-guide.md`](../docs/ai-dlc-flow-guide.md) | AI-DLC フローの解説（承認ゲート・KPT・FAQ） | チームメンバー・新規参入者 |
| [`docs/harness-design-decisions.md`](../docs/harness-design-decisions.md) | ハーネスの設計判断・代替案・やらないこと | ハーネスを見直す人間 |
| [`docs/index.md`](../docs/index.md) | ドキュメント目次・読み始めガイド | 全員 |
| [`docs/ai-dlc/glossary.md`](../docs/ai-dlc/glossary.md) | 用語の正本（ビジネスインテント / BC / ユニット / ボルト / ステージ / ゲート / Tier / SSoT） | 全員 |

---

## 1. ハーネスとは

AI に実装を任せるほど「設計を読まずに書く」「過剰設計する」「テストを書かない」「境界を壊す」といった逸脱が起きやすい。このハーネスは、それを **二層** で防ぐ。

| 層 | 仕組み | 性質 |
|----|--------|------|
| 機械強制 | `lefthook`（pre-commit）・`.claude/settings.json` の hooks・`.claude/aidlc` の検査 CLI | AI が無視できない。物理的に通さない |
| AI 誘導 | 薄い `CLAUDE.md` ＋ `docs/` ＋ `.claude/rules/`（横断）＋ 各レイヤーの規約 docs | 規律づけ。実装方針を正しい方向へ寄せる |

ルートは横断（リスクティア・spec 駆動・テスト・PR 運用 等）を担い、各レイヤー（プロジェクトが定義）は自分の入口と詳細 docs に委譲する。

---

## 2. どこに何があるか

```
<PROJECT>/
├── CLAUDE.md          … Claude Code の入口（薄いアダプタ・横断）
├── AGENTS.md          … Codex 等 別 AI の入口
├── lefthook.yml       … pre-commit 機械ゲート（gitleaks + プロジェクトの lint/format/test）
├── .claude/
│   ├── README.md      … このファイル
│   ├── settings.json  … hooks 登録・permissions
│   ├── aidlc/         … AI-DLC 決定論エンジン（TypeScript CLI・下記「6. エンジン」）
│   ├── hooks/         … 編集/コミット/セッション時の自動処理（format・sensor・stop-guard 等）
│   ├── rules/         … 横断ルール（下表）
│   ├── agents/        … 実装/レビューのサブエージェント（下表）
│   └── skills/        … 手順スキル（下表）
└── docs/
    ├── index.md            … ドキュメント目次
    ├── architecture.md     … プロジェクト全体像・依存方向（プロジェクトが記述）
    ├── ai-dlc/             … 用語・retro・learnings・codekb（AI-DLC 運用資産）
    └── spec/_TEMPLATE/     … 薄い実装 spec の雛形
```

各レイヤー（例: `data` / `service` / `ui`）は、それぞれの入口ドキュメントと詳細 docs をプロジェクトで用意する（AI-DLC の実装エージェントはそれを読んでから実装する）。

### `.claude/rules/` 一覧（横断ルール）

| ルール | 何を守るか |
|--------|-----------|
| [`risk-tiers.md`](./rules/risk-tiers.md) | リスクティア判定。人間ゲートの深さと spec 要否を決める |
| [`spec-driven.md`](./rules/spec-driven.md) | 実装前に spec を必読。不足/曖昧なら人間へ確認 |
| [`simplicity.md`](./rules/simplicity.md) | シンプルさ最優先（KISS/YAGNI・Rule of Three） |
| [`testing.md`](./rules/testing.md) | TDD・カバレッジ 80%+・技法マッピング |
| [`task-and-pr.md`](./rules/task-and-pr.md) | タスク分割・品質ゲート・PR/コミット規約 |

各ルールの照合チェックリストは [`rules/verification/`](./rules/verification/)（self-review 時に読む）。同梱は **AI-DLC のフロー機構**のみ。設計規約（レイヤー境界・セキュリティ・エラー/ログ・非同期など）が要るプロジェクトは `.claude/rules/` に追加する。

### `.claude/agents/` 一覧（サブエージェント）

実装エージェントは、担当レイヤーの入口ドキュメント・docs を**必ず読んでから** TDD で実装する。使用モデルは各ファイルの frontmatter `model:` が単一ソース（省略時は `inherit` = メイン会話と同じ）。
モデル割り当ては**オーケストレーター型**: 上位モデル（メインループ＝オーケストレーター）が割り振り・契約・監査を持ち、下位モデル（worker 層 = 既定 `sonnet`）が実装・調査・レビュー実働を実行して返す。**レビュー報告も worker の成果物として、オーケストレーターが監査（受領検査 + 裏取り + 抜き取り）してから採用する**（[self-review](./skills/self-review/SKILL.md)）。設計の正本は [ai-dlc-flow の「モデル階層」節](./skills/ai-dlc-flow/SKILL.md)。

| エージェント | 層 / モデル | 対象 |
|------------|-----------|------|
| [`implementer`](./agents/implementer.md) | worker / `sonnet` | 割り当てられたレイヤーの spec を契約に TDD 実装（レイヤー固有の規約・コマンドはそのレイヤーの docs に委譲） |
| [`impl-auditor`](./agents/impl-auditor.md) | 節目監査 / `inherit` | 実装全体監査（節目・読み取り専用。`impl-audit` スキルから起動） |
| [`code-reviewer`](./agents/code-reviewer.md) | worker / `sonnet` | コミット前レビュー・観点 A（設計準拠）+ C（既存実装整合）（読み取り専用・`self-review` から） |
| [`spec-conformance-reviewer`](./agents/spec-conformance-reviewer.md) | worker / `sonnet` | コミット前レビュー・観点 B（AC ↔ 証跡・スコープ外・契約値一致・AC 引用整合）（読み取り専用・`self-review` から） |
| [`test-quality-reviewer`](./agents/test-quality-reviewer.md) | worker / `sonnet` | コミット前レビュー・テスト品質（テストケース機械突合・境界値整合・アンチパターン検出）（読み取り専用・`self-review` から） |

### `.claude/skills/` 一覧（手順スキル）

| スキル | 手順 |
|--------|------|
| [`ai-dlc-flow`](./skills/ai-dlc-flow/SKILL.md) | **機能実装の全体フロー**（要件整理 → design doc → TDD → 品質ゲート → セルフレビュー → コミット。人間承認ゲート付き）。下記のオーケストレーター |
| [`import-ticket`](./skills/import-ticket/SKILL.md) | チケット（例: Jira）を取り込み、本文・AC を要件整理の入力に整形 |
| [`create-spec`](./skills/create-spec/SKILL.md) | `docs/spec/` への spec 作成（レイヤー間 IF → テストケース一覧・ユニット計画） |
| [`tdd-cycle`](./skills/tdd-cycle/SKILL.md) | TDD（RED→GREEN→REFACTOR）のレイヤー別実行 |
| [`self-review`](./skills/self-review/SKILL.md) | AI セルフレビュー（観点別 3 体並列。コミット提案前に実施） |
| [`impl-audit`](./skills/impl-audit/SKILL.md) | 実装全体監査レポート（4 軸: 要件 / 設計 / 品質 / 残課題。節目に使用） |
| [`impl-reset`](./skills/impl-reset/SKILL.md) | 実装の一括リセット（対象承認 → 削除 → ハーネス残存の検証） |
| [`retro-triage`](./skills/retro-triage/SKILL.md) | retro note の未対応 Try 棚卸し＋ハーネス剪定（人間の明示指示で実行） |
| [`bolt-replay`](./skills/bolt-replay/SKILL.md) | ボルトの経緯を機械記録から時系列に再構成（read-only。Gate 3 の審査材料） |
| [`aidlc-init`](./skills/aidlc-init/SKILL.md) | **このテンプレを導入した直後の初期設定**（レイヤー・言語・検証コマンド・高リスク要素・プロジェクト固有 sensor の要否を対話で設定し、config 群を埋める） |

---

## 3. 日々のワークフロー（実装の流れ）

機能実装・修正は **AI-DLC フロー**（[`ai-dlc-flow`](./skills/ai-dlc-flow/SKILL.md) スキル）に従う。**全タスクが同じ単一適応フローに入る**（冒頭の Stage 宣言で実行/スキップを決定し、複雑さに応じて詳細度を適応）。

- **必須 Stage**（スキップ不可・品質の最低保証ライン）: TDD・静的解析・セルフレビュー・コミットゲート。
- **条件付き Stage**（基準付き）: spec 作成（Stage 2）。基準は [`ai-dlc-flow`](./skills/ai-dlc-flow/SKILL.md) と [`spec-driven.md`](./rules/spec-driven.md)。
- ゲートの深さは**リスクティア**（[`rules/risk-tiers.md`](./rules/risk-tiers.md)）連動。Tier 3 は Gate 1 が宣言のみ。Gate 2 は Gate 1 での明示委任で事後確認化できる（Gate 3 は委任不可）。
- 中断 → 再開は `docs/spec/<TICKET>-*/progress.md` から復元する。

---

## 4. 機械強制の仕組み（settings.json / lefthook / hooks）

> ハーネス自体の健全性（依存導入・フック配線・既知の環境罠・正本ミラー同期）は
> `pnpm -C .claude/aidlc run doctor -- --fast` で自己診断できる（read-only）。SessionStart で `--fast` サブセットが
> 自動実行され、欠落時のみ NOTE が出る。新規 checkout / worktree 追加時はまず doctor を 1 回実行する。

### 編集時の自動整形（hooks）

`.claude/settings.json` の `PostToolUse(Edit|Write)` が `.claude/hooks/format.sh` を呼び、編集ファイルを整形する（orbitではGo=gofmt / JS・TS系=oxfmt）。失敗してもブロックしない（最終防衛線はlefthook）。

同じ `PostToolUse` で `aidlc-sensor.sh`（編集ファイルへの sensor 実行）と `aidlc-engine-nudge.sh`（spec 作成時の engine state 着火リマインド）が advisory で走る。

### コミット時のゲート（lefthook）

`lefthook.yml` の `pre-commit` が実行する:
- `gitleaks`（secret 混入検知・スタック非依存）
- **プロジェクトの lint / format / test**（テンプレではコメントアウトの例。自分のスタックに置き換えて有効化する）
- `aidlc-anti-tamper`（advisory・テスト改ざん検出）/ `aidlc-retro-surface`（advisory・学び候補提示）/ `aidlc-drift-check`（ブロッキング・正本↔ミラー同期）

`commit-msg` フックが Conventional Commits 規約（`<type>(<scope>): 説明`）を強制する。手元での実行:

```bash
pnpm exec lefthook run pre-commit
pnpm exec lefthook run commit-msg <コミットメッセージファイルパス>
```

**CI（GitHub Actions 等）で同等チェックを PR/push 時に再実行することを推奨**（ローカル hook を経由しないコミットの素通り対策）。CI 定義はプロジェクトで用意する。

### permissions

`settings.json` の `permissions.allow` に安全な読み取り系コマンド（git 読み取り・lefthook・engine の検査 CLI）を許可し、確認プロンプトを減らしている。プロジェクトのテスト/lint/format コマンドはここに追加する。外向き・不可逆な操作（`git commit` / `git push` / `git merge` / `gh pr create` / `gh pr merge`）は `permissions.ask` に置き**毎回確認**。破壊的コマンド（force push・`rm -rf`・secret 読み取り等）は `deny`。

---

## 5. ドキュメントの所在（自己完結）

設計判断・規約・実装仕様はすべてこのリポジトリ内に置き、ハーネス単体で実装判断が完結するようにする。

- 横断方針: `docs/architecture.md` ＋ `.claude/rules/`
- レイヤー詳細: 各レイヤーの docs（プロジェクトで用意）
- タスク個別の制約: `docs/spec/<TICKET>-*/`（実装に必要な制約を要約）
- Codex のホスト差分・worker委譲・権威検証: [`../docs/ai-dlc/codex-adapter.md`](../docs/ai-dlc/codex-adapter.md)

---

## 6. エンジン（`.claude/aidlc`）

AI-DLC の Stage routing・Gate 判定・各種検査を機械可読化した **TypeScript CLI（advisory）**。純粋関数コア + 注入データ（JSON 設定）の設計で、スタック非依存。正本は `.claude/skills/ai-dlc-flow/SKILL.md` と `.claude/rules/risk-tiers.md`（engine はそのミラー）。

| CLI | 役割 |
|-----|------|
| `report` / `next` | ボルトの機械可読 state（Stage/Gate 遷移）を audit ログ付きで記録・次の一手を算出 |
| `referee-check` | Stage 5 の品質ゲートを権威再実行（`referee.config.json` のコマンド表） |
| `sensor` | 編集ファイルへの sensor 実行（`sensors.manifest.json` の登録） |
| `checkreturn` | サブエージェント返答の受領検査（`return-schemas.json`） |
| `learnings` / `ledger` / `scope` / `stopguard` / `doctor` | 学び集約・タスク台帳検査・scope 解決・停滞検知・自己診断 |

セットアップ・テスト:

```bash
pnpm -C .claude/aidlc install --ignore-workspace     # 依存導入（SessionStart で自動実行される）
pnpm -C .claude/aidlc test        # engine の単体テスト
pnpm -C .claude/aidlc typecheck   # 型チェック
pnpm -C .claude/aidlc run doctor -- --fast  # ハーネス自己診断
```

engine を持ち込まなくても、markdown のフロー（skills/rules/docs）＋ progress.md 手運用で AI-DLC は回る（engine は advisory・observability の補助）。各 hook は engine 未導入なら無音で通す（フェイルセーフ）。

---

## 7. 導入時に差し替える箇所

このテンプレートを自分のプロジェクトに被せたら、次のプレースホルダを埋める（それ以外は原則そのまま動く）。
**[`aidlc-init`](./skills/aidlc-init/SKILL.md) スキル（`/aidlc-init`）が、レイヤー・言語・検証コマンド・高リスク要素・プロジェクト固有 sensor の要否を対話で聞いて下表の config 群を反映する**（`CLAUDE.md` / `AGENTS.md` / `.claude/rules/*.md` の細部は必要に応じて手動で調整。全部を手動で埋めてもよい）。

| ファイル | 差し替える内容 |
|---------|--------------|
| `.claude/aidlc/referee.config.json` | プロジェクトのレイヤーと検証コマンド（`<...>` を実コマンドに） |
| `.claude/aidlc/src/sensors/spec-sections.ts` | レイヤー別 spec ファイル名（`LAYER_FILES` / `UI_LAYER_FILES`）をレイヤー構成に合わせる |
| `.claude/aidlc/tier-triggers.json` | Tier 1（高リスク）に該当する変更の glob + 内容パターン |
| `.claude/aidlc/scopes.json` の `sensors` | 使う sensor 名（同梱は汎用 4 種のみ・追加は任意） |
| `.claude/aidlc/sensors.manifest.json` | sensor レジストリ（同梱は汎用 4 種・プロジェクト固有 sensor を足すならここに登録） |
| `lefthook.yml` | プロジェクトの lint / format / test コマンド（コメントアウトの例を有効化）。**gitleaks を使わないなら該当行を削除**（バイナリ未導入だと pre-commit が落ちる） |
| `.claude/settings.json` の `permissions.allow` | プロジェクトの安全な開発コマンド |
| `.claude/hooks/format.sh` | 編集時の整形コマンド（プロジェクトの言語に合わせる） |
| `.claude/rules/*.md` | レイヤー名・具体規約（例で残した箇所をプロジェクトの実体に） |
| `docs/architecture.md` | プロジェクトのアーキテクチャ（雛形の枠を埋める） |
| `docs/spec/_TEMPLATE/_layer.md` | レイヤー別 spec の雛形（関与レイヤーごとに `<layer>.md` を作る） |
| `CLAUDE.md` / `AGENTS.md` | プロジェクトの入口（薄いアダプタ） |

同梱の Tier 1 トリガー（例: `db-schema`）は「高リスク要素の検出例」。プロジェクトの高リスク要素（認証・認可 / データ境界 / 公開 API 等）に合わせて `tier-triggers.json` で足し引きする（[aidlc-init](./skills/aidlc-init/SKILL.md)）。プロジェクト固有のドメインルールを機械化したい場合は、`src/sensors/` に sensor を実装して `sensors.manifest.json` に登録する（編集時フックの起動対象を広げる場合は `.claude/hooks/aidlc-sensor.sh` の対象ファイル種別 case も追随させる）。

---

## 8. メンテナンス方針

- `CLAUDE.md` は薄く保つ。詳細は `.claude/rules/` と `docs/` に置き、重複転記しない。
- ハーネスが実態（実装・決定）と乖離したら、その場で直す（「後で直す」は禁止）。
- ルールを増やすときも KISS/YAGNI を自身に適用する。同じパターンが繰り返し必要になり、採用理由が示せた時点で追加する。

---

## 9. 設計判断（なぜこの構成か）

ハーネスの構成上の決定・代替案・「やらないこと」は [`../docs/harness-design-decisions.md`](../docs/harness-design-decisions.md) に集約する（ADR は設けない）。日常作業で参照する必要はないが、ハーネスを見直す時の履歴として残す。
