import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-client";

describe("api client authentication recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries the current top-level URL instead of navigating to a Worker login path", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/issues/issue-1", search: "?from=inbox", hash: "#detail", assign },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "login" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(apiRequest("/api/v1/bootstrap")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(assign).toHaveBeenCalledWith("/issues/issue-1?from=inbox#detail");
  });
});
