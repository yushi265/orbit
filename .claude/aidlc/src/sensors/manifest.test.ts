// manifest の TDD（未知 sensor id は manifest 読込時に非 0 exit = loud error）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateManifest,
  sensorsForFile,
  resolveRelPath,
  dispatchFile,
  type SensorManifest,
} from "./manifest";

const MANIFEST: SensorManifest = {
  version: 1,
  sensors: [
    { id: "custom-sensor", glob: "**.sql" },
    { id: "spec-sections", glob: "docs/spec/**.md" },
    { id: "learnings-format", glob: "docs/ai-dlc/learnings.md" },
  ],
};
const REGISTRY = new Set(["custom-sensor", "spec-sections", "learnings-format"]);

// --- validateManifest: id ↔ 実装レジストリの突合（デシジョンテーブル全列） ------

test("[デシジョンテーブル] manifest と実装レジストリが一致 → 例外なし", () => {
  assert.doesNotThrow(() => validateManifest(MANIFEST, REGISTRY));
});

test("[デシジョンテーブル] manifest に実装の無い id → loud error（fail fast・id 名入り）", () => {
  const m: SensorManifest = {
    ...MANIFEST,
    sensors: [...MANIFEST.sensors, { id: "ghost-sensor", glob: "**" }],
  };
  assert.throws(() => validateManifest(m, REGISTRY), /ghost-sensor/);
});

test("[デシジョンテーブル] 実装レジストリにあるが manifest 未宣言の id → loud error（宣言漏れ検出）", () => {
  const m: SensorManifest = { ...MANIFEST, sensors: MANIFEST.sensors.slice(0, 2) };
  assert.throws(() => validateManifest(m, REGISTRY), /learnings-format/);
});

test("[値域外] 重複 id → loud error", () => {
  const m: SensorManifest = {
    ...MANIFEST,
    sensors: [...MANIFEST.sensors, { id: "custom-sensor", glob: "service/**.sql" }],
  };
  assert.throws(() => validateManifest(m, REGISTRY), /custom-sensor/);
});

// --- sensorsForFile: glob → 発火 sensor の解決（純関数） -----------------------

test("[代表値] glob にマッチした sensor id だけを返す", () => {
  assert.deepEqual(sensorsForFile("service/db/queries/companies.sql", MANIFEST), ["custom-sensor"]);
  assert.deepEqual(sensorsForFile("docs/spec/PROJ-1-foo/index.md", MANIFEST), ["spec-sections"]);
  assert.deepEqual(sensorsForFile("docs/ai-dlc/learnings.md", MANIFEST), ["learnings-format"]);
});

test("[代表値] どの glob にも合致しないファイル → 空配列（sensor 起動なし）", () => {
  assert.deepEqual(sensorsForFile("ui/app/page.tsx", MANIFEST), []);
  assert.deepEqual(sensorsForFile("docs/architecture.md", MANIFEST), []);
});

// --- delegate エントリ（他ツール委譲のドキュメント・機械処理の対象外） ------------

test("[代表値] delegate エントリはレジストリ突合の対象外（実装が無くても loud error にしない）", () => {
  const m: SensorManifest = {
    ...MANIFEST,
    sensors: [...MANIFEST.sensors, { id: "secret-scan", glob: "**", delegate: "lefthook gitleaks" }],
  };
  assert.doesNotThrow(() => validateManifest(m, REGISTRY));
});

test("[代表値] delegate エントリは glob にマッチしても発火リストに含めない", () => {
  const m: SensorManifest = {
    ...MANIFEST,
    sensors: [...MANIFEST.sensors, { id: "secret-scan", glob: "**", delegate: "lefthook gitleaks" }],
  };
  assert.deepEqual(sensorsForFile("ui/app/page.tsx", m), []);
  assert.deepEqual(sensorsForFile("service/db/x.sql", m), ["custom-sensor"]);
});

// --- 発火判定の case / repo 外パス（旧 dispatch /\.sql$/i 挙動の回帰固定・self-review Must） ---

test("[代表値] 発火判定は case-insensitive（大文字 .SQL も発火 = 旧 /\\.sql$/i の挙動維持）", () => {
  assert.deepEqual(sensorsForFile("service/FOO.SQL", MANIFEST), ["custom-sensor"]);
});

test("[代表値] repo 外（.. 始まり）の .sql も発火する（一時 SQL の scan 維持）", () => {
  assert.deepEqual(sensorsForFile("../tmp/scratch.sql", MANIFEST), ["custom-sensor"]);
});

// --- resolveRelPath: pnpm -C の cwd 罠対策（self-review Must: 相対パス invocation の silent no-op） ---

test("[代表値] resolveRelPath: cwd 基準に実在しなければ repoRoot 基準へフォールバック", () => {
  const exists = (abs: string) => abs === "/repo/docs/spec/X/index.md";
  assert.equal(
    resolveRelPath("docs/spec/X/index.md", "/repo/.claude/aidlc", "/repo", exists),
    "docs/spec/X/index.md",
  );
});

test("[代表値] resolveRelPath: cwd 基準に実在すればそちらを優先（従来の cwd 相対も動く）", () => {
  const exists = (abs: string) => abs === "/repo/.claude/aidlc/state/x.md";
  assert.equal(
    resolveRelPath("state/x.md", "/repo/.claude/aidlc", "/repo", exists),
    ".claude/aidlc/state/x.md",
  );
});

test("[境界値] resolveRelPath: どちらにも実在しない → cwd 基準（従来挙動・削除済みファイル等）", () => {
  assert.equal(resolveRelPath("gone.sql", "/repo", "/repo", () => false), "gone.sql");
});

// --- dispatchFile: fail-open（truth table 縮退版の唯一の生き残り・self-review Must） -----

test("[代表値] dispatchFile: sensor throw は無音スキップし他 sensor は実行される（fail-open）", () => {
  const m: SensorManifest = {
    version: 1,
    sensors: [
      { id: "boom", glob: "**" },
      { id: "ok", glob: "**" },
    ],
  };
  let ran = 0;
  const n = dispatchFile("a.md", "a.md", m, {
    boom: () => {
      throw new Error("boom");
    },
    ok: () => {
      ran++;
      return 2;
    },
  });
  assert.equal(n, 2); // boom の throw は 0 扱い・ok の 2 件だけ集計
  assert.equal(ran, 1);
});

// --- 実 sensors.manifest.json との接続（dispatch 配線の回帰固定・self-review Must） ------

const realManifest: SensorManifest = JSON.parse(
  readFileSync(new URL("../../sensors.manifest.json", import.meta.url), "utf8"),
);

test("[回帰] 実 manifest: 非 delegate の id 集合が dispatch の実装 4 種と一致し突合が通る", () => {
  const ids = realManifest.sensors
    .filter((s) => !s.delegate)
    .map((s) => s.id)
    .sort();
  assert.deepEqual(ids, ["codekb-refs", "learnings-format", "spec-sections", "tier-tripwire"]);
  assert.doesNotThrow(() => validateManifest(realManifest, new Set(ids)));
});

test("[回帰] 実 manifest: 発火解決が旧 dispatch 挙動と一致（.SQL 含む・tier-tripwire は全ファイル委譲）", () => {
  assert.deepEqual(sensorsForFile("service/db/queries/x.sql", realManifest), ["tier-tripwire"]);
  assert.deepEqual(sensorsForFile("service/db/queries/X.SQL", realManifest), ["tier-tripwire"]);
  assert.deepEqual(sensorsForFile("docs/ai-dlc/codekb/shared.md", realManifest), ["tier-tripwire", "codekb-refs"]);
  assert.deepEqual(sensorsForFile("docs/spec/PROJ-1-foo/index.md", realManifest), ["tier-tripwire", "spec-sections"]);
  assert.deepEqual(sensorsForFile("docs/ai-dlc/learnings.md", realManifest), ["tier-tripwire", "learnings-format"]);
});
