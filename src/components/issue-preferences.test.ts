import { describe, expect, it } from "vitest";
import { parseShowCompletedPreference } from "./issue-preferences";

describe("Issue list preferences", () => {
  it("parses persisted completed visibility values", () => {
    expect(parseShowCompletedPreference("true")).toBe(true);
    expect(parseShowCompletedPreference("false")).toBe(false);
    expect(parseShowCompletedPreference(null)).toBeUndefined();
    expect(parseShowCompletedPreference("invalid")).toBeUndefined();
  });
});
