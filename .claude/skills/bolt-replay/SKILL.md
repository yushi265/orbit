---
name: bolt-replay
description: ボルトの経緯（何を決め・何に詰まり・何を変えたか）を機械記録から時系列の叙述として再構成する read-only スキル。Gate 3 の承認者が経緯を把握したい時、ボルトを引き継ぐ・長期中断から復帰する時、過去ボルトの経緯を振り返る時に使用する。状態は一切変更しない。
---

# bolt-replay — ボルト経緯の再構成（read-only）

ワークフローを再実行せずに文脈を回復する。承認者・不在者・引き継ぎ相手が「チャットログ考古学」をせずに
経緯を掴むための時系列叙述を生成する。**数字はツールから・散文だけ合成**。

## 入力（この順で読む。情報源と順序の正本は [ai-dlc-flow](../ai-dlc-flow/SKILL.md)「中断 → 再開」の読み順・④のみ完了ボルトの物語化のため現況確認でなく履歴ベースに置換）

1. `docs/spec/<TICKET>-*/index.md`（あれば）… 契約（AC・スコープ外）
2. 同 `progress.md`（あれば）… Stage 宣言・ゲート状態・実装タスク台帳
3. `.claude/aidlc/state/<TICKET>.md`（あれば）… 機械 state・audit（時刻付きイベント履歴）
4. `git log --oneline <base>..HEAD` / `git diff --stat <base>..HEAD` … 実変更（申告でなく実物）
5. `docs/ai-dlc/retro/<TICKET>.md`（あれば）… 気づき・判断・罠

- spec を実行しないボルト（1・2 が無い）は 3 以降から。全部無い（記録ゼロ）なら「replay 不能（記録なし）」と返して終わる。

## 出力（端末のみ・ファイルは書かない）

- **時系列の叙述**: Stage 順に「何が起き・何を決めたか」。**1 Stage あたり 1〜2 行・全体 15 行以内**。
- **各行に出典を付ける**（audit の時刻 / progress.md の節 / git SHA / retro note の行）。詳細は本文に展開せず出典で辿らせる。
- **数字パート**（Stage 消化 / gate 往復 / トークン転記）は `pnpm -C .claude/aidlc report state/<TICKET>.md summary` の出力表を **verbatim 引用**する（state が無ければ「数字は未記録」と 1 行書く。自分で集計し直さない）。

## 禁止事項（最重要・破ったら read-only の意味が無い）

- **数字は機械ソースから引用のみ**: テスト数・行数・件数は git / audit / progress.md / summary の記録から引く。**自分で数え直さない・推定しない・丸めない**。
- **時刻は audit 行の値を verbatim 転記する**: 記憶からの再構成・分への丸め・「だいたいこの頃」の近似は禁止（叙述を書いてから時刻を思い出しで埋めない。audit 行を見ながら書く）。
- **創作禁止**: audit / progress / retro / git のいずれにも痕跡が無い出来事は、覚えていても叙述に含めない（会話上の記憶は出典にならない。記録に無いことは「audit に痕跡なし」と書く）。
- **状態を変更しない**: event を追記する `report` は呼ばない・ファイルを書かない・Stage を進めない（read-only 照会の `report <state> summary` だけは数字パートの引用のために可）。

## 用途と呼ばれ方

| 場面 | 呼び方 |
|---|---|
| Gate 3 直前（成果提示の冒頭） | AI が自動で 1 回流す（[ai-dlc-flow](../ai-dlc-flow/SKILL.md) Stage 8） |
| 引き継ぎ・長期中断からの復帰 | 人間が任意時点で本スキルを呼ぶ |
| 過去ボルトの経緯確認 | 同上（state が除去済みなら git log + retro note だけで縮退生成） |

- replay は**判断材料であって正本ではない**（read-only・spec / progress / audit が常に優先）。承認者は疑問があれば出典を直接開く。
- **近接スキルとの分担**: [self-review](../self-review/SKILL.md) = diff の品質是正（Must 解消）/ [impl-audit](../impl-audit/SKILL.md) = 節目の全体適合監査 / [retro-triage](../retro-triage/SKILL.md) = 複数 note 横断の Try 棚卸し。bolt-replay はどれとも違い**「経緯の叙述」だけ**を出す（品質判定・監査・棚卸しをしない）。

## 出力例（形式・15 行規律の目安）

```
# bolt-replay: <TICKET>（出典: state audit / git）
1. 0+1 要件整理: Tier 2 宣言・spec スキップ（audit <timestamp>）→ Gate 1 承認・
   実装時判断 2 件を note 記録（audit <timestamp> / <timestamp>）
2. 3+4 TDD: 完了（audit <timestamp> STAGE_COMPLETED）→ 5 静的解析: 完了（<timestamp>）
3. 6 セルフレビュー: 完了（audit <timestamp>。指摘内容は audit に痕跡なし — 痕跡の無いことは書かない）
4. 8 成果提示: 完了（<timestamp>）→ Gate 3 承認（<timestamp>）
5. コミット: <sha>「<コミットメッセージ>」<N> files, +<追加>/−<削除>（git show --stat）
[数字] report summary verbatim: Stage 消化 5（skip 1）/ gate 承認 2 / 差し戻し 0 / トークン転記 記録なし
```
