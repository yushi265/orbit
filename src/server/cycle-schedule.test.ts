import { describe, expect, it } from "vitest";
import { cycleEndAt, localDateAtMidnight, nextCycleStartAt } from "./cycle-schedule";

describe("Cycle schedule helper", () => {
  it("[代表値] UTCの指定曜日00:00以降へ開始日を揃え、期間を暦週で加算する", () => {
    const anchor = Date.parse("2024-01-03T12:00:00.000Z");
    const startsAt = nextCycleStartAt(anchor, 1, "UTC");

    expect(new Date(startsAt).toISOString()).toBe("2024-01-08T00:00:00.000Z");
    expect(new Date(cycleEndAt(startsAt, 2, "UTC")).toISOString()).toBe("2024-01-22T00:00:00.000Z");
  });

  it("[代表値] Asia/Tokyoでは指定曜日の現地00:00をUTCへ変換する", () => {
    const anchor = Date.parse("2024-01-03T12:00:00.000Z");

    expect(new Date(nextCycleStartAt(anchor, 1, "Asia/Tokyo")).toISOString()).toBe(
      "2024-01-07T15:00:00.000Z",
    );
  });

  it("[境界値] DST境界をまたいでも現地00:00の曜日と暦週を保つ", () => {
    const anchor = Date.parse("2024-03-08T18:00:00.000Z");
    const startsAt = nextCycleStartAt(anchor, 1, "America/New_York");

    expect(new Date(startsAt).toISOString()).toBe("2024-03-11T04:00:00.000Z");
    expect(new Date(cycleEndAt(startsAt, 1, "America/New_York")).toISOString()).toBe(
      "2024-03-18T04:00:00.000Z",
    );
  });

  it("[状態遷移] CooldownはDST境界でも暦週として指定曜日の00:00へ加算する", () => {
    const cycleEndBeforeDst = Date.parse("2024-03-04T05:00:00.000Z");

    expect(
      new Date(nextCycleStartAt(cycleEndBeforeDst, 1, "America/New_York", 1)).toISOString(),
    ).toBe("2024-03-11T04:00:00.000Z");
  });

  it("[代表値] YYYY-MM-DDを指定Timezoneの00:00へ変換する", () => {
    expect(new Date(localDateAtMidnight("2026-01-01", "Asia/Tokyo")).toISOString()).toBe(
      "2025-12-31T15:00:00.000Z",
    );
    expect(new Date(localDateAtMidnight("2024-07-01", "America/New_York")).toISOString()).toBe(
      "2024-07-01T04:00:00.000Z",
    );
    expect(new Date(localDateAtMidnight("2024-03-11", "America/New_York")).toISOString()).toBe(
      "2024-03-11T04:00:00.000Z",
    );
  });

  it("[境界値] 存在しない日付はlocal midnightへ変換しない", () => {
    expect(() => localDateAtMidnight("2026-02-30", "UTC")).toThrow(RangeError);
    expect(() => localDateAtMidnight("2026-1-1", "UTC")).toThrow(RangeError);
  });

  it("[境界値] 0001年の日付を別の年へずらさず変換する", () => {
    expect(new Date(localDateAtMidnight("0001-01-01", "UTC")).toISOString()).toBe(
      "0001-01-01T00:00:00.000Z",
    );
  });

  it("[境界値] DSTで存在しないTimezoneの00:00は拒否する", () => {
    expect(() => localDateAtMidnight("2018-11-04", "America/Sao_Paulo")).toThrow(RangeError);
  });
});
