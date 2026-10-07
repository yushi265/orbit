import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { calendarDateKeyInTimeZone, formatIssueDueDate } from "../../shared/issue-dates";
import {
  dateInputToUnix,
  dateInputValue,
  dateInputValueInTimeZone,
  dismissOpenCalendar,
  formatDate,
  formatDateOnly,
  formatDateTime,
  formatRange,
} from "./date-format";

// 旧 OrbitApp.tsx の実装（統合前の正本）。統合後も同じ出力になることを固定する。
function legacyDateInputValueInTimeZone(value: number, timeZone?: string): string {
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
function legacyFormatDateOnly(value: number | null): string {
  if (value === null) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

const boundaries = [
  Date.UTC(2026, 9, 6, 23, 59, 59, 999),
  Date.UTC(2026, 9, 7, 0, 0, 0, 0),
  Date.UTC(2026, 9, 7, 14, 59, 59, 999),
  Date.UTC(2026, 9, 7, 15, 0, 0, 0),
];

describe("ui/date-format", () => {
  it.each(["Asia/Tokyo", "UTC", "America/Los_Angeles", undefined])(
    "[境界値] dateInputValueInTimeZone は timeZone=%s で旧実装・calendarDateKeyInTimeZone と同じ暦日を返す",
    (timeZone) => {
      for (const value of boundaries) {
        expect(dateInputValueInTimeZone(value, timeZone)).toBe(
          legacyDateInputValueInTimeZone(value, timeZone),
        );
        if (timeZone)
          expect(dateInputValueInTimeZone(value, timeZone)).toBe(
            calendarDateKeyInTimeZone(value, timeZone),
          );
      }
    },
  );

  it("[同値分割] formatDateOnly は値ありなら formatIssueDueDate と同じ、null なら「未設定」", () => {
    for (const value of boundaries) {
      expect(formatDateOnly(value)).toBe(formatIssueDueDate(value));
      expect(formatDateOnly(value)).toBe(legacyFormatDateOnly(value));
    }
    expect(formatDateOnly(null)).toBe("未設定");
  });
});

describe("ui/date-format の移動した helper（旧実装と同じ出力を固定）", () => {
  const tokyoMidnight = Date.UTC(2026, 9, 6, 15, 0, 0, 0);

  it("[同値分割] formatDate は null と 0 を「未設定」、値ありを月日で返す", () => {
    expect(formatDate(null)).toBe("未設定");
    expect(formatDate(0)).toBe("未設定");
    expect(formatDate(tokyoMidnight)).toBe(
      new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(
        new Date(tokyoMidnight),
      ),
    );
  });

  it("[代表値] formatRange は開始と終了を「 — 」で結ぶ", () => {
    expect(formatRange(tokyoMidnight, tokyoMidnight)).toBe(
      `${formatDate(tokyoMidnight)} — ${formatDate(tokyoMidnight)}`,
    );
  });

  it("[代表値] formatDateTime は指定 Timezone の 24 時間表記", () => {
    expect(formatDateTime(tokyoMidnight, "Asia/Tokyo")).toBe("10月7日 00:00");
    expect(formatDateTime(tokyoMidnight, "UTC")).toBe("10月6日 15:00");
  });

  it("[同値分割] dateInputValue は null を空文字、値ありを UTC 暦日にする", () => {
    expect(dateInputValue(null)).toBe("");
    expect(dateInputValue(Date.UTC(2026, 9, 6, 23, 59))).toBe("2026-10-06");
  });

  it.each([
    ["", null],
    ["2026-10-07", Date.UTC(2026, 9, 7)],
    ["2026-xx-07", null],
  ])("[同値分割] dateInputToUnix(%j) は %s", (value, expected) => {
    expect(dateInputToUnix(value)).toBe(expected);
  });
});

describe("dismissOpenCalendar", () => {
  function picker(open: boolean) {
    const { document } = new JSDOM(
      `<div id="container"><div class="orbit-date-picker"><button class="orbit-calendar-trigger">日付</button>${
        open ? '<div class="orbit-calendar"></div>' : ""
      }</div></div>`,
    ).window;
    const trigger = document.querySelector(".orbit-calendar-trigger") as HTMLButtonElement;
    const clicked = vi.fn();
    trigger.addEventListener("click", clicked);
    return { document, container: document.getElementById("container"), trigger, clicked };
  }

  it("[同値分割] 開いたカレンダーがあればトリガーを押してフォーカスを戻し true を返す", () => {
    const { document, container, trigger, clicked } = picker(true);
    expect(dismissOpenCalendar(container)).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });

  it("[同値分割] 開いたカレンダーが無い・container が null なら何もせず false", () => {
    const { container, clicked } = picker(false);
    expect(dismissOpenCalendar(container)).toBe(false);
    expect(dismissOpenCalendar(null)).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });
});
