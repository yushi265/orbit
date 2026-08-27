import { describe, expect, it } from "vitest";
import { timezoneOptionsFor } from "./preferences";

describe("Settings preference helpers", () => {
  it("[代表値] keeps the saved timezone available and does not duplicate common options", () => {
    const options = timezoneOptionsFor("Asia/Tokyo");

    expect(options[0]).toBe("Asia/Tokyo");
    expect(options.filter((value) => value === "Asia/Tokyo")).toHaveLength(1);
    expect(options).toContain("UTC");
  });

  it("[境界値] preserves a valid non-standard current timezone without an empty option", () => {
    const options = timezoneOptionsFor("Pacific/Apia");

    expect(options[0]).toBe("Pacific/Apia");
    expect(options).not.toContain("");
  });
});
