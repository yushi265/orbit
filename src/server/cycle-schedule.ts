import { cycleDateSchema } from "../shared/contracts";

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const SECOND = 1_000;

function localDateTimeParts(timestamp: number, timeZone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) === 24 ? 0 : Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function utcPartsTimestamp(parts: LocalDateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function utcDateAtMidnight(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function localDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const localDate = utcDateAtMidnight(year, month, day);
  const normalizedYear = localDate.getUTCFullYear();
  const normalizedMonth = localDate.getUTCMonth() + 1;
  const normalizedDay = localDate.getUTCDate();
  const localTimestamp = localDate.setUTCHours(hour, minute, second, 0);
  let candidate = localTimestamp;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = utcPartsTimestamp(localDateTimeParts(candidate, timeZone));
    const candidateWithoutMilliseconds = Math.floor(candidate / SECOND) * SECOND;
    candidate = localTimestamp - (actual - candidateWithoutMilliseconds);
  }
  const resolved = localDateTimeParts(candidate, timeZone);
  if (
    resolved.year !== normalizedYear ||
    resolved.month !== normalizedMonth ||
    resolved.day !== normalizedDay ||
    resolved.hour !== hour ||
    resolved.minute !== minute ||
    resolved.second !== second
  )
    throw new RangeError("local date/time does not exist in the requested timezone");
  return candidate;
}

function assertWeekday(startWeekday: number): void {
  if (!Number.isInteger(startWeekday) || startWeekday < 0 || startWeekday > 6)
    throw new RangeError("startWeekday must be an integer between 0 and 6");
}

function assertDuration(durationWeeks: number): void {
  if (!Number.isInteger(durationWeeks) || durationWeeks < 1)
    throw new RangeError("durationWeeks must be a positive integer");
}

function assertCooldown(cooldownWeeks: number): void {
  if (!Number.isInteger(cooldownWeeks) || cooldownWeeks < 0 || cooldownWeeks > 4)
    throw new RangeError("cooldownWeeks must be an integer between 0 and 4");
}

export function localDateAtMidnight(date: string, timeZone: string): number {
  if (!cycleDateSchema.safeParse(date).success)
    throw new RangeError("date must be a valid YYYY-MM-DD calendar date");
  const [year, month, day] = date.split("-").map(Number);
  return localDateTimeToUtc(year, month, day, 0, 0, 0, timeZone);
}

export function nextCycleStartAt(
  anchor: number,
  startWeekday: number,
  timeZone: string,
  cooldownWeeks = 0,
): number {
  assertWeekday(startWeekday);
  assertCooldown(cooldownWeeks);
  const local = localDateTimeParts(anchor, timeZone);
  const cooldownDate = utcDateAtMidnight(local.year, local.month, local.day + cooldownWeeks * 7);
  const currentWeekday = cooldownDate.getUTCDay();
  let daysUntilStart = (startWeekday - currentWeekday + 7) % 7;
  const candidateDate = new Date(cooldownDate);
  candidateDate.setUTCDate(candidateDate.getUTCDate() + daysUntilStart);
  let candidate = localDateTimeToUtc(
    candidateDate.getUTCFullYear(),
    candidateDate.getUTCMonth() + 1,
    candidateDate.getUTCDate(),
    0,
    0,
    0,
    timeZone,
  );
  if (candidate < anchor) {
    candidateDate.setUTCDate(candidateDate.getUTCDate() + 7);
    candidate = localDateTimeToUtc(
      candidateDate.getUTCFullYear(),
      candidateDate.getUTCMonth() + 1,
      candidateDate.getUTCDate(),
      0,
      0,
      0,
      timeZone,
    );
  }
  return candidate;
}

export function cycleEndAt(startsAt: number, durationWeeks: number, timeZone: string): number {
  assertDuration(durationWeeks);
  const local = localDateTimeParts(startsAt, timeZone);
  return localDateTimeToUtc(
    local.year,
    local.month,
    local.day + durationWeeks * 7,
    local.hour,
    local.minute,
    local.second,
    timeZone,
  );
}
