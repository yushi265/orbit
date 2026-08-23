// referee CLI（advisory）
// test の diff を受け取り、既存テストの緩和（改ざん）を anti-tamper で検出する。
// 使い方:
//   git diff -- '*_test.go' '*.test.ts' '*.test.tsx' | pnpm -C .claude/aidlc referee
//   pnpm -C .claude/aidlc referee <diff-file> [--strict]
// 自律区間（Tier 2 の Stage2〜8）では、改ざん候補が出たら halt-and-ask（人間に戻す）。
// 権威 green は別途 `go test -race` / `pnpm test` / `lefthook` の exit0（AI の自己申告は信用しない）。

import { readFileSync } from "node:fs";
import { scanTestDiff } from "./anti-tamper";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const fileArg = args.find((a) => !a.startsWith("--"));

const diff = fileArg ? readFileSync(fileArg, "utf8") : readFileSync(0, "utf8");
const findings = scanTestDiff(diff);

for (const f of findings) {
  process.stderr.write(`[anti-tamper] ${f.file}:${f.line} [${f.kind}] ${f.message}\n    > ${f.text}\n`);
}
process.stderr.write(
  findings.length === 0
    ? "[anti-tamper] テスト改ざんの兆候なし\n"
    : `[anti-tamper] ${findings.length} 件の改ざん候補（advisory・自律区間では halt-and-ask）\n`,
);

process.exit(strict && findings.length > 0 ? 1 : 0);
