import {
  calendarDateKeyInTimeZone,
  formatIssueDueDate,
  issueDueDateKey,
} from "../../shared/issue-dates";

// 日付表示・日付入力の変換 helper（旧 OrbitApp.tsx から抽出）。暦日の正本は shared/issue-dates。

export function formatDate(value: number | null): string {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

/** UTC 暦日（期限・目標日）を表示する。null は「未設定」。 */
export function formatDateOnly(value: number | null): string {
  return value === null ? "未設定" : formatIssueDueDate(value);
}

export function dateInputValue(value: number | null): string {
  return value === null ? "" : issueDueDateKey(value);
}

export function formatRange(start: number, end: number): string {
  return `${formatDate(start)} — ${formatDate(end)}`;
}

export function formatDateTime(value: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(value));
}

/** timeZone 省略時は実行環境の既定 Timezone の暦日（Intl の既定と同じ）。 */
export function dateInputValueInTimeZone(value: number, timeZone?: string): string {
  return calendarDateKeyInTimeZone(
    value,
    timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

export function dateInputToUnix(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return Date.UTC(year, month - 1, day);
}

export function dismissOpenCalendar(container: HTMLElement | null): boolean {
  const trigger = container
    ?.querySelector(".orbit-calendar")
    ?.closest(".orbit-date-picker")
    ?.querySelector<HTMLButtonElement>(".orbit-calendar-trigger");
  if (!trigger) return false;
  trigger.click();
  trigger.focus();
  return true;
}
