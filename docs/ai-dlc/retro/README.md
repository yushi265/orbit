# AI-DLC 振り返り学習ループ

AI-DLC（[ai-dlc-flow](../../../.claude/skills/ai-dlc-flow/SKILL.md)）の各ユニット（チケット）から
**学びを蒸留して貯め、フロー自体を育てる**ための置き場。用語は [glossary.md](../glossary.md)。

## これは何か

- 1 ユニット（チケット）= 1 つの retro note（`<TICKET>.md`）。「このユニットで何を学んだか」を残す**永続資産**。
- `progress.md`（中断→再開の揮発足場・完了時に除去）とは**役割が別**。retro note は merge 後も残す。
- 主役は KPT（Keep / Problem / Try）の振り返りと、改善の**還流アクション**。

## 使い方（フローに組み込み済み）

| タイミング | やること |
|-----------|---------|
| Stage 0+1（着手・宣言＋要件整理） | `_TEMPLATE.md` から `<TICKET>.md` を作りメタを埋める |
| Stage 2〜6 の境界 | notable な気づきだけ追記（無ければ書かない） |
| Stage 8（Gate 3） | KPT を蒸留 ＋ 還流アクション記入。`progress.md` は除去、retro note は残してコミット対象に含める |

詳細手順は [ai-dlc-flow/SKILL.md](../../../.claude/skills/ai-dlc-flow/SKILL.md)、人間向け解説は [ai-dlc-flow-guide.md](../../ai-dlc-flow-guide.md)。

## 還流先テーブル（学び → ハーネスのどこを直すか）

| 学びの種類 | 還流先 |
|---|---|
| Stage・ゲート・スキップ基準の不備 | `.claude/skills/ai-dlc-flow/SKILL.md` |
| 人間向け説明の不足 | `docs/ai-dlc-flow-guide.md` |
| 横断ルール（testing / spec-driven 等） | `.claude/rules/*.md` |
| spec の書き方・テンプレ | `create-spec` スキル ＋ `docs/spec/_TEMPLATE/` |
| レイヤー実装規約 | 各レイヤーの規約 docs（プロジェクトで用意） |
| サブエージェント挙動 | `.claude/agents/*` |

## 還流サイクル（いつ Try を棚卸しするか）

- **トリガー**: retro note が 3 件たまる、または前回棚卸しから 1 か月（機械判定は **30 日以上**）経過のいずれか早い方。
  - **件数の算出**: `docs/ai-dlc/retro/` ディレクトリの note ファイル数（`_TEMPLATE.md`・`README.md` を除く）。**実物（ディスク）を正とする**——下記「retro note 一覧」は人間向けの索引であり算出には使わない（一覧の更新漏れでトリガーが鳴らない事故を防ぐ・実物優先の原則）。
  - **経過日数の算出**: 後述「棚卸し実施記録」の最終日付から起算（記録が無ければディレクトリ内の最古 retro note の着手日から）。
  - Stage 0 で AI がこの 2 値を機械的に算出して提示する（[ai-dlc-flow](../../../.claude/skills/ai-dlc-flow/SKILL.md) の Stage 0）。
- **棚卸しの実施**: **ユーザーが [retro-triage スキル](../../../.claude/skills/retro-triage/SKILL.md)を呼んだ時のみ**実施する。AI はトリガー達成を検知しても**実施を促すだけで、勝手に棚卸しを始めない**。棚卸しの手順（集約 → 提案 → 反映）の正本は retro-triage スキル側。
- **反映**: 採用された Try は改善 PR の番号をステータス欄に記入する。不採用は理由 1 行とともに「見送り」へ更新する。
- **棚卸し起点の記録**: 棚卸しを実施したら下記「棚卸し実施記録」に 1 行追記する（1 か月経過の計算起点にする）。

## 効果測定（前回 Try の再発チェック）

棚卸しのたびに、前回採用した Try が**実際に効いたか**を再発の有無で確認する（定量スコアではなく定性 ＝ proxy 最適化＝報酬ハッキングの回避）。手順の正本は [retro-triage スキル](../../../.claude/skills/retro-triage/SKILL.md)。

- 各 retro note の Problem は分類タグ `[カテゴリ]`（`spec` / `tdd` / `review` / `gate` / `boundary` / `security` / `tooling` / `other`）を持つ。
- 棚卸し時に、前回採用 Try の還流先と同カテゴリの Problem が、その後のボルトで**再発していないか**をカテゴリ単位で照合する。照合の**材料**は `pnpm -C .claude/aidlc learnings measure` の再発マトリクス（カテゴリ × 採用 Try 期間 × 出典 note + sensor FAIL 推移）が機械出力する（判定は本節のとおり人間が下す）。
- **再発あり** → その Try は未達。別アプローチを再提案する。
- **再発なし** → 効いたと判断し、当該 Try を「反映済み」で確定する。
- 初回棚卸し（前回採用 Try が無い）では N/A。

## ハーネス剪定レビュー（棚卸しと同時に実施）

ハーネスの各構成要素（ルール・スキル・hook・ゲート）は「AI がまだ自力でできないこと」の仮定をエンコードしている。
実施は retro-triage スキルの手順②（チェック内容の正本はこの節）。棚卸しのたびに次を問う:

- [ ] 直近ボルトで一度も役に立たなかった（違反を防がなかった・参照されなかった）ルール/Stage はないか → 簡素化・削除を提案（判断材料: 各 retro note の Problem 欄・各 Stage の気づき欄にそのルール/Stage が登場したか）
- [ ] 逆に、文書で繰り返し違反されたルールはないか → hook / lint への機械化を提案

## 棚卸し実施記録

> 棚卸しを実施したらここに 1 行追記する（日付・対象 note 件数・主な採用 Try・**前回 Try の再発チェック結果**を記録）。
> 記録が無い間（初回棚卸し前）は「3 件たまる」トリガーのみで判定する。

- （まだ無し）

## retro note 一覧

> 新しい retro note を作ったらここに 1 行追記する。

- （まだ無し）
