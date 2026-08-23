import { describe, expect, it } from "vitest";

import { canonicalJson, hashCanonicalRequest } from "./canonical-json";

describe("Canonical JSON", () => {
  it("[代表値] object key を順序化し、undefined の object property を省略する", () => {
    expect(
      canonicalJson({
        z: 1,
        a: 2,
        omitted: undefined,
        nested: { z: true, a: false },
      }),
    ).toBe('{"a":2,"nested":{"a":false,"z":true},"z":1}');
  });

  it("[同値分割] idempotencyKey、空条件、順序だけが異なる request は同じ hash になる", async () => {
    const first = await hashCanonicalRequest("issue.list", {
      idempotencyKey: "first-key",
      mode: "list",
      filter: {
        priorities: ["urgent", "high"],
        statusIds: [],
      },
      showEmptyGroups: false,
      order: "updated",
      layout: { title: true, priority: true },
      limit: 50,
    });
    const second = await hashCanonicalRequest("issue.list", {
      idempotencyKey: "second-key",
      order: "updated",
      layout: { priority: true, title: true },
      limit: 50,
      showEmptyGroups: false,
      filter: { priorities: ["high", "urgent"] },
      mode: "list",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[代表値] operation または意味のある payload が違う request は異なる hash になる", async () => {
    const base = { idempotencyKey: "key", title: "同じ" };
    const operationHash = await hashCanonicalRequest("issue.create", base);
    const otherOperationHash = await hashCanonicalRequest("issue.update", base);
    const otherPayloadHash = await hashCanonicalRequest("issue.create", {
      ...base,
      title: "違う",
    });

    expect(operationHash).not.toBe(otherOperationHash);
    expect(operationHash).not.toBe(otherPayloadHash);
  });
});
