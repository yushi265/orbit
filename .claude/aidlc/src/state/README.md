# state — engine state の永続化・遷移・監査（advisory）

`next()`（state → 次の 1 手の純粋関数）は state を**手書き JSON で渡す**だけで、永続・遷移・監査が無い。
本モジュールは state を**機械可読ファイル + `report` による遷移 + audit ログ**に昇格させ、
「next → 実行 → report → 次の助言」のループを閉じる。

> **advisory（非強制・並走）**。`progress.md`（人手の中断→再開足場）を**除去しない**・**Gate を強制しない**。
> hard stop は従来どおり lefthook / CI / 人間ゲート。state は progress.md の**機械可読ミラー**として並走する。

## できること

| 関数 / CLI | 役割 |
|---|---|
| `applyReport(state, event)` | 1 手の結果（`ReportEvent`）→ **新しい** state（純粋・immutable） |
| `applyReportToDocument(doc, event, ts)` | state 遷移 + audit 追記（**冪等**: 直前と同一 event は追記スキップ） |
| `parseStateFile` / `serializeStateFile` | 機械可読 markdown ⇄ `StateDocument` の往復 |
| `parseReportEvent(tokens)` | CLI 引数 → `ReportEvent`（不正入力は fail fast） |
| `report` CLI | state ファイルを read → event 適用 → write → `next()` の助言表示 |

### `ReportEvent`（state 遷移と audit の単位）

`tier-declared` / `plan-declared` / `stage-started` / `stage-completed` / `stage-skipped` / `gate-approved` / `gate-rejected` /
`gate-delegated` / `gate-undelegated`（**gate2 限定**・型で gate1/gate3 の委任を禁止）。
audit 行は `<ISO8601> <SIGNATURE>`（例: `2026-01-01T00:00:00Z GATE_APPROVED gate=gate1`）。
この audit が学習ループ（retro note の手書き依存を減らす土台）の機械入力になりうる。

## 使い方

```bash
# 新規作成（Tier 2・spec あり）
pnpm -C .claude/aidlc report state/TICKET-123.md init tier=2 spec=true
# scope から seed（tier/spec を scopes.json から）
pnpm -C .claude/aidlc report state/TICKET-123.md init scope=feature
# 注: state パスは `-C .claude/aidlc` で cwd が .claude/aidlc になるため**そこからの相対**で渡す（`state/X.md`）。

# 1 手の結果を報告（state 遷移 + audit 追記）。stderr に次の 1 手の助言が出る
pnpm -C .claude/aidlc report state/TICKET-123.md stage-done 0+1
pnpm -C .claude/aidlc report state/TICKET-123.md gate-approve gate1
#   → [aidlc-engine 助言] ▶ 次に実行: Stage 2「design doc作成」（スキル: create-spec）

# Gate 2 委任: Gate 1 で人間が明示委任した時だけ、独立の一手として打つ
# （init / scope プロファイルには持たせない＝常設委任の禁止・都度オプトイン。ティア再宣言時は gate-undelegate でリセット）
pnpm -C .claude/aidlc report state/TICKET-123.md gate-delegate gate2

# テスト（遷移・往復・冪等・引数パース）
pnpm -C .claude/aidlc test
```

- 生成される `state/<TICKET>.md` は **`.gitignore` 済み**（揮発・per-ticket）。
- stdout = 更新後 state の JSON（機械可読）/ stderr = 人間向け助言（非強制）。

## progress.md との役割分担

`state.md` は `progress.md` を**置換しない**（advisory）。両者は持ち物が違い、役割で分担する:

| | progress.md（**正本**・人手 md・揮発） | state.md（**並走ミラー**・機械可読・揮発/.gitignore） |
|---|---|---|
| 位置 | `docs/spec/<TICKET>/progress.md` | `.claude/aidlc/state/<TICKET>.md` |
| ティア / Stage / Gate ステータス | ◯（判定根拠・スキップ理由の**散文つき**） | ◯（`tier` 数値・`stageStatus`・`gateStatus`） |
| 実装タスク計画（順序×レイヤー×AC×依存） | ◯ | ✗（構造的に持てない） |
| audit ログ（時刻付きイベント履歴） | ✗ | ◯（ここだけ） |

- **正本は progress.md**（中断→再開の足場・人間可読の文脈）。`state.md` は engine が `report` で更新する**機械可読ミラー**（advisory）。
- 機械化できるのは「状態フラグ + audit」まで。**理由の散文・実装タスク計画は progress.md にしか持てない**。

Stage 定義の正本は [`ai-dlc-flow`](../../../skills/ai-dlc-flow/SKILL.md)、Tier/Gate の正本は [`risk-tiers.md`](../../../rules/risk-tiers.md)。
