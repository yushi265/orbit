# FEAT-cycle-cron AI-DLC 振り返り学習ノート（retro note）

> このユニット（チケット）で**何を学んだか**を残す永続資産。`progress.md`（揮発・再開用）とは別物。
> 各 Stage の境界で notable な気づきだけ追記し、Gate 3 で KPT を蒸留する。
> 証跡（テスト数・ゲート結果）は progress.md / PR を指すポインタに留め、ここに転記しない。
> ループの全体像と還流先は [README.md](./README.md)。

## メタ

- ticket: FEAT-cycle-cron
- 機能概要: Cron Trigger（毎時）で Cycle の補充・終了・繰越・開始を自動実行する。Manual Run は残す
- Stage 宣言の結果: Tier 1・全 Stage 実行・Gate 2 委任
- トークン実測: 未計測
- 着手日 / 完了日: 2026-10-06 / 2026-10-06

## 各 Stage の気づき（材料・軽量）

| Stage | 気づき（摩擦・想定外・判断） |
|-------|------------------------------|
| 1 要件整理＋Stage 宣言 | 別ボルト（FIX-detail-views-polish）が stage 済みで途中だったため worktree に分けた。本番が workers.dev で自前ドメインが無く、メールは次ボルトへ分離した |
| 2 spec 作成 | Run は 3 ステップ固定でブラウザ駆動だと調査で判明し、Run を作らず Cycle 処理だけを直接呼ぶ設計にした。actor は既存の `system:automation` を再利用して Migration と旧版非互換を避けた。独自 entry は捨てコードの本番 build で事前確認した |
| 3+4 TDD | 実装と docs 更新を 2 体に分けて並行。implementer は spec との乖離なしで返した。受領時の再委譲は 0 回 |
| 5 静的解析 | 全 green。ハーネス（`.claude/aidlc`）の依存が worktree に入っておらず、`--ignore-workspace` で入れ直した |
| 6 セルフレビュー | Must 0。test-quality の変異テストで生き残り 2 件（競合以外の保存例外・終了処理の idempotency key）が出てテストを追加。code-reviewer の IMO 1 件は誤検知（`needsInitialPersist` の getter を読んでいなかった） |
| 8 成果提示 | artifact guard が spec の `index.md` を「不足」と判定した（glob が `<TICKET>-*` 前提で、サフィックスの無いディレクトリ名に一致しない）。Cloudflare 上の実行とローカルの scheduled 呼び出しは未確認のまま申し送り |

## 振り返り（KPT）

### Keep（効いた・次も続ける）
- 契約を固める前に、既存の仕組み（Run の 3 ステップ固定・ブラウザ駆動・Snapshot CAS）を 3 体の調査で押さえたことで、Run を使わない設計を spec の時点で選べた。
- 不確かな基盤（独自 entry と `triggers` の継承）を捨てコードの本番 build で先に確かめ、実装中の手戻りが出なかった。
- Tier 1 トリガー（Schema・actor の値域）に触れない代替（`system:automation` の再利用）を spec で先に探した。
- レビュアーの「問題なし」と IMO を実コードで裏取りし、誤検知 1 件を修正せずに棄却できた。

### Problem（詰まった・摩擦・想定外）
- `[tooling]` worktree では `pnpm -C .claude/aidlc install` が workspace 配下として何もせず、`tsx` が無くて engine の CLI が動かなかった。`--ignore-workspace` で入れ直した。
- `[tooling]` artifact guard の glob が `docs/spec/<TICKET>-*/` 前提で、`docs/spec/FEAT-cycle-cron/` を「index.md 不足」と誤判定した。
- `[testing]` spec のテストケース一覧に「競合以外の保存例外」と「終了処理の idempotency key」が無く、変異テストで初めて見つかった。
- `[gate]` 本番でしか確かめられない挙動（Cron の実行・ロールバック時の Cron の扱い）が、ゲートを全部通っても未確認のまま残った。

### Try（次ボルト以降でフローをこう変える）
- worktree でボルトを始める時は、依存の導入に `pnpm -C .claude/aidlc install --ignore-workspace` を含める。
- artifact guard の spec glob を、サフィックスの無いディレクトリ名にも一致させる。
- 再試行・分岐を持つ処理の spec では、「再試行しない側」の条件もテストケースに書く。

## フロー改善アクション

| Try | 還流先 | ステータス |
|-----|--------|-----------|
| worktree での engine 依存導入に `--ignore-workspace` を明記 | `.claude/README.md` / ai-dlc-flow Stage 0+1 | 未対応 |
| artifact guard の spec glob をサフィックスなしにも対応 | `.claude/aidlc/src/`（artifact guard） | 未対応 |
| 再試行・分岐は「しない側」もテストケースに書く | create-spec（手順 6.5） | 未対応 |
