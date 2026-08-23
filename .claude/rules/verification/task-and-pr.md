# task-and-pr — Verification（セルフレビュー照合用）

> 正本ルール: [`../task-and-pr.md`](../task-and-pr.md)。self-review（観点別 3 体）の照合チェックリスト。
> ルール本文（常時注入）から、self-review 実行時にだけ読む照合節を外出ししたもの。

> diff が触れていないレイヤー・領域の項目は N/A と明記してスキップ可（N/A の根拠を 1 行残す）。

- [ ] PR が意味のあるまとまり（レビュー可能な単位）に収まっている（PR 粒度の最終判断は Gate 3）
- [ ] 品質ゲート（`npx lefthook run pre-commit` + 当該レイヤーの test）の pass 出力が証跡として残っている
- [ ] コミットメッセージが Conventional Commits（`<type>(<TICKET>): 変更内容`）に従っている
- [ ] `-f` 系コマンド・`--no-verify` を使っていない
