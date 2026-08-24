import { describe, expect, it } from "vitest";
import { NO_PROJECT_OPTION, projectIdFromSelection } from "./issue-project";

describe("Issue Project selection", () => {
  it("[代表値] 選択したProject IDをそのまま返す", () => {
    expect(projectIdFromSelection("project-1")).toBe("project-1");
  });

  it("[境界値] 未選択とProjectなしはnullへ変換する", () => {
    expect(projectIdFromSelection("")).toBeNull();
    expect(NO_PROJECT_OPTION).toBe("__none__");
    expect(projectIdFromSelection("__none__")).toBeNull();
  });
});
