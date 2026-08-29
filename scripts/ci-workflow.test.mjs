import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

const workflowPath = path.resolve(process.cwd(), ".github/workflows/ci.yml");
const deploymentDocsPath = path.resolve(process.cwd(), "docs/deployment.md");

function readFile(filePath) {
  assert.ok(fs.existsSync(filePath), "required file is missing: " + filePath);
  return fs.readFileSync(filePath, "utf8");
}

function jobBlock(workflow, jobName, nextJobName) {
  const startMarker = "\n  " + jobName + ":\n";
  const start = workflow.indexOf(startMarker);
  assert.notEqual(start, -1, "job is missing: " + jobName);
  const end =
    nextJobName === undefined
      ? workflow.length
      : workflow.indexOf("\n  " + nextJobName + ":\n", start);
  assert.notEqual(end, -1, "next job is missing: " + nextJobName);
  return workflow.slice(start, end);
}

function assertWorkflowContract(workflow) {
  const triggerMatch = workflow.match(/^on:\n([\s\S]*?)\n\npermissions:/m);
  assert.ok(triggerMatch, "top-level trigger block is missing");
  assert.equal(triggerMatch[1].trim(), "pull_request:\n  push:\n    branches: [main]");

  const permissionsMatch = workflow.match(/^permissions:\n((?: {2}[^\n]+\n)+)/m);
  assert.ok(permissionsMatch, "top-level permissions block is missing");
  assert.deepEqual(
    permissionsMatch[1]
      .trim()
      .split("\n")
      .map((line) => line.trim()),
    ["contents: read"],
  );

  const quality = jobBlock(workflow, "quality", "secrets");
  assert.match(quality, /uses: actions\/checkout@v6/);
  assert.match(quality, /persist-credentials: false/);
  assert.match(quality, /uses: pnpm\/setup@v2/);
  assert.match(quality, /version: 11\.18\.0/);
  assert.match(quality, /runtime: node@24/);
  assert.match(quality, /cache: true/);
  assert.match(quality, /cache-dependency-path: pnpm-lock\.yaml/);
  assert.match(quality, /install: false/);
  const qualityLines = quality.split("\n").map((line) => line.trim());
  const installPosition = qualityLines.indexOf("run: pnpm install --frozen-lockfile");
  assert.notEqual(installPosition, -1, "quality job is missing frozen install");
  assert.doesNotMatch(quality, /pnpm install --frozen-lockfile=false/);
  assert.doesNotMatch(quality, /^\s+permissions:/m);
  assert.doesNotMatch(quality, /^\s+if:\s*false\s*$/m);
  assert.doesNotMatch(quality, /^\s+continue-on-error:\s*true\s*$/m);

  const commands = [
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm run build:production",
  ];
  let previousPosition = -1;
  for (const command of commands) {
    const position = qualityLines.indexOf("run: " + command);
    assert.notEqual(position, -1, "quality job is missing: " + command);
    assert.ok(position > previousPosition, "quality gate order is invalid at: " + command);
    previousPosition = position;
  }
  assert.ok(installPosition < previousPosition, "frozen install must precede quality gates");

  const secrets = jobBlock(workflow, "secrets");
  assert.match(secrets, /uses: actions\/checkout@v6/);
  assert.match(secrets, /fetch-depth: 0/);
  assert.match(secrets, /persist-credentials: false/);
  assert.match(secrets, /continue-on-error: true/);
  assert.match(secrets, /uses: gitleaks\/gitleaks-action@v3/);
  assert.ok(secrets.includes("GITHUB_TOKEN:"), "Gitleaks token is not configured");
  assert.ok(secrets.includes("secrets.GITHUB_TOKEN"), "Gitleaks token source is not GitHub");
  assert.match(secrets, /GITLEAKS_ENABLE_COMMENTS: false/);
  assert.match(secrets, /GITLEAKS_ENABLE_UPLOAD_ARTIFACT: false/);
  assert.match(secrets, /GITLEAKS_ENABLE_SUMMARY: false/);
  assert.match(secrets, /run: gitleaks git --no-banner --redact/);
  assert.doesNotMatch(secrets, /^\s+permissions:/m);
  assert.doesNotMatch(
    secrets,
    /Scan complete Git history with Gitleaks[\s\S]*continue-on-error:\s*true/,
  );
  assert.doesNotMatch(
    secrets,
    /Scan complete Git history with Gitleaks[\s\S]*^\s+if:\s*false\s*$/m,
  );

  assert.doesNotMatch(workflow, /\bwrangler\s+deploy\b/i);
  assert.doesNotMatch(
    workflow,
    /\b(?:pnpm\s+(?:run|exec)\s+)?(?:deploy|db:migrate(?::production)?)\b/i,
  );
  assert.doesNotMatch(workflow, /\b(?:wrangler\s+)?d1\s+migrations?\b/i);
  assert.doesNotMatch(workflow, /(?:CLOUDFLARE|CF)_[A-Z_]*(?:TOKEN|ACCOUNT_ID)/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
}

describe("GitHub Actions CI workflow contract", () => {
  it("[デシジョンテーブル] PRとmain pushだけを起動対象にする", () => {
    assertWorkflowContract(readFile(workflowPath));
  });

  it("[代表値] quality jobが5つの品質ゲートを順番に実行する", () => {
    const workflow = readFile(workflowPath);
    const quality = jobBlock(workflow, "quality", "secrets");
    const commands = [
      "pnpm format:check",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm run build:production",
    ];
    const qualityLines = quality.split("\n").map((line) => line.trim());
    let previousPosition = -1;
    for (const command of commands) {
      const position = qualityLines.indexOf("run: " + command);
      assert.notEqual(position, -1);
      assert.ok(position > previousPosition);
      previousPosition = position;
    }
  });

  it("[代表値] Node.js 24、pnpm 11.18.0、frozen installとlockfile cacheを使う", () => {
    assertWorkflowContract(readFile(workflowPath));
  });

  it("[代表値] Gitleaks v3が全履歴を検査し、外部出力を無効化する", () => {
    assertWorkflowContract(readFile(workflowPath));
  });

  it("[代表値] workflow権限をcontents readに限定する", () => {
    assertWorkflowContract(readFile(workflowPath));
  });

  it("[代表値] deployment docsがCIとCDの責務分担を記録する", () => {
    const deployment = readFile(deploymentDocsPath);
    assert.match(deployment, /GitHub ActionsはCI専用です/);
    assert.match(deployment, /本番CDの正本はCloudflare Workers Buildsです/);
    assert.ok(deployment.includes("`pnpm run build:production`"));
    assert.ok(deployment.includes("`npx wrangler deploy`"));
    assert.match(deployment, /D1 migration.*GitHub Actionsからは実行しません/);
    assert.match(deployment, /非本番ブランチのPreview Buildは無効/);
  });

  it("[異常系] 必須step・最小権限・禁止条件の変更を契約違反として検出する", () => {
    const workflow = readFile(workflowPath);

    assert.throws(() => assertWorkflowContract(workflow.replace("pnpm lint", "pnpm lint-removed")));
    assert.throws(() =>
      assertWorkflowContract(workflow.replace("contents: read", "actions: write")),
    );
    assert.throws(() => assertWorkflowContract(workflow + "\n      run: pnpm run deploy"));
    assert.throws(() =>
      assertWorkflowContract(
        workflow.replace(
          "run: pnpm install --frozen-lockfile",
          "run: pnpm install --frozen-lockfile=false",
        ),
      ),
    );
    assert.throws(() =>
      assertWorkflowContract(
        workflow.replace("  secrets:\n", "    permissions:\n      actions: write\n\n  secrets:\n"),
      ),
    );
    assert.throws(() =>
      assertWorkflowContract(
        workflow.replace(
          "        run: gitleaks git --no-banner --redact",
          "        continue-on-error: true\n        run: gitleaks git --no-banner --redact",
        ),
      ),
    );
    assert.throws(() =>
      assertWorkflowContract(
        workflow.replace(
          "        run: gitleaks git --no-banner --redact",
          "        if: false\n        run: gitleaks git --no-banner --redact",
        ),
      ),
    );
    assert.throws(() =>
      assertWorkflowContract(workflow + "\n      run: npx wrangler d1 migrations apply orbit"),
    );
  });
});
