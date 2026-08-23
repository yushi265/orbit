// checkreturn CLI（advisory）
// 使い方:
//   pnpm -C .claude/aidlc checkreturn <schema-name> <file>   … ファイルの返答を検査
//   ... | pnpm -C .claude/aidlc checkreturn <schema-name>    … stdin の返答を検査
// exit 0 = ok（警告があっても ok）/ exit 1 = malformed（欠落・矛盾）/ exit 2 = 使い方エラー

import { readFileSync } from "node:fs";
import { checkReturn, type ReturnSchemas } from "./check";

const schemas: ReturnSchemas & { $comment?: string; version?: number } = JSON.parse(
  readFileSync(new URL("../../return-schemas.json", import.meta.url), "utf8"),
);

const [schemaName, file] = process.argv.slice(2);
const known = Object.keys(schemas).filter((k) => k !== "$comment" && k !== "version");

if (!schemaName || !known.includes(schemaName)) {
  process.stderr.write(`使い方: checkreturn <schema> [<file>]（stdin 可）。schema: ${known.join(" | ")}\n`);
  process.exit(2);
}

const text = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const result = checkReturn(text, schemas[schemaName]);

for (const m of result.missing) process.stderr.write(`✗ 必須見出しが無い: ${m}\n`);
for (const c of result.contradictions) process.stderr.write(`✗ ${c}\n`);
for (const w of result.emptyWarnings) process.stderr.write(`⚠ ${w}\n`);

if (result.ok) {
  process.stderr.write(`✓ ${schemaName}: 受領検査 pass${result.emptyWarnings.length > 0 ? "（警告あり）" : ""}\n`);
  process.exit(0);
}
process.stderr.write(
  `✗ ${schemaName}: malformed。成果は採用せず、縮小リトライ（1 回だけ）→ 失敗なら人間へエスカレーション（ai-dlc-flow 責務分界）\n`,
);
process.exit(1);
