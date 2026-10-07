import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { findRouteTargetViolations } from "./route-targets.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src/routes", "src/features", "src/components", "src/lib"];

function sourceFiles(dir) {
  const absolute = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { recursive: true })
    .map((file) => path.join(dir, String(file)))
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$|test-fixtures\.tsx?$/.test(file));
}

describe("route targets (REFACTOR-ui-architecture AC-5)", () => {
  it("[同値分割] 文字列リテラル・NAV_PATHS[…] の to は合格（入れ子オブジェクトの後ろ・redirect を含む）", () => {
    const source = `
      router.navigate({ to: "/issues/$issueId", params: { issueId } });
      void router.navigate({
        to: "/search",
      });
      router.navigate({ to: NAV_PATHS[next] });
      <button onClick={() => void router.navigate({ to: "/projects" })}>x</button>
      void router.navigate({ to: "/search" }).then(() => focus());
      <Link to="/projects/$projectId" params={{ projectId }}>x</Link>
      <Link className="a" to={"/issues"} search={search}>x</Link>
      router.navigate({ search: { a: 1 }, params: { id }, to: "/issues" });
      throw redirect({ to: "/settings" });
    `;
    assert.deepEqual(findRouteTargetViolations(source), []);
  });

  it("[同値分割] テンプレートリテラル・変数・連結・as never の to は不合格（Link の属性順・Navigate・redirect を含む）", () => {
    const source = [
      "router.navigate({ to: `/projects/${id}` });",
      "router.navigate({ to: path });",
      "<Link to={projectDetailPath(id)}>x</Link>",
      'router.navigate({ to: "/search" as never });',
      "const value = something as never;",
      "router.navigate({ search: { a: 1 }, to: path });",
      'router.navigate({ to: "/projects/" + id });',
      "<Link onClick={() => track()} to={target}>x</Link>",
      "<Navigate to={target} />",
      "throw redirect({ to: target });",
    ].join("\n");
    assert.deepEqual(findRouteTargetViolations(source), [
      "1: to: `/projects/${id}` })",
      "2: to: path })",
      "3: to={projectDetailPath(id)}",
      '4: to: "/search" as never })',
      "4: as never",
      "5: as never",
      "6: to: path })",
      '7: to: "/projects/" + id })',
      "8: to={target}",
      "9: to={target}",
      "10: to: target })",
    ]);
  });

  it("[代表値] src/routes・src/features・src/components・src/lib の非テストに違反が 0 件", () => {
    const violations = SCAN_DIRS.flatMap(sourceFiles).flatMap((file) =>
      findRouteTargetViolations(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")).map(
        (violation) => `${file}:${violation}`,
      ),
    );
    assert.deepEqual(violations, []);
  });
});
