# aidlc — AI-DLC 決定論エンジン（advisory）

AI-DLC フローの Stage routing・Gate 判定・各種検査を機械可読化した **TypeScript CLI 群**。
すべて **advisory（非強制）** で、markdown のハーネス（`.claude/skills` / `.claude/rules`）と**並走**する。
hard stop は既存の lefthook / CI / 人間ゲートが担い、本群は早期警告・観測・部品化を受け持つ。

- **純粋関数コア + 注入データ（JSON 設定）** の設計で**スタック非依存**。固有性はレイヤー・検証コマンド・高リスク要素の
  設定ファイル（`referee.config.json` / `tier-triggers.json` / `scopes.json` / `sensors.manifest.json`）に集約する。
- **node + tsx の独立パッケージ**（プロジェクトの workspace 外。`--ignore-workspace`）。全モジュール **node:test で TDD**。host が npm/yarn のプロジェクトでも、この engine 用に pnpm/tsx が要る（corepack で pnpm を有効化）。engine は advisory なので、持ち込まず markdown フロー + progress.md 手運用でも AI-DLC は回る。
- 正本は `.claude/skills/ai-dlc-flow/SKILL.md`（Stage）と `.claude/rules/risk-tiers.md`（Tier/Gate）。JSON はそのミラー（drift guard で同期を検査）。

## モジュール一覧

| モジュール | 実体 | CLI（`pnpm -C .claude/aidlc …`） | 役割 |
|---|---|---|---|
| 決定論エンジン | `src/next.ts` + `src/state/` + `stage-graph.json` + `tier-gate-map.json` | `next <state>` / `report <state-file> <event>` | state → 次の 1 手を決定論算出（`next`）＋ 機械可読 state の遷移・audit（`report`） |
| referee-check | `src/referee/` + `referee.config.json` | `referee-check [--layer <l>] [--state <path>]` | Stage 5 の権威再実行を 1 コマンド化。**exit 0 の集合だけが権威 green**（コマンド不在層は unavailable） |
| sensors | `src/sensors/` + `sensors.manifest.json` | `sensor <file>`（PostToolUse から自動発火） | 編集ファイルへの決定論検査（manifest 駆動・id 双方向突合）。同梱は汎用 4 種のみ・プロジェクト固有 sensor は `src/sensors/` に足して manifest 登録 |
| tier tripwire | `src/sensors/tier-tripwire.ts` + `tier-triggers.json` | `sensor <file>`（自動発火） | Tier 1 要素への新規追加行を検知し、宣言 tier が 2/3 なら「停止して再宣言」を勧告 |
| anti-tamper | `src/autonomy/anti-tamper.ts` | `git diff \| referee` | test diff のテスト改ざん検出（自律区間の門番） |
| scopes | `src/scopes/resolve.ts` + `scopes.json` | `scope <name>` / `report … init scope=<name>` | 名前付き scope → 実行 Stage 計画の部品化 + engine state の seed |
| artifact guard | `src/guard/artifacts.ts` + `stage-graph.json` の `produces[]` | `report … stage-done <id>`（自動発火） | Stage 完了の証跡（spec ファイル・テスト増分・progress.md 除去）を機械検証 + Gate 3 前にチェックリスト |
| stop guard | `src/stopguard/` | `stopguard`（Stop hook から自動発火・既定は観測のみ） | ターン終了時に「進行中ボルトの放置」を判定し `state/.stop-guard/log.jsonl` に記録。全経路 fail-open |
| learnings | `src/learnings/` | `learnings` / `learnings persist "<entry>"` / `learnings measure` | retro note 集約（surface）＋ 採用 Try の dedup 追記 + 効果測定（再発マトリクス） |
| task ledger | `src/ledger/` | `ledger <progress.md> [--spec <index.md>]` | progress.md の台帳記法をパースし、未消化タスク・未割当 AC・依存違反を機械検査 |
| summary | `src/state/summary.ts` | `report <state> summary` / `report <state> note tokens=<n>` | audit の機械集計（Stage 消化 / gate 往復 / トークン転記）。Gate 3 のコストレポート |
| return check | `src/returncheck/` + `return-schemas.json` | `checkreturn <schema> [<file>]` | サブエージェント返答の受領検査（必須見出し・自己矛盾） |
| codekb-refs | `src/sensors/codekb-refs.ts` | `sensor <file>`（自動発火） | codekb の `参照:` パス切れを編集時に検査（鮮度規約の機械化） |
| drift guard | `src/drift/` | `pnpm test` に相乗り + lefthook `aidlc-drift-check` | 散文正本（risk-tiers / ai-dlc-flow）↔ JSON ミラーと verification/ 分離の同期をテストで固定 |
| doctor | `src/doctor/` | `doctor [--fast] [--json] [--quiet]`（SessionStart で --fast 自動実行） | ハーネス自己診断（deps / hooks 配線 / lefthook 罠 / 孤児 state / drift。mise は `.mise.toml` 実在時のみ）。read-only・修復コマンド提示のみ |

各モジュールの詳細は sub-README（[`src/state/`](./src/state/README.md) / [`src/sensors/`](./src/sensors/README.md) / [`src/scopes/`](./src/scopes/README.md) / [`src/autonomy/`](./src/autonomy/README.md) / [`src/learnings/`](./src/learnings/README.md)）。

## セットアップ・実行

```bash
pnpm -C .claude/aidlc install --ignore-workspace   # 依存導入（SessionStart の aidlc-bootstrap.sh が新規 checkout で自動実行）
pnpm -C .claude/aidlc test                          # 全モジュールのテスト
pnpm -C .claude/aidlc typecheck                     # 型チェック
pnpm -C .claude/aidlc doctor                        # ハーネス自己診断

# 各モジュールの助言を得る（いずれも非強制）
pnpm -C .claude/aidlc next examples/state.example.json
pnpm -C .claude/aidlc report state/TICKET-1.md init tier=2 spec=true  # 機械可読 state を作成（パスは -C 先からの相対）
pnpm -C .claude/aidlc report state/TICKET-1.md gate-approve gate1                # 1 手を報告 → 次の助言
pnpm -C .claude/aidlc sensor path/to/migration.sql
pnpm -C .claude/aidlc learnings
git diff -- '*_test.*' '*.test.*' | pnpm -C .claude/aidlc referee
pnpm -C .claude/aidlc scope feature
```

## 設計方針（全モジュール共通）

- **全 advisory（非強制）**。hard stop は既存の lefthook / CI / 人間ゲートが担う。本群は早期警告・観測・部品化。
- **正本ミラー**: `stage-graph.json`（← ai-dlc-flow SKILL.md）/ `tier-gate-map.json`（← risk-tiers.md）/ `scopes.json`（← risk-tiers + spec-driven）/ sensor 検出ルール（← 各正本）は `.claude/` 正本のミラー。**正本を変えたら同期**（drift guard で機械検証）。
- **simplicity 準拠**: 投機的に増やさない。純粋関数（判定）と I/O（fs/exec・CLI）を分離する。

---

## 決定論エンジン（詳細）

`ai-dlc-flow` の Stage routing と `risk-tiers` の Gate 判定を**機械可読データ + 純粋関数**にする。
同じ state なら常に同じ Directive を返す（副作用なし）。

### state の形

```jsonc
{
  "tier": 2,                 // 1 | 2 | 3（risk-tiers）
  "specPlanned": true,       // Stage 2(spec) を実行するか
  "gate2Delegated": false,   // Gate 2 委任（optional）。Gate 1 で人間が明示委任した時のみ true
  "stageStatus": { "0+1": "done" },   // stageId -> pending|active|done|skipped（未記載=pending）
  "gateStatus": { "gate1": "approved" } // gateId -> pending|approved（未記載=pending）
}
```

### next の決定ロジック

Stage を宣言順に走査し、最初に当たった次を返す:

1. **未完了の実行対象 Stage** → `run-stage`（条件付き Stage は `planKey` が false なら skip）
2. **完了済みだが未承認のブロッキングゲート** → `gate`（`blocking`/`conditional` は停止、`declare-only`/`n/a` は非停止）
3. 全て解決済み → `done`

### 機械可読 state の遷移・audit（`report`）

```
next(state) → 1 手を実行 → report <state-file> <event> → state 遷移 + audit 追記 → 次の next 助言
```

- `report` の event: `tier` / `plan` / `stage-start|done|skip` / `gate-approve|reject` / `gate-delegate|undelegate gate2`（Gate 2 委任）。audit は `<ISO8601> <SIGNATURE>`。
- **委任は scope / init に持たせない**（常設委任の禁止 = 都度オプトイン）。Gate 1 で人間が明示委任した時だけ `gate-delegate gate2` を独立の一手として打つ。
- **advisory**: `progress.md`（人手足場）を除去せず**並走**・**Gate を強制しない**（hard stop は lefthook/CI/人間）。
