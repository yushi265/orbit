import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const failures = [];

if (!/"name"\s*:\s*"[a-z0-9-]+"/.test(config))
  failures.push("wrangler.jsoncのWorker nameが未設定または不正です。");
if (!/"main"\s*:\s*/.test(config)) failures.push("wrangler.jsoncのmainが未設定です。");
if (!/"compatibility_date"\s*:\s*"\d{4}-\d{2}-\d{2}"/.test(config))
  failures.push("compatibility_dateが未設定または不正です。");
if (!/"env"\s*:\s*\{[\s\S]*?"production"\s*:/.test(config))
  failures.push("production environmentがwrangler.jsoncにありません。");
if (!/"APP_ENV"\s*:\s*"production"/.test(config))
  failures.push("productionのAPP_ENV=productionが未設定です。");

const databaseIds = [...config.matchAll(/"database_id"\s*:\s*"([^"]+)"/g)].map(
  ([, value]) => value,
);
if (databaseIds.length === 0) failures.push("D1 database_idが未設定です。");
if (databaseIds.some((value) => /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)))
  failures.push("D1 database_idがプレースホルダーのままです。対象D1のIDへ置き換えてください。");

if (failures.length > 0) {
  console.error("Deploy preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Deploy preflight passed: Wrangler config has a production environment and non-placeholder D1 IDs.",
);
