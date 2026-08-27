import { describe, expect, it } from "vitest";
import { buildBootstrapSql, parseBootstrapConfig, runBootstrap } from "./bootstrap-owner.mjs";

describe("production owner bootstrap command", () => {
  it("[デシジョンテーブル] 必須設定が揃う場合だけ設定を解決する", () => {
    expect(() => parseBootstrapConfig({})).toThrow();
    expect(() =>
      parseBootstrapConfig({ OWNER_USER_ID: "owner", OWNER_EMAIL: "not-an-email" }),
    ).toThrow();
    expect(() =>
      parseBootstrapConfig({ OWNER_USER_ID: "owner", OWNER_EMAIL: "owner\u0001@example.com" }),
    ).toThrow();
    expect(
      parseBootstrapConfig({
        OWNER_USER_ID: "owner",
        OWNER_EMAIL: "owner@example.com",
        ORBIT_OWNER_NAME: "Orbit's Owner",
      }),
    ).toEqual({ userId: "owner", email: "owner@example.com", name: "Orbit's Owner" });
  });

  it("[代表値] SQLは3つのOwner関連行を冪等に初期化し、値をSQL injectionとして解釈させない", () => {
    const sql = buildBootstrapSql({
      userId: "owner'--",
      email: "owner+test@example.com",
      name: "Orbit's Owner",
      now: 1_700_000_000_000,
    });

    expect(sql).toContain("ON CONFLICT(id) DO NOTHING");
    expect(sql).toContain("ON CONFLICT(user_id) DO NOTHING");
    expect(sql).toContain("'owner''--'");
    expect(sql).toContain("'Orbit''s Owner'");
    expect(sql.match(/INSERT INTO/g)).toHaveLength(3);
  });

  it("[デシジョンテーブル] 不正設定ではWranglerを呼ばず、有効設定ではproduction D1へ渡す", async () => {
    const calls = [];
    const execute = async (...args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    await expect(runBootstrap({}, execute)).rejects.toThrow();
    expect(calls).toHaveLength(0);

    await runBootstrap({ OWNER_USER_ID: "owner", OWNER_EMAIL: "owner@example.com" }, execute);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("pnpm");
    expect(calls[0][1]).toEqual(expect.arrayContaining(["--remote", "--env", "production"]));
    expect(calls[0][1]).toContain("wrangler.jsonc");
  });
});
