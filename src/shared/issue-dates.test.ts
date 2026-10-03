import { describe, expect, it } from "vitest";
import {
  calendarDateKeyInTimeZone,
  formatIssueDueDate,
  issueDueDateKey,
  matchesIssueDueDate,
} from "./issue-dates";

describe("Issue期限の日付契約", () => {
  it("[境界値] next7は8日後の期限を含まず、upcomingは引き続き含む", () => {
    const now = Date.UTC(2026, 9, 1, 16);
    const eightDaysLater = Date.UTC(2026, 9, 10);
    expect(matchesIssueDueDate(eightDaysLater, "next7", now, "Asia/Tokyo")).toBe(false);
    expect(matchesIssueDueDate(eightDaysLater, "upcoming", now, "Asia/Tokyo")).toBe(true);
  });

  it.each([
    [null, false],
    [Date.UTC(2026, 9, 1), false],
    [Date.UTC(2026, 9, 2, 23, 59), false],
    [Date.UTC(2026, 9, 3), true],
    [Date.UTC(2026, 9, 9), true],
    [Date.UTC(2026, 9, 9, 23, 59, 59, 999), true],
    [Date.UTC(2026, 9, 10), false],
  ] as const)("[境界値] next7のnull/昨日/今日/1日後/7日後/8日後: %s", (dueAt, expected) => {
    expect(matchesIssueDueDate(dueAt, "next7", Date.UTC(2026, 9, 1, 16), "Asia/Tokyo")).toBe(
      expected,
    );
  });

  it.each([
    ["2026-03-08T07:30:00Z", "America/Los_Angeles", Date.UTC(2026, 2, 14)],
    ["2026-11-01T06:30:00Z", "America/Los_Angeles", Date.UTC(2026, 10, 7)],
    ["2026-12-31T03:00:00Z", "Asia/Tokyo", Date.UTC(2027, 0, 7)],
    ["2028-02-26T16:00:00Z", "Asia/Tokyo", Date.UTC(2028, 2, 5)],
  ] as const)(
    "[境界値] next7はDST/年越し/閏月でもOwnerの暦日7日後まで: %s",
    (value, timezone, lastDay) => {
      const now = Date.parse(value);
      expect(matchesIssueDueDate(lastDay + 23 * 60 * 60 * 1000, "next7", now, timezone)).toBe(true);
      expect(matchesIssueDueDate(lastDay + 24 * 60 * 60 * 1000, "next7", now, timezone)).toBe(
        false,
      );
    },
  );

  it("[代表値] UTCで保存した期限の年月日を返す", () => {
    expect(issueDueDateKey(Date.UTC(2026, 9, 2))).toBe("2026-10-02");
  });

  it("[境界値] 今日だけはOwnerのTimezoneにおける暦日を返す", () => {
    const now = Date.UTC(2026, 9, 1, 16);
    expect(calendarDateKeyInTimeZone(now, "Asia/Tokyo")).toBe("2026-10-02");
    expect(calendarDateKeyInTimeZone(now, "America/Los_Angeles")).toBe("2026-10-01");
    expect(calendarDateKeyInTimeZone(now, "UTC")).toBe("2026-10-01");
  });

  it("[状態遷移] 同じ保存期限日を保ち、Ownerの今日の違いだけをFilterに反映する", () => {
    const dueAt = Date.UTC(2026, 9, 2);
    const now = Date.UTC(2026, 9, 1, 16);
    expect(matchesIssueDueDate(dueAt, "today", now, "Asia/Tokyo")).toBe(true);
    expect(matchesIssueDueDate(dueAt, "today", now, "America/Los_Angeles")).toBe(false);
    expect(matchesIssueDueDate(dueAt, "upcoming", now, "America/Los_Angeles")).toBe(true);
    expect(matchesIssueDueDate(dueAt, "upcoming", now, "UTC")).toBe(true);
    expect(issueDueDateKey(dueAt)).toBe("2026-10-02");
  });

  it("[代表値] 期限の表示はUTC年月日の月日だけを使う", () => {
    const dueAt = Date.UTC(2026, 0, 1);
    expect(formatIssueDueDate(dueAt)).toBe("1月1日");
    expect(formatIssueDueDate(dueAt, "en-US")).toBe("Jan 1");
  });

  it.each([
    [Date.UTC(2026, 11, 31, 23, 59, 59, 999), "2026-12-31"],
    [Date.UTC(2027, 0, 1), "2027-01-01"],
    [Date.UTC(2028, 1, 29, 23, 59, 59, 999), "2028-02-29"],
    [Date.UTC(2028, 2, 1), "2028-03-01"],
  ])("[境界値] 非midnightの既存値と年・閏月境界をUTC暦日として維持する: %s", (value, date) => {
    expect(issueDueDateKey(value)).toBe(date);
  });

  it.each([
    [null, "none", true],
    [null, "overdue", false],
    [null, "today", false],
    [null, "upcoming", false],
    [Date.UTC(2026, 9, 1, 23, 59), "none", false],
    [Date.UTC(2026, 9, 1, 23, 59), "overdue", true],
    [Date.UTC(2026, 9, 1, 23, 59), "today", false],
    [Date.UTC(2026, 9, 1, 23, 59), "upcoming", false],
    [Date.UTC(2026, 9, 2, 23, 59), "none", false],
    [Date.UTC(2026, 9, 2, 23, 59), "overdue", false],
    [Date.UTC(2026, 9, 2, 23, 59), "today", true],
    [Date.UTC(2026, 9, 2, 23, 59), "upcoming", false],
    [Date.UTC(2026, 9, 3), "none", false],
    [Date.UTC(2026, 9, 3), "overdue", false],
    [Date.UTC(2026, 9, 3), "today", false],
    [Date.UTC(2026, 9, 3), "upcoming", true],
  ] as const)("[デシジョンテーブル] 期限%sと%sの組合せ", (dueAt, filter, expected) => {
    expect(matchesIssueDueDate(dueAt, filter, Date.UTC(2026, 9, 1, 16), "Asia/Tokyo")).toBe(
      expected,
    );
  });

  it.each(["Asia/Tokyo", "America/Los_Angeles", "UTC"])(
    "[同値分割] %sでも同じ保存期限日を同じ日付として判定する",
    (timeZone) => {
      const now = Date.UTC(2026, 9, 2, 12);
      for (const dueAt of [Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 2, 23, 59)]) {
        expect(issueDueDateKey(dueAt)).toBe("2026-10-02");
        expect(matchesIssueDueDate(dueAt, "today", now, timeZone)).toBe(true);
        expect(formatIssueDueDate(dueAt)).toBe("10月2日");
      }
    },
  );

  it.each([
    [Date.UTC(2026, 2, 9, 6, 59, 59, 999), "2026-03-08", Date.UTC(2026, 2, 8)],
    [Date.UTC(2026, 2, 9, 7), "2026-03-09", Date.UTC(2026, 2, 9)],
    [Date.UTC(2026, 10, 2, 7, 59, 59, 999), "2026-11-01", Date.UTC(2026, 10, 1)],
    [Date.UTC(2026, 10, 2, 8), "2026-11-02", Date.UTC(2026, 10, 2)],
  ])("[境界値] LAの23時間・25時間の日も現地midnightで今日が切り替わる: %s", (now, today, dueAt) => {
    expect(calendarDateKeyInTimeZone(now, "America/Los_Angeles")).toBe(today);
    expect(matchesIssueDueDate(dueAt, "today", now, "America/Los_Angeles")).toBe(true);
    expect(matchesIssueDueDate(dueAt, "overdue", now, "America/Los_Angeles")).toBe(false);
    expect(matchesIssueDueDate(dueAt, "upcoming", now, "America/Los_Angeles")).toBe(false);
  });

  it("[境界値] 年末と閏日の既存非midnight値も月日だけで表示する", () => {
    expect(formatIssueDueDate(Date.UTC(2026, 11, 31, 23, 59))).toBe("12月31日");
    expect(formatIssueDueDate(Date.UTC(2028, 1, 29, 23, 59), "en-US")).toBe("Feb 29");
  });
});
