import { describe, expect, it } from "vitest";
import { redirectAccessLogin } from "./login";

describe("Access login fallback", () => {
  it("redirects relative returnTo paths to the Worker root", () => {
    const response = redirectAccessLogin(
      new Request("https://orbit.example/cdn-cgi/access/login?returnTo=%2Fsettings"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://orbit.example/settings");
  });

  it("does not allow an external returnTo redirect", () => {
    const response = redirectAccessLogin(
      new Request("https://orbit.example/cdn-cgi/access/login?returnTo=https%3A%2F%2Fevil.example"),
    );

    expect(response.headers.get("location")).toBe("https://orbit.example/");
  });
});
