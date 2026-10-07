import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import appCss from "./styles.css?url";
import { Route } from "./routes/__root";

vi.mock("./styles.css?url", () => ({ default: "/assets/styles-abc123.css" }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("root stylesheet URL", () => {
  it("[状態遷移] developmentはViteのstylesheet URLをquery追加せず配信する", async () => {
    vi.stubEnv("DEV", true);

    const head = await Route.options.head?.({} as never);
    const stylesheet = head?.links?.find((link) => link?.rel === "stylesheet");

    expect(stylesheet?.href).toBe(appCss);
    expect(new URL(stylesheet!.href!, "https://orbit.test").searchParams.has("v")).toBe(false);
  });

  it("[状態遷移] productionはViteのasset URLと既存versionを維持する", async () => {
    vi.stubEnv("DEV", false);

    const head = await Route.options.head?.({} as never);
    const stylesheet = head?.links?.find((link) => link?.rel === "stylesheet");
    const url = new URL(stylesheet!.href!, "https://orbit.test");

    expect(url.pathname).toBe(new URL(appCss, "https://orbit.test").pathname);
    expect(url.searchParams.get("v")).toBe("5");
  });
});

describe("PWA manifest", () => {
  it("ships raster icons required by Chromium installability checks", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
    ) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(manifest.name).toBe("Orbit");
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
      ]),
    );
    expect(manifest.icons.some((icon) => icon.src.startsWith("/icon-192.png"))).toBe(true);
    expect(manifest.icons.some((icon) => icon.src.startsWith("/icon-512.png"))).toBe(true);
    expect(readFileSync(resolve(process.cwd(), "public/icon-192.png")).byteLength).toBeGreaterThan(
      0,
    );
    expect(readFileSync(resolve(process.cwd(), "public/icon-512.png")).byteLength).toBeGreaterThan(
      0,
    );
  });

  it("keeps the service worker cache limited to static assets", () => {
    const serviceWorker = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    expect(serviceWorker).toContain("orbit-static-v4");
    expect(serviceWorker).not.toContain("manifest.webmanifest");
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain("!response.redirected");
    expect(serviceWorker).toContain("STATIC_CONTENT_TYPE");
  });

  it("links the raster touch icon and versioned manifest from the root document", async () => {
    const head = await Route.options.head?.({} as never);
    const manifest = head?.links?.find((link) => link?.rel === "manifest");
    const touchIcon = head?.links?.find((link) => link?.rel === "apple-touch-icon");

    expect(manifest?.href).toBe("/manifest.webmanifest?v=4");
    expect(touchIcon?.href).toBe("/icon-192.png?v=4");
    expect(touchIcon?.type).toBe("image/png");
  });

  it("[代表値] extends the viewport into the safe area with viewport-fit=cover", async () => {
    const head = await Route.options.head?.({} as never);
    const viewport = head?.meta?.find((meta) => meta && "name" in meta && meta.name === "viewport");

    expect(viewport).toMatchObject({
      content: "width=device-width, initial-scale=1, viewport-fit=cover",
    });
  });

  it("declares cache and content-type headers for PWA assets", () => {
    const headers = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");

    expect(headers).toContain("/manifest.webmanifest");
    expect(headers).toContain("Content-Type: application/manifest+json");
    expect(headers).toContain("/sw.js");
    expect(headers).toContain("Content-Type: application/javascript");
    expect(headers).toContain("/icon-192.png");
    expect(headers).toContain("/icon-512.png");
  });
});
