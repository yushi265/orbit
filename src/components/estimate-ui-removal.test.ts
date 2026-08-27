import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const orbitApp = readFileSync(resolve(process.cwd(), "src/components/OrbitApp.tsx"), "utf8");

describe("Estimate UI removal contract", () => {
  it("[代表値] 現行UIからEstimateとScope pointsの導線を外す", () => {
    expect(orbitApp).not.toContain("Scope points");
    expect(orbitApp).not.toContain('aria-label="IssueのEstimate"');
    expect(orbitApp).not.toContain('aria-label="新しいIssueのEstimate"');
    expect(orbitApp).not.toContain("Estimateを有効にする");
    expect(orbitApp).not.toContain('["estimate", "Estimate"]');
    expect(orbitApp).not.toMatch(/\bestimateEnabled\b/);
    expect(orbitApp).not.toMatch(/\bestimateTotal\b/);
  });

  it("[互換性] Estimateを扱うServer層はUI撤去の対象外である", () => {
    const store = readFileSync(resolve(process.cwd(), "src/server/store.ts"), "utf8");
    expect(store).toContain("estimate");
    expect(store).toContain("estimateEnabled");
  });
});
