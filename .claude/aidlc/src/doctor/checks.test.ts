import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks, formatDoctorReport, type DoctorObservations } from "./checks";

function obs(overrides: Partial<DoctorObservations> = {}): DoctorObservations {
  return {
    nodeModulesExists: true,
    pnpmAvailable: true,
    hookFiles: [
      { path: ".claude/hooks/aidlc-sensor.sh", exists: true },
      { path: ".claude/hooks/aidlc-bootstrap.sh", exists: true },
    ],
    hooksPath: null,
    hooksPathInsideRepo: null,
    miseTrusted: true,
    states: [],
    driftPassed: true,
    ...overrides,
  };
}

function byId(results: ReturnType<typeof runChecks>, id: string) {
  const r = results.find((x) => x.id === id);
  assert.ok(r, `check '${id}' が無い`);
  return r;
}

test("完備した環境 → 全検査 ok（代表値）", () => {
  const results = runChecks(obs());
  assert.ok(results.every((r) => r.status === "ok" || r.status === "skip"));
});

test("node_modules 欠落 → deps fail + 修復コマンド提示（境界値）", () => {
  const r = byId(runChecks(obs({ nodeModulesExists: false })), "deps");
  assert.equal(r.status, "fail");
  assert.ok(r.fix?.includes("pnpm -C .claude/aidlc install --ignore-workspace"));
});

test("登録済みフックの .sh 不在 → hooks-wiring fail（欠落フック名入り。実行権は不問 = bash 経由呼び出し）", () => {
  const missing = runChecks(
    obs({ hookFiles: [{ path: ".claude/hooks/gone.sh", exists: false }] }),
  );
  const r = byId(missing, "hooks-wiring");
  assert.equal(r.status, "fail");
  assert.ok(r.message.includes("gone.sh"));
});

test("core.hooksPath が repo 外 → lefthook warn（既知の罠: 別 checkout 指し）", () => {
  const r = byId(
    runChecks(obs({ hooksPath: "/other/checkout/.git/hooks", hooksPathInsideRepo: false })),
    "lefthook",
  );
  assert.equal(r.status, "warn");
  assert.ok(r.message.includes("別 checkout"));
  assert.ok(r.fix?.includes("lefthook install"));
});

test("mise untrusted → fail + mise trust 提示 / mise 未使用（null）→ 検査を出さない", () => {
  assert.equal(byId(runChecks(obs({ miseTrusted: false })), "mise").status, "fail");
  assert.ok(byId(runChecks(obs({ miseTrusted: false })), "mise").fix?.includes("mise trust"));
  assert.equal(runChecks(obs({ miseTrusted: null })).find((r) => r.id === "mise"), undefined);
});

test("state Running + 対応 spec ディレクトリなし → state-orphan warn（parked は対象外）", () => {
  const results = runChecks(
    obs({
      states: [
        { ticket: "GONE-1", hasSpecDir: false, parked: false },
        { ticket: "PARKED-1", hasSpecDir: false, parked: true },
      ],
    }),
  );
  const r = byId(results, "state-orphan");
  assert.equal(r.status, "warn");
  assert.ok(r.message.includes("GONE-1"));
  assert.ok(!r.message.includes("PARKED-1"));
});

test("検査自体の例外（settings.json を読めない = hookFiles null）→ その検査だけ warn・doctor は落ちない", () => {
  const results = runChecks(obs({ hookFiles: null }));
  const r = byId(results, "hooks-wiring");
  assert.equal(r.status, "warn");
  assert.ok(r.message.includes("検査不能"));
  // 他の検査は影響を受けない
  assert.equal(byId(results, "deps").status, "ok");
});

test("drift fail → 正本とミラーの乖離を報告 / null → skip", () => {
  assert.equal(byId(runChecks(obs({ driftPassed: false })), "drift").status, "fail");
  assert.equal(byId(runChecks(obs({ driftPassed: null })), "drift").status, "skip");
});

test("formatDoctorReport: 記号 + 修復コマンドの表・--json 用に機械可読も保てる", () => {
  const results = runChecks(obs({ nodeModulesExists: false }));
  const out = formatDoctorReport(results);
  assert.ok(out.includes("❌"));
  assert.ok(out.includes("pnpm -C .claude/aidlc install"));
  // --json はそのまま直列化（round-trip でスキーマ = id/status/message が保たれる）
  const parsed = JSON.parse(JSON.stringify(results)) as typeof results;
  const deps = parsed.find((r) => r.id === "deps");
  assert.equal(deps?.status, "fail");
  assert.ok(typeof deps?.message === "string" && deps.message.length > 0);
});
