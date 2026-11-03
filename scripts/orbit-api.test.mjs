import { describe, expect, it } from "vitest";
import { buildRequest } from "./orbit-api.mjs";

const env = {
  ORBIT_URL: "https://orbit.example",
  ORBIT_CF_CLIENT_ID: "client.access",
  ORBIT_CF_CLIENT_SECRET: "secret-value",
};
const key = () => "key-1";

describe("orbit-api buildRequest", () => {
  it("[代表値] GETはService Tokenヘッダーだけを付ける", () => {
    const { url, init } = buildRequest("get", "/api/v1/bootstrap", undefined, env, key);
    expect(url).toBe("https://orbit.example/api/v1/bootstrap");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      "CF-Access-Client-Id": "client.access",
      "CF-Access-Client-Secret": "secret-value",
    });
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
  });

  it("[代表値] 更新系はX-Requested-WithとIdempotency-Keyを付け、bodyへidempotencyKeyを補う", () => {
    const { init } = buildRequest("POST", "/api/v1/issues", '{"title":"牛乳"}', env, key);
    expect(init.headers).toMatchObject({
      "X-Requested-With": "XMLHttpRequest",
      "Idempotency-Key": "key-1",
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({ idempotencyKey: "key-1", title: "牛乳" });
  });

  it("[同値分割] 指定済みのidempotencyKeyは上書きしない・bodyなしの更新系も送れる", () => {
    const withKey = buildRequest(
      "PATCH",
      "/api/v1/issues/i1",
      '{"idempotencyKey":"mine"}',
      env,
      key,
    );
    expect(JSON.parse(withKey.init.body)).toEqual({ idempotencyKey: "mine" });
    const noBody = buildRequest("POST", "/api/v1/issues/i1?action=archive", undefined, env, key);
    expect(noBody.init.body).toBeUndefined();
    expect(noBody.init.headers["Idempotency-Key"]).toBe("key-1");
  });

  it("[同値分割] 不正なMETHOD・PATH・JSON・GETのbodyは拒否する", () => {
    expect(() => buildRequest("TRACE", "/api/v1/bootstrap", undefined, env)).toThrow("METHOD");
    expect(() => buildRequest("GET", "/admin", undefined, env)).toThrow("/api/v1/");
    expect(() => buildRequest("GET", "https://evil.example/api/v1/x", undefined, env)).toThrow(
      "/api/v1/",
    );
    expect(() => buildRequest("POST", "/api/v1/issues", "{bad", env)).toThrow("JSON");
    expect(() => buildRequest("GET", "/api/v1/issues", "{}", env)).toThrow("GET");
  });

  it("[同値分割] 環境変数の不足は名前だけを示し、秘密値を含めない", () => {
    expect(() =>
      buildRequest("GET", "/api/v1/bootstrap", undefined, {
        ORBIT_URL: "https://orbit.example",
        ORBIT_CF_CLIENT_ID: "",
      }),
    ).toThrow("ORBIT_CF_CLIENT_ID, ORBIT_CF_CLIENT_SECRET");
  });
});
