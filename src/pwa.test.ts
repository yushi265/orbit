import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

    expect(manifest.name).toBeTruthy();
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

  it("links the raster touch icon and versioned manifest from the root document", () => {
    const rootRoute = readFileSync(resolve(process.cwd(), "src/routes/__root.tsx"), "utf8");
    expect(rootRoute).toContain("manifest.webmanifest?v=4");
    expect(rootRoute).toContain("icon-192.png?v=4");
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
