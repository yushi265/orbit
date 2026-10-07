// テスト名一覧のベースラインを記録・突合する（REFACTOR-ui-architecture AC-7）。
//   node scripts/test-baseline.mjs record  … 現在のテスト名と fail 済みテストを scripts/test-baseline.json へ記録
//   node scripts/test-baseline.mjs check   … ベースラインと突合し、消えたテスト・新たな fail・skip/only/todo があれば exit 1
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/test-baseline.json");
const DISALLOWED = new Set(["skipped", "pending", "todo"]);

export function collectTests(report, root) {
  return report.testResults
    .flatMap((file) =>
      file.assertionResults.map((test) => ({
        id: [path.relative(root, file.name), ...test.ancestorTitles, test.title].join(" > "),
        status: test.status,
      })),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function countById(ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

// it.each などで同名のテストが複数あるため、ID ごとの件数で「同名・同数」を突合する。
export function compareBaseline(baseline, current) {
  const currentCounts = countById(current.map((test) => test.id));
  const missing = [];
  for (const [id, count] of countById(baseline.tests))
    for (let index = currentCounts.get(id) ?? 0; index < count; index += 1) missing.push(id);
  const knownFailures = new Set(baseline.failing);
  return {
    missing,
    unexpectedFailures: current
      .filter((test) => test.status === "failed" && !knownFailures.has(test.id))
      .map((test) => test.id),
    disallowed: current.filter((test) => DISALLOWED.has(test.status)).map((test) => test.id),
  };
}

function runVitest() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-baseline-"));
  const outputFile = path.join(directory, "report.json");
  try {
    const result = spawnSync(
      "pnpm",
      ["exec", "vitest", "run", "--reporter=json", `--outputFile=${outputFile}`],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (!fs.existsSync(outputFile))
      throw new Error(`vitest の JSON レポートが出力されませんでした（exit ${result.status}）。`);
    return collectTests(JSON.parse(fs.readFileSync(outputFile, "utf8")), REPO_ROOT);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function main(command) {
  if (command === "record") {
    const tests = runVitest();
    const baseline = {
      tests: tests.map((test) => test.id),
      failing: tests.filter((test) => test.status === "failed").map((test) => test.id),
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`記録しました: ${baseline.tests.length} 件（fail ${baseline.failing.length} 件）`);
    return 0;
  }
  if (command === "check") {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    const result = compareBaseline(baseline, runVitest());
    for (const [label, ids] of Object.entries(result))
      for (const id of ids) console.error(`[${label}] ${id}`);
    const ok = Object.values(result).every((ids) => ids.length === 0);
    console.log(ok ? "ベースラインと一致しました。" : "ベースラインと一致しません。");
    return ok ? 0 : 1;
  }
  console.error("usage: node scripts/test-baseline.mjs <record|check>");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv[2]);
