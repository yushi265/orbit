import { describe, expect, it } from "vitest";
import { activityTitle } from "./OrbitApp";

describe("Issue activity UI", () => {
  it("[代表値] system:automationをAutomationとして表示する", () => {
    expect(activityTitle({ action: "cycle.auto_assigned", actorType: "system:automation" })).toBe(
      "Automation",
    );
    expect(activityTitle({ action: "updated", actorType: "user" })).toBe("updated");
  });
});
