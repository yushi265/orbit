#!/usr/bin/env node
// 外部bot用Service Tokenで本番orbitの/api/v1を呼ぶ小さなCLI。
// 使い方: node scripts/orbit-api.mjs <METHOD> <PATH> [JSON]
// 必須の環境変数: ORBIT_URL / ORBIT_CF_CLIENT_ID / ORBIT_CF_CLIENT_SECRET
// 秘密値はargvに載せず環境変数から読み、出力にも含めない。
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const READ_METHODS = new Set(["GET", "HEAD"]);
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"]);

export function buildRequest(methodArg, path, rawBody, env, newKey = randomUUID) {
  const method = String(methodArg ?? "").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error(`METHODが不正です: ${methodArg ?? ""}`);
  if (typeof path !== "string" || !path.startsWith("/api/v1/"))
    throw new Error("PATHは /api/v1/ から始めてください。");
  const missing = ["ORBIT_URL", "ORBIT_CF_CLIENT_ID", "ORBIT_CF_CLIENT_SECRET"].filter(
    (name) => !env[name],
  );
  if (missing.length) throw new Error(`環境変数が未設定です: ${missing.join(", ")}`);

  const headers = {
    "CF-Access-Client-Id": env.ORBIT_CF_CLIENT_ID,
    "CF-Access-Client-Secret": env.ORBIT_CF_CLIENT_SECRET,
  };
  let body;
  if (!READ_METHODS.has(method)) {
    const key = newKey();
    headers["X-Requested-With"] = "XMLHttpRequest";
    headers["Idempotency-Key"] = key;
    if (rawBody !== undefined && rawBody !== "") {
      let parsed;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new Error("JSONの形式が不正です。");
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !parsed.idempotencyKey)
        parsed = { idempotencyKey: key, ...parsed };
      headers["content-type"] = "application/json";
      body = JSON.stringify(parsed);
    }
  } else if (rawBody !== undefined && rawBody !== "") {
    throw new Error("GET / HEAD にはJSONを渡せません。");
  }
  const url = new URL(path, env.ORBIT_URL.endsWith("/") ? env.ORBIT_URL : `${env.ORBIT_URL}/`);
  return { url: url.toString(), init: { method, headers, body, redirect: "manual" } };
}

async function main(argv, env) {
  const [method, path, rawBody] = argv;
  let request;
  try {
    request = buildRequest(method, path, rawBody, env);
  } catch (error) {
    console.error(error.message);
    console.error("使い方: node scripts/orbit-api.mjs <METHOD> <PATH> [JSON]");
    return 2;
  }
  const response = await fetch(request.url, request.init);
  const text = await response.text();
  if (response.status >= 300 && response.status < 400) {
    console.error(
      `HTTP ${response.status}: Cloudflare Accessで弾かれました。Service TokenとService Auth policyを確認してください。`,
    );
    return 1;
  }
  if (text) console.log(text);
  if (!response.ok) {
    console.error(`HTTP ${response.status}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
