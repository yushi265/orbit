# <TICKET> 進行状態（progress）

> **揮発物**。AI-DLC の中断 → 再開用スナップショット。Stage・ゲートの粗粒度のみ記録する（細粒度タスクは TodoWrite・学びは retro note へ）。
> 契約は `index.md`（AC はそこが正本・本ファイルに重複させない）。**機能完了時（Gate 3 承認 / merge 前）に除去**する。
> 再開時の読み順は [ai-dlc-flow](../../../.claude/skills/ai-dlc-flow/SKILL.md) の「中断 → 再開」節に従う（index.md → 本ファイル → engine state → git → retro。矛盾は実物優先）。

## Stage 宣言（Gate 1 で承認）

> 単一適応フロー。🔒必須 Stage はスキップ不可。🔓条件付き Stage は基準を満たす時のみスキップ可。
> 基準は [`.claude/skills/ai-dlc-flow/SKILL.md`](../../../.claude/skills/ai-dlc-flow/SKILL.md) の「必須 Stage と条件付きスキップ基準」に従う。
>
> **リスクティア**（[`.claude/rules/risk-tiers.md`](../../../.claude/rules/risk-tiers.md)）: <Tier 1 / Tier 2>（判定根拠: <該当行を 1 行>）。
> ※ progress.md は spec 実行時のみ存在するため、ここに記録されるのは**常に Tier 1 または Tier 2**（Tier 3 は progress.md を作らない）。
> **Gate 2 委任**: <なし / あり（Gate 1 で明示・YYYY-MM-DD）>（ティア再宣言時はリセットして再記録。[risk-tiers.md](../../../.claude/rules/risk-tiers.md) の「Gate 2 委任」）

| Stage | 区分 | 実行/スキップ | 理由 |
|-------|------|--------------|------|
| 0+1 Stage 宣言＋要件整理 | 🔒必須 | 実行 | 常時（深さは適応） |
| 2 spec 作成 | 🔓条件付き | <実行 or スキップ> | <スキップ時は基準4条件の充足を明記> |
| 3+4 TDD（RED→GREEN→REFACTOR） | 🔒必須 | 実行 | 常時（後追い禁止・test-first） |
| 5 静的解析・フォーマッター | 🔒必須 | 実行 | 常時 |
| 6 セルフレビュー | 🔒必須 | 実行 | 常時（深さは適応） |
| 8 成果提示＋コミットゲート | 🔒必須 | 実行 | 常時 |

## ゲート承認状態

> Gate 1=ブロッキング承認（progress.md が存在する時点で Tier 1/2）/ Gate 2=spec Stage が走る時だけ（委任時は承認待ちなし・Gate 3 事後確認で ✓）/ Gate 3=常時。

- [ ] Gate 1 要件＋Stage 宣言 承認（<YYYY-MM-DD>）
- [ ] Gate 2 spec 承認（<Stage 2 を実行する時のみ。委任時は「委任・要点提示 YYYY-MM-DD」と書き、Gate 3 の事後確認で ✓>）
- [ ] codekb 差分追記済み（`docs/ai-dlc/codekb/`。対象外なら N/A 根拠 1 行）
- [ ] Gate 3 コミット対象 承認

## 現在位置

- 現 Stage: <例: 4 本実装（GREEN）>
- 次の一手: <次に着手する具体アクション 1 行>

> ボルト内の気づき・摩擦・想定外（TDD の RED 想定外・観点別 3 体（code / spec-conformance / test-quality）の Must 指摘・ゲート失敗など）は **retro note** （[`docs/ai-dlc/retro/<TICKET>.md`](../../ai-dlc/retro/_TEMPLATE.md) の「各 Stage の気づき」表）に追記する。`progress.md` には残さない（学習はユニット横断で永続化、進行状態は揮発）。

## 実装タスク計画（順序付き）

> 非 trivial 時、Stage 2（create-spec）で作る**実装の段取り**。ユニットを順序付きタスク（ボルト）へ分解し、各タスクに
> レイヤー・カバーAC・依存を割り付ける。これが Stage 3/4 の実装順になる。
> **PR の単位は固定しない**（Gate 3 で人間が決める）。trivial は「分解不要」とだけ書く。
> タスクより下の細粒度・実行中の進捗は TodoWrite。
>
> **台帳記法（この 1 行形式で書くと機械検査できる）**:
> `- [ ] T<n> [data|service|ui|infra] AC-1,AC-2|なし 依存:T<n>,…|なし — タイトル`
> 完了は `[x]`。この記法にマッチしない行は自由記述として無視される。
> 検査: `pnpm -C .claude/aidlc ledger <progress.md> --spec <index.md>`（未消化・未割当 AC・依存違反。
> Gate 3 の証跡チェックリストにも自動添付される）。

- [ ] T1 [data] AC-1 依存:なし — <例: スキーマ追加>
- [ ] T2 [service] AC-1,AC-2 依存:T1 — <例: API 実装>

## リンク

- 契約（AC はここが正本）: [index.md](./index.md)
- レイヤー: <関与する `<layer>.md` へのリンク（例: data.md / service.md / ui.md）>
