#!/usr/bin/env bash
# SessionStart hook — AI-DLC 助言ツールの bootstrap（deps 自動導入）。
#
# 背景: 各 aidlc フック（aidlc-sensor / aidlc-engine-nudge / aidlc-retro-surface 等）は
# `[ -d node_modules ] || exit 0` のフェイルセーフを持つ。これは環境差で誤警告しないための
# 安全設計だが、新規チェックアウトでは `.claude/aidlc/node_modules` が無いため advisory が
# **全て無音（サイレント死）**になる。bootstrap でこの土台の穴を塞ぐ。
#
# 挙動: deps 未導入 かつ pnpm 在りなら一度だけ自動 install する（冪等・非ブロック）。
# devDeps のみ（tsx / typescript / @types/node・build script は esbuild のみで pnpm が ignore）。
# workspace 非参加のため --ignore-workspace。
# failsafe: aidlc 無し / 既導入 / pnpm 不在なら何もしない（exit 0）。install 失敗も握りつぶす
# （hard stop にしない・ツールは advisory）。
set -u

repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
aidlc="$repo_root/.claude/aidlc"

[ -d "$aidlc" ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

if [ ! -d "$aidlc/node_modules" ]; then
  if ( cd "$aidlc" && pnpm install --ignore-workspace --silent >/dev/null 2>&1 ); then
    echo "[aidlc:bootstrap] .claude/aidlc の依存を自動導入しました（sensor / engine-nudge 等の advisory を有効化）。" >&2
  fi
fi

# doctor --fast: deps / hooks-wiring の欠落時のみ 1 行 NOTE（正常時は無音・ミリ秒級）。
# doctor 自身が動かない環境では無音（既存フェイルセーフ方針を維持）。
if [ -d "$aidlc/node_modules" ]; then
  ( cd "$aidlc" && pnpm -s doctor --fast --quiet 2>/dev/null ) >&2 || true
fi
exit 0
