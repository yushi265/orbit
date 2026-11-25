import type { D1Database } from "@cloudflare/workers-types";
import { readStoreSnapshot } from "../db/repositories/store-snapshot";
import { calendarDateKeyInTimeZone, issueDueDateKey } from "../shared/issue-dates";
import type { Issue, Priority } from "./model";
import { OrbitStore } from "./store";
import { decodeStoreSnapshot } from "./store-snapshot-compat";

const SECTION_LIMIT = 20;
const PRIORITY_ORDER: Priority[] = ["urgent", "high", "medium", "low", "no_priority"];
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export interface DailyDigestCounts {
  overdue: number;
  today: number;
  cycle: number;
}

export interface DailyDigest {
  subject: string;
  text: string;
  counts: DailyDigestCounts;
}

export interface DailyDigestEmailBinding {
  send(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

export interface DailyDigestEnv {
  DB?: D1Database;
  EMAIL?: DailyDigestEmailBinding;
  ORBIT_DIGEST_FROM?: string;
  ORBIT_DIGEST_TO?: string;
  ORBIT_APP_URL?: string;
  OWNER_USER_ID?: string;
}

export type DailyDigestResult =
  | { status: "sent"; counts: DailyDigestCounts }
  | { status: "skipped"; reason: "missing-config" | "snapshot-missing" | "empty" };

// 保存済みの dueAt が Date で表せない値でも、その1件のせいでダイジェスト全体を止めない。
function dueDateKey(dueAt: number | null): string | null {
  if (dueAt === null || !Number.isFinite(new Date(dueAt).getTime())) return null;
  return issueDueDateKey(dueAt);
}

function shortDate(dateKey: string): string {
  const [, month, date] = dateKey.split("-");
  return `${Number(month)}/${Number(date)}`;
}

function byPriorityThenIdentifier(a: Issue, b: Issue): number {
  return (
    PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.number - b.number
  );
}

function byDueThenPriority(a: Issue, b: Issue): number {
  return (a.dueAt ?? 0) - (b.dueAt ?? 0) || byPriorityThenIdentifier(a, b);
}

function renderSection(
  heading: string,
  issues: Issue[],
  appUrl: string,
  withDue: boolean,
): string[] {
  if (issues.length === 0) return [];
  const lines = [`■ ${heading}（${issues.length}）`];
  for (const issue of issues.slice(0, SECTION_LIMIT)) {
    const dueKey = withDue ? dueDateKey(issue.dueAt) : null;
    const due = dueKey ? `（期限 ${shortDate(dueKey)}）` : "";
    lines.push(`- ${issue.identifier} ${issue.title}${due}`, `  ${appUrl}/issues/${issue.id}`);
  }
  if (issues.length > SECTION_LIMIT) lines.push(`- ほか${issues.length - SECTION_LIMIT}件`);
  lines.push("");
  return lines;
}

export function buildDailyDigest(
  store: OrbitStore,
  userId: string,
  now: number,
  appUrl: string,
): DailyDigest | null {
  const snapshot = store.toSnapshot();
  const baseUrl = appUrl.replace(/\/+$/, "");
  const timeZone =
    snapshot.preferences.find((preference) => preference.userId === userId)?.timezone ?? "UTC";
  const today = calendarDateKeyInTimeZone(now, timeZone);
  const closedStates = new Set(
    snapshot.workflowStates
      .filter((state) => state.category === "completed" || state.category === "canceled")
      .map((state) => state.id),
  );
  const activeCycle = snapshot.cycles.find(
    (cycle) => cycle.userId === userId && cycle.status === "active",
  );
  const open = snapshot.issues.filter(
    (issue) =>
      issue.userId === userId &&
      issue.deletedAt === null &&
      issue.archivedAt === null &&
      !closedStates.has(issue.statusId),
  );

  const overdue: Issue[] = [];
  const dueToday: Issue[] = [];
  const cycle: Issue[] = [];
  for (const issue of open) {
    const due = dueDateKey(issue.dueAt);
    if (due !== null && due < today) overdue.push(issue);
    else if (due === today) dueToday.push(issue);
    else if (activeCycle && issue.cycleId === activeCycle.id) cycle.push(issue);
  }
  if (overdue.length + dueToday.length + cycle.length === 0) return null;

  overdue.sort(byDueThenPriority);
  dueToday.sort(byPriorityThenIdentifier);
  cycle.sort(byPriorityThenIdentifier);

  const counts = { overdue: overdue.length, today: dueToday.length, cycle: cycle.length };
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00.000Z`).getUTCDay()];
  const cycleName = activeCycle ? (activeCycle.nameOverride ?? activeCycle.name) : "Cycle";
  const text = [
    "おはようございます。orbitの今日のまとめです。",
    "",
    ...renderSection("期限切れ", overdue, baseUrl, true),
    ...renderSection("今日期限", dueToday, baseUrl, false),
    ...renderSection(`${cycleName} の未完了`, cycle, baseUrl, true),
    `${baseUrl}/`,
    "",
  ].join("\n");
  return {
    subject: `orbit ${shortDate(today)}(${weekday}) 期限切れ${counts.overdue}・今日${counts.today}・Cycle${counts.cycle}`,
    text,
    counts,
  };
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string")
    return error.code;
  return "unknown";
}

export async function runDailyDigest(
  env: DailyDigestEnv,
  now: number,
  log: (line: string) => void = (line) => console.log(line),
): Promise<DailyDigestResult> {
  const required = [
    "DB",
    "EMAIL",
    "ORBIT_DIGEST_FROM",
    "ORBIT_DIGEST_TO",
    "ORBIT_APP_URL",
    "OWNER_USER_ID",
  ] as const;
  const missing = required.filter((key) => !env[key]);
  const { DB: database, EMAIL: email, ORBIT_DIGEST_FROM: from, ORBIT_DIGEST_TO: to } = env;
  const { ORBIT_APP_URL: appUrl, OWNER_USER_ID: userId } = env;
  if (missing.length > 0 || !database || !email || !from || !to || !appUrl || !userId) {
    log(`daily-digest skipped: missing-config: ${missing.join(",")}`);
    return { status: "skipped", reason: "missing-config" };
  }

  const row = await readStoreSnapshot(database, userId);
  if (!row) {
    log("daily-digest skipped: snapshot-missing");
    return { status: "skipped", reason: "snapshot-missing" };
  }
  const store = OrbitStore.fromSnapshot(decodeStoreSnapshot(row.snapshot), undefined, userId);
  const digest = buildDailyDigest(store, userId, now, appUrl);
  if (!digest) {
    log("daily-digest skipped: empty");
    return { status: "skipped", reason: "empty" };
  }

  try {
    await email.send({ from, to, subject: digest.subject, text: digest.text });
  } catch (error) {
    // 元の例外はメッセージに宛先を含みうるので、コードだけの例外に置き換えて Cron を失敗にする。
    const message = `daily-digest send failed: ${errorCode(error)}`;
    log(message);
    throw new Error(message);
  }
  const { counts } = digest;
  log(`daily-digest sent: overdue=${counts.overdue} today=${counts.today} cycle=${counts.cycle}`);
  return { status: "sent", counts };
}
