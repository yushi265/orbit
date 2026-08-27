import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OWNER_ID_MAX_LENGTH = 200;
const OWNER_NAME_MAX_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textLength(value) {
  return Array.from(value).length;
}

function hasControlCharacters(value) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function parseBootstrapConfig(environment) {
  const userId = environment.OWNER_USER_ID?.trim() ?? "";
  const email = environment.OWNER_EMAIL?.trim() ?? "";
  const name = environment.ORBIT_OWNER_NAME?.trim() || "Orbit User";
  if (!userId || textLength(userId) > OWNER_ID_MAX_LENGTH || hasControlCharacters(userId))
    throw new Error("OWNER_USER_ID is missing or invalid");
  if (
    !EMAIL_PATTERN.test(email) ||
    textLength(email) > OWNER_ID_MAX_LENGTH ||
    hasControlCharacters(email)
  )
    throw new Error("OWNER_EMAIL is missing or invalid");
  if (!name || textLength(name) > OWNER_NAME_MAX_LENGTH || hasControlCharacters(name))
    throw new Error("ORBIT_OWNER_NAME is invalid");
  return { userId, email, name };
}

export function buildBootstrapSql({ userId, email, name, now }) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("bootstrap timestamp is invalid");
  const ownerId = sqlLiteral(userId);
  const ownerEmail = sqlLiteral(email);
  const ownerName = sqlLiteral(name);
  const timestamp = String(now);
  return [
    `INSERT INTO users (id, name, email, avatar_url, created_at) VALUES (${ownerId}, ${ownerName}, ${ownerEmail}, NULL, ${timestamp}) ON CONFLICT(id) DO NOTHING;`,
    `INSERT INTO user_preferences (user_id, timezone, locale, theme, color_theme, issue_counter, estimate_enabled, default_issue_display_json) VALUES (${ownerId}, 'Asia/Tokyo', 'ja', 'system', 'coral', 0, 1, '{}') ON CONFLICT(user_id) DO NOTHING;`,
    `INSERT INTO user_runtime_locks (user_id, run_id, lock_token, status, acquired_at, heartbeat_at, lease_expires_at) VALUES (${ownerId}, NULL, NULL, 'idle', NULL, NULL, NULL) ON CONFLICT(user_id) DO NOTHING;`,
  ].join("\n");
}

export async function runBootstrap(environment = process.env, execute = execFileAsync) {
  const config = parseBootstrapConfig(environment);
  const sql = buildBootstrapSql({ ...config, now: Date.now() });
  await execute(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "orbit",
      "--remote",
      "--config",
      "wrangler.jsonc",
      "--env",
      "production",
      "--command",
      sql,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  runBootstrap()
    .then(() => console.log("Production Owner bootstrap completed."))
    .catch(() => {
      console.error(
        "Production Owner bootstrap failed. Check the required environment and D1 access.",
      );
      process.exitCode = 1;
    });
}
