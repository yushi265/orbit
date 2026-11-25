import { describe, expect, it, vi } from "vitest";

const fetchHandler = vi.fn(async () => new Response("ok"));
const runDailyDigest = vi.fn(async () => ({ status: "skipped", reason: "empty" }));

vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: fetchHandler } }));
vi.mock("./server/daily-digest", () => ({ runDailyDigest }));

describe("worker server entry", () => {
  it("[代表値] fetchはTanStack Startの既定handlerに委譲する", async () => {
    const { default: worker } = await import("./server");
    const request = new Request("https://orbit.example.test/");

    const response = await worker.fetch(request);

    expect(fetchHandler).toHaveBeenCalledWith(request);
    expect(await response.text()).toBe("ok");
  });

  it("[代表値] scheduledはscheduledTimeでrunDailyDigestを呼びwaitUntilへ渡す", async () => {
    const { default: worker } = await import("./server");
    const env = { ORBIT_APP_URL: "https://orbit.example.test" };
    const waitUntil = vi.fn();

    worker.scheduled({ scheduledTime: 1_764_109_800_000 }, env, { waitUntil });

    expect(runDailyDigest).toHaveBeenCalledWith(env, 1_764_109_800_000);
    expect(waitUntil).toHaveBeenCalledWith(runDailyDigest.mock.results[0]!.value);
  });
});
