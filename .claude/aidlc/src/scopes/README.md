# scopes — 名前付き scope プロファイル

既存の **risk-tiers + spec 省略条件**（散文）を、**名前付きの再利用可能な開発部品**にする。
`stage-graph.json` と合成して、scope ごとの **実行 Stage 計画**を機械的に出す。

> **役割分離**: `scope` = どの Stage を回すか（specPlanned / behaviorChange）。
> `tier`（risk-tiers）= 人間ゲートの深さ。両者を分け、二重定義しない。

## scope 一覧（simplicity.md 準拠で少数のみ）

| scope | tier | spec | 挙動変更 | 必須 sensor | 実行 Stage |
|---|---|---|---|---|---|
| `doc-only` | 3 | — | なし | — | 0+1 → 5 → 6 → 8（TDD/spec なし） |
| `bugfix` | 2 | — | あり | — | 0+1 → 3+4 → 5 → 6 → 8 |
| `feature` | 2 | ✓ | あり | — | 0+1 → 2 → 3+4 → 5 → 6 → 8（全 Stage） |
| `security-patch` | 1 | ✓ | あり | —（プロジェクトが登録） | 0+1 → 2 → 3+4 → 5 → 6 → 8 |

正本: `.claude/rules/risk-tiers.md` / `spec-driven.md` / `testing.md`。scope 名・必須 sensor はプロジェクトに合わせて調整する。

## 関数 / 使い方

```bash
pnpm -C .claude/aidlc scope feature
#   # scope: feature
#   - tier: 2 / spec: true / 挙動変更: true
#   - 実行 Stage: 0+1 → 2 → 3+4 → 5 → 6 → 8
```

- `resolveScope(name, data)` … scope 名 → プロファイル（未知は throw）。
- `plannedStages(scope, graph)` … プロファイル + stage-graph → 実行 Stage 列（純粋関数）。条件付き Stage は `planKey`、挙動変更なしは TDD Stage を外す。
- `scopeToInitialState(scope)` … プロファイル → engine state の初期種（`WorkflowState`）。

## scope → engine seed（配線済み）

scope 宣言（feature 等）から機械可読 state（`report` / `next`）を **直接 seed** できる。
手書きの `init tier=N spec=B` を scope 名一発に置き換える（人間判断＝scope の機械化）:

```bash
# scope=feature → tier=2 / spec=true を seed して state を初期化
pnpm -C .claude/aidlc report state/TICKET-1.md init scope=feature   # state パスは -C 先(.claude/aidlc)からの相対
```

- 未知 scope は fail fast。明示 `init tier=… spec=…` 形態も後方互換で維持。
- seed は遷移前なので `stageStatus` / `gateStatus` は空（以降は `report` の各 event で遷移）。
