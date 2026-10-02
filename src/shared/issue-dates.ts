// dueAt carries a calendar date; its UTC year/month/day must not shift with the Owner timezone.
export function issueDueDateKey(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function calendarDateKeyInTimeZone(value: number, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function matchesIssueDueDate(
  dueAt: number | null,
  filter: "none" | "overdue" | "today" | "upcoming" | "next7",
  now: number,
  timeZone: string,
): boolean {
  if (filter === "none") return dueAt === null;
  if (dueAt === null) return false;
  const due = issueDueDateKey(dueAt);
  const today = calendarDateKeyInTimeZone(now, timeZone);
  if (filter === "overdue") return due < today;
  if (filter === "today") return due === today;
  if (filter === "next7") {
    const lastDay = new Date(`${today}T00:00:00.000Z`);
    lastDay.setUTCDate(lastDay.getUTCDate() + 7);
    return due > today && due <= issueDueDateKey(lastDay.getTime());
  }
  return due > today;
}

export function formatIssueDueDate(value: number, locale = "ja-JP"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
