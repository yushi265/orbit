#!/usr/bin/env bash
# Stop hook — Stop guard（観測ログのみ・block しない）
#
# ターン終了時に「進行中ボルト（engine state が run-stage を指す）が停滞したまま
# 放置されていないか」を stopguard CLI で判定し、結果を state/.stop-guard/log.jsonl に残す。
# 既定は観測のみ: stdout（decision JSON）を捨てるため block は発生しない。
# 誤 block 率を実ボルトで観測 → 人間合意の後、stdout を返す 1 行変更で block 化に昇格できる
# （正規中断は `report <state> park`）。
#
# 全経路 fail-open: 環境未整備・例外・engine state 未使用では黙って exit 0
# （ターン終了を邪魔する事故を構造的に防ぐ）。
set -u

input="$(cat 2>/dev/null || true)"

# Stop hook 由来の継続中（stop_hook_active=true）は再判定しない（無限ループ防止）
printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
aidlc="$repo_root/.claude/aidlc"

# フェイルセーフ: 依存未導入 / pnpm 不在 / engine state 未使用なら黙って通す
[ -d "$aidlc/node_modules" ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0
[ -d "$aidlc/state" ] || exit 0

# 既定: 判定 + ログ記録のみ（stdout を捨てる = block しない）。
# block 化する場合はこの行を `pnpm -s -C "$aidlc" stopguard || true` に変える（stdout を返す）。
pnpm -s -C "$aidlc" stopguard >/dev/null 2>&1 || true
exit 0
