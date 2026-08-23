#!/usr/bin/env bash
# pre-commit hook（lefthook 経由）— anti-tamper/referee 配線（advisory）
#
# staged な test diff のテスト改ざん（既存 assertion 削除 / skip・only 追加 / trivial assertion /
# test 宣言削除 / コメントアウト）を検出して警告する。「テストを甘くして緑にする」(testing.md 禁止)
# をコミット時に早期検知する。
#
# advisory: 検出しても commit はブロックしない（常に exit 0）。hard stop は test-quality-reviewer
# （観点別 3 体 self-review）と人間が担う。将来エスカレーション: referee に --strict を渡せば
# ブロック化できる（autonomy/README.md）。
set -u

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
aidlc="$repo_root/.claude/aidlc"

# フェイルセーフ: 依存未導入 / pnpm 不在なら黙って通す。
[ -d "$aidlc/node_modules" ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

diff="$(git -C "$repo_root" diff --cached -- '*_test.go' '*.test.ts' '*.test.tsx' '*.spec.ts' '*.spec.tsx' '*_test.py' 'test_*.py' '*_test.rs' '*_spec.rb' '*Test.java' '*Test.kt' 2>/dev/null)"
[ -z "$diff" ] && exit 0

# referee（anti-tamper）を advisory で実行。--strict は付けない（exit 0 維持＝非ブロック）。
printf '%s' "$diff" | pnpm -s -C "$aidlc" referee 2>&1 || true
exit 0
