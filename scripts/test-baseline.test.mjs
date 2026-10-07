import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { collectTests, compareBaseline } from "./test-baseline.mjs";

const report = {
  testResults: [
    {
      name: "/repo/src/a.test.ts",
      assertionResults: [
        { ancestorTitles: ["suite"], title: "keeps", status: "passed" },
        { ancestorTitles: ["suite", "inner"], title: "breaks", status: "failed" },
      ],
    },
    {
      name: "/repo/scripts/b.test.mjs",
      assertionResults: [{ ancestorTitles: [], title: "skipped one", status: "skipped" }],
    },
  ],
};

describe("test baseline", () => {
  it("[代表値] vitest の JSON レポートをリポジトリ相対の file > describe > it 名へ変換する", () => {
    assert.deepEqual(collectTests(report, "/repo"), [
      { id: "scripts/b.test.mjs > skipped one", status: "skipped" },
      { id: "src/a.test.ts > suite > inner > breaks", status: "failed" },
      { id: "src/a.test.ts > suite > keeps", status: "passed" },
    ]);
  });

  const baseline = { tests: ["f > a", "f > b", "f > known-fail"], failing: ["f > known-fail"] };
  const passed = (id) => ({ id, status: "passed" });

  it("[同値分割] ベースラインと同名・同数で、既知の fail だけなら合格", () => {
    const result = compareBaseline(baseline, [
      passed("f > a"),
      passed("f > b"),
      { id: "f > known-fail", status: "failed" },
    ]);
    assert.deepEqual(result, { missing: [], unexpectedFailures: [], disallowed: [] });
  });

  it("[同値分割] テストが消えたら missing に名前が出る", () => {
    const result = compareBaseline(baseline, [passed("f > a"), passed("f > known-fail")]);
    assert.deepEqual(result.missing, ["f > b"]);
  });

  it("[境界値] 同名テスト（it.each の重複 ID）が 2 件から 1 件に減ったら missing に出る", () => {
    const duplicated = { tests: ["f > dup", "f > dup"], failing: [] };
    assert.deepEqual(compareBaseline(duplicated, [passed("f > dup")]).missing, ["f > dup"]);
    assert.deepEqual(
      compareBaseline(duplicated, [passed("f > dup"), passed("f > dup")]).missing,
      [],
    );
  });

  it("[同値分割] 新規テストの追加は合格", () => {
    const result = compareBaseline(baseline, [
      passed("f > a"),
      passed("f > b"),
      passed("f > known-fail"),
      passed("f > new"),
    ]);
    assert.deepEqual(result, { missing: [], unexpectedFailures: [], disallowed: [] });
  });

  it("[同値分割] ベースライン外の fail は unexpectedFailures に出る", () => {
    const result = compareBaseline(baseline, [
      { id: "f > a", status: "failed" },
      passed("f > b"),
      passed("f > known-fail"),
      { id: "f > new", status: "failed" },
    ]);
    assert.deepEqual(result.unexpectedFailures, ["f > a", "f > new"]);
  });

  it("[同値分割] skip / todo / pending（only による除外を含む）は disallowed に出る", () => {
    const result = compareBaseline(baseline, [
      { id: "f > a", status: "skipped" },
      { id: "f > b", status: "todo" },
      { id: "f > known-fail", status: "pending" },
    ]);
    assert.deepEqual(result.disallowed, ["f > a", "f > b", "f > known-fail"]);
  });
});
