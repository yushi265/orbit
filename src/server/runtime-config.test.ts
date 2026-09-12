import { expect, it } from "vitest";
import { resolveLocalOrigins, resolveRuntimeConfig } from "./runtime-config";
import { ServiceError } from "./errors";

it("[デシジョンテーブル] 実行設定表の許可値を解決し、それ以外を拒否する", () => {
  for (const APP_ENV of [undefined, "development", "local", "production", "preview", ""]) {
    for (const ORBIT_STORAGE of [undefined, "memory", "d1", "invalid", ""]) {
      const valid =
        ((APP_ENV === undefined || APP_ENV === "development") &&
          (ORBIT_STORAGE === undefined || ORBIT_STORAGE === "memory")) ||
        (APP_ENV === "local" && ORBIT_STORAGE === "d1") ||
        (APP_ENV === "production" && (ORBIT_STORAGE === undefined || ORBIT_STORAGE === "d1"));
      if (valid) {
        expect(resolveRuntimeConfig({ APP_ENV, ORBIT_STORAGE })).toEqual({
          mode: APP_ENV ?? "development",
          storage: APP_ENV === "local" || APP_ENV === "production" ? "d1" : "memory",
        });
      } else {
        expect(() => resolveRuntimeConfig({ APP_ENV, ORBIT_STORAGE })).toThrow();
      }
    }
  }
});

it("[同値分割・境界値] LAN許可Originは未指定時loopback、有効なIPv4 HTTP originだけを解決する", () => {
  expect(resolveLocalOrigins({})).toEqual(["http://127.0.0.1:3000"]);
  const origins = [
    "http://127.0.0.1:3000",
    "http://10.0.0.0:3000",
    "http://10.255.255.255:3000",
    "http://172.16.0.0:3000",
    "http://172.31.255.255:3000",
    "http://192.168.0.0:3000",
    "http://192.168.255.255:3000",
  ];
  expect(resolveLocalOrigins({ ORBIT_LOCAL_ORIGINS: JSON.stringify(origins) })).toEqual(origins);
});

it("[同値分割・境界値] 空・非canonical・範囲外のLAN Origin設定を500で拒否する", () => {
  const invalidOrigins = [
    "http://9.255.255.255:3000",
    "http://11.0.0.0:3000",
    "http://172.15.255.255:3000",
    "http://172.32.0.0:3000",
    "http://192.167.255.255:3000",
    "http://192.169.0.0:3000",
    "http://127.0.0.2:3000",
    "http://100.64.0.1:3000",
    "http://169.254.1.1:3000",
    "http://0.0.0.0:3000",
    "http://8.8.8.8:3000",
    "http://localhost:3000",
    "http://orbit.example:3000",
    "http://[::1]:3000",
    "http://192.168.1.256:3000",
    "https://192.168.1.1:3000",
    "http://192.168.1.1",
    "http://192.168.1.1:3001",
    "http://192.168.1.1:2999",
    "http://192.168.1.1:3000/",
    "http://192.168.1.1:3000/api",
    "http://192.168.1.1:3000?x=1",
    "http://192.168.1.1:3000#x",
    "http://user:password@192.168.1.1:3000",
    "HTTP://192.168.1.1:3000",
    "http://192.168.001.1:3000",
    "http://0xc0a80101:3000",
    "http://3232235777:3000",
    "http://192.168.1.1:03000",
    " http://192.168.1.1:3000",
    "http://192.168.1.1:3000\n",
    "",
    null,
    1,
    {},
    [],
  ];
  const invalidSettings = [
    "",
    "invalid-json",
    "[]",
    "null",
    "{}",
    "1",
    '"http://127.0.0.1:3000"',
    ['["http://127.0.0.1:3000"]'] as unknown as string,
    ...invalidOrigins.map((origin) => JSON.stringify(["http://127.0.0.1:3000", origin])),
  ];
  for (const ORBIT_LOCAL_ORIGINS of invalidSettings) {
    expect(() => resolveLocalOrigins({ ORBIT_LOCAL_ORIGINS }), ORBIT_LOCAL_ORIGINS).toThrowError(
      new ServiceError(500, "INTERNAL_ERROR", "ローカル接続設定を確認してください。"),
    );
  }
});
