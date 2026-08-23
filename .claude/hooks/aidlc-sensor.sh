#!/usr/bin/env bash
# PostToolUse(Edit|Write) hook — sensor 配線（advisory）
#
# 編集対象が sensors.manifest.json の glob に該当するとき、対応する sensor を自動実行し、
# 指摘があれば AI へフィードバックする（編集の都度の機械検証を常時化する）。
# どの sensor が何を検出するかは sensors.manifest.json と各 sensor 実装が正本。
#
# advisory: 指摘があれば exit 2 で stderr に出して AI へ返す（PostToolUse は編集後実行のため
# 編集自体はブロックしない）。clean・環境未整備なら exit 0。hard stop は lefthook / CI /
# レビュー / 人間が担う（多重防壁を崩さない）。
set -u

input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"

[ -z "$file" ] && exit 0
[ ! -f "$file" ] && exit 0
case "$file" in
  *.sql|*/migrations/*|*/docs/ai-dlc/codekb/*.md|*/docs/spec/*.md|*/docs/ai-dlc/learnings.md) ;;  # SQL + migrations + codekb + spec 必須節 + learnings 書式（sensors.manifest.json の glob に対応）。node 起動は該当時のみ
  *) exit 0 ;;
esac

repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
aidlc="$repo_root/.claude/aidlc"

# フェイルセーフ: 依存未導入 / pnpm 不在なら黙って通す（環境差で誤警告しない）。
[ -d "$aidlc/node_modules" ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

out="$(pnpm -s -C "$aidlc" sensor "$file" 2>&1)"

# --- sensor-log 追記（効果測定の土台。state/ は gitignore 済み・書込失敗は無音 = fail-open） ---
{
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log_file="$aidlc/state/sensor-log.jsonl"
  mkdir -p "$aidlc/state"
  if printf '%s' "$out" | grep -q '件の指摘'; then
    # FAIL: 発火した sensor ごとに 1 行（stderr の [sensor:名前] タグの行数 = findings）
    printf '%s' "$out" | grep -o '\[sensor:[a-z-]*\]' | sort | uniq -c | while read -r n tag; do
      name="${tag#\[sensor:}"
      name="${name%\]}"
      jq -cn --arg ts "$ts" --arg s "$name" --arg f "$file" --argjson n "$n" \
        '{ts:$ts,sensor:$s,file:$f,result:"FAIL",findings:$n}' >>"$log_file"
    done
  else
    # PASS: dispatch 実行 1 回 = 1 行（稼働の分母。findings 無しでは個別 sensor 名を特定できないため dispatch 名義）
    jq -cn --arg ts "$ts" --arg f "$file" \
      '{ts:$ts,sensor:"dispatch",file:$f,result:"PASS",findings:0}' >>"$log_file"
  fi
} 2>/dev/null || true

# 「N 件の指摘」が含まれていれば findings あり → AI へ advisory フィードバック。
if printf '%s' "$out" | grep -q '件の指摘'; then
  {
    echo "[aidlc sensor] $file に指摘があります（advisory・発火 sensor は各行の [sensor:名前] 参照）:"
    printf '%s\n' "$out"
    echo "→ 正本: tier-tripwire=risk-tiers.md（停止して再宣言）/ spec-sections=create-spec チェックリスト / learnings-format=learnings.md 冒頭規約（hard stop は lefthook/CI/レビュー）。"
  } >&2
  exit 2
fi

exit 0
