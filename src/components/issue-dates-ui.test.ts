import { describe, expect, it } from "vitest";
import { buildHomeSummary, homeRelativeDay } from "./home";
import { filterIssuesByDue } from "./issue-list";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

const dueDate = Date.UTC(2026, 9, 2);
const boundary = Date.UTC(2026, 9, 1, 15);

describe("Issue due date calendar semantics", () => {
  it.each([
    ["Asia/Tokyo", "today", "今日"],
    ["America/Los_Angeles", "upcoming", "7日以内"],
    ["UTC", "upcoming", "7日以内"],
  ] as const)(
    "[Timezone境界] %sのtodayだけを使い保存期限のUTC日を動かさない",
    (timezone, category, relative) => {
      const issue = reviewIssue("date-only", { dueAt: dueDate });
      const data = reviewBootstrap([issue]);
      data.preferences.timezone = timezone;
      const summary = buildHomeSummary(data, boundary);
      expect(filterIssuesByDue([issue], category, boundary, timezone)).toEqual([issue]);
      expect(
        filterIssuesByDue([issue], category === "today" ? "upcoming" : "today", boundary, timezone),
      ).toEqual([]);
      expect(category === "today" ? summary.dueToday : summary.dueSoon).toEqual([issue]);
      expect(summary.overdue).toEqual([]);
      expect(homeRelativeDay(dueDate, boundary, timezone)).toBe(relative);
      expect(issue.dueAt).toBe(dueDate);
    },
  );
  it("[既存非midnight] UTC年月日を使いTokyoの翌日へ変換しない", () => {
    const late = reviewIssue("late", { dueAt: Date.UTC(2026, 9, 2, 23, 59) });
    const data = reviewBootstrap([late]);
    const now = Date.UTC(2026, 9, 2, 3);
    expect(filterIssuesByDue([late], "today", now, "Asia/Tokyo")).toEqual([late]);
    expect(buildHomeSummary(data, now).dueToday).toEqual([late]);
    expect(homeRelativeDay(late.dueAt!, now, "Asia/Tokyo")).toBe("今日");
  });
  it.each([Date.UTC(2026, 2, 7, 20), Date.UTC(2026, 9, 31, 19)])(
    "[DST/暦日7日] LAの7日目までを含め8日目は除外する now=%i",
    (now) => {
      const origin = new Date(now);
      const seven = Date.UTC(
        origin.getUTCFullYear(),
        origin.getUTCMonth(),
        origin.getUTCDate() + 7,
      );
      const eight = Date.UTC(
        origin.getUTCFullYear(),
        origin.getUTCMonth(),
        origin.getUTCDate() + 8,
      );
      const issues = [
        reviewIssue("seven", { dueAt: seven }),
        reviewIssue("eight", { dueAt: eight }),
      ];
      const data = reviewBootstrap(issues);
      data.preferences.timezone = "America/Los_Angeles";
      expect(buildHomeSummary(data, now).dueSoon.map((issue) => issue.id)).toEqual(["seven"]);
      expect(homeRelativeDay(seven, now, data.preferences.timezone)).toBe("7日以内");
      expect(homeRelativeDay(eight, now, data.preferences.timezone)).toBe("今後");
    },
  );
  it.each([Date.UTC(2026, 2, 8, 9, 30), Date.UTC(2026, 2, 8, 10, 30)])(
    "[DST前後] LAの日付が同じならtoday判定は変わらない now=%i",
    (now) => {
      const issue = reviewIssue("dst", { dueAt: Date.UTC(2026, 2, 8) });
      expect(filterIssuesByDue([issue], "today", now, "America/Los_Angeles")).toEqual([issue]);
    },
  );
  it("[none/overdue] 未設定と過去日を同じ日付ルールで分ける", () => {
    const issues = [reviewIssue("none"), reviewIssue("past", { dueAt: Date.UTC(2026, 9, 1) })];
    expect(
      filterIssuesByDue(issues, "none", boundary, "Asia/Tokyo").map((issue) => issue.id),
    ).toEqual(["none"]);
    expect(
      filterIssuesByDue(issues, "overdue", boundary, "Asia/Tokyo").map((issue) => issue.id),
    ).toEqual(["past"]);
  });
});
