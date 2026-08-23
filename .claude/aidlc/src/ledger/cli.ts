// task ledger CLI（advisory）
// 使い方:
//   pnpm -C .claude/aidlc ledger <progress.md> [--spec <index.md>]
// progress.md の実装タスク計画（台帳記法行）をパースし、未消化・AC カバレッジ・依存違反を表示する。
// 台帳行が無い progress.md は「台帳なし」で正常終了（trivial ボルト互換・advisory）。

import { readFileSync } from "node:fs";
import { parseLedger, extractSpecAcs } from "./parse";
import { verifyLedger, formatLedgerReport } from "./verify";

const args = process.argv.slice(2);
const specIdx = args.indexOf("--spec");
const specPath = specIdx !== -1 ? args[specIdx + 1] : null;
const progressPath = args.filter((a, i) => a !== "--spec" && i !== specIdx + 1)[0];

if (!progressPath) {
  process.stderr.write("使い方: ledger <progress.md> [--spec <index.md>]\n");
  process.exit(2);
}

let progressMd: string;
try {
  progressMd = readFileSync(progressPath, "utf8");
} catch (e) {
  process.stderr.write(`⚠ progress.md を読めない: ${progressPath}（${(e as Error).message}）\n`);
  process.exit(1);
}

let specAcs: string[] | null = null;
if (specPath) {
  try {
    specAcs = extractSpecAcs(readFileSync(specPath, "utf8"));
  } catch (e) {
    process.stderr.write(`⚠ spec を読めない: ${specPath}（${(e as Error).message}）\n`);
    process.exit(1);
  }
}

process.stdout.write(formatLedgerReport(verifyLedger(parseLedger(progressMd), specAcs)) + "\n");
