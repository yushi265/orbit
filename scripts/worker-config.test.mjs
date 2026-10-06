import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

// wrangler の設定ファイルはコメントを含まない JSONC として書かれている。
function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8"));
}

describe("Worker 設定（Cron Trigger 併用）", () => {
  it("[代表値] wrangler.jsonc と wrangler.local.jsonc の main が src/server.ts", () => {
    assert.equal(readJson("wrangler.jsonc").main, "src/server.ts");
    assert.equal(readJson("wrangler.local.jsonc").main, "src/server.ts");
  });

  it("[代表値] wrangler.jsonc のトップレベル triggers.crons が毎時で、local には triggers が無い", () => {
    assert.deepEqual(readJson("wrangler.jsonc").triggers, { crons: ["0 * * * *"] });
    assert.equal("triggers" in readJson("wrangler.local.jsonc"), false);
  });

  it("[代表値] env.production.send_email が EMAIL binding で、トップレベルと local には send_email が無い", () => {
    assert.deepEqual(readJson("wrangler.jsonc").env.production.send_email, [{ name: "EMAIL" }]);
    assert.equal("send_email" in readJson("wrangler.jsonc"), false);
    assert.equal("send_email" in readJson("wrangler.local.jsonc"), false);
  });

  it("[代表値] package.json の format / format:check が src/server.ts を含む", () => {
    const { scripts } = readJson("package.json");
    assert.match(scripts.format, /(^|\s)src\/server\.ts(\s|$)/);
    assert.match(scripts["format:check"], /(^|\s)src\/server\.ts(\s|$)/);
  });
});
