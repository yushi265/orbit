// scope CLI（advisory）
// 使い方: pnpm -C .claude/aidlc scope <doc-only|bugfix|feature|security-patch>
// 名前付き scope から、tier・実行 Stage 列（stage-graph と合成）・必須 sensor を提示する。

import { readFileSync } from "node:fs";
import { resolveScope, plannedStages, type ScopesData } from "./resolve";
import type { StageGraph } from "../types";

const scopesData: ScopesData = JSON.parse(
  readFileSync(new URL("../../scopes.json", import.meta.url), "utf8"),
);
const graph: StageGraph = JSON.parse(
  readFileSync(new URL("../../stage-graph.json", import.meta.url), "utf8"),
);

const name = process.argv[2];
const valid = Object.keys(scopesData.scopes).join(" / ");
if (!name) {
  process.stderr.write(`scope 名を指定してください。有効: ${valid}\n`);
  process.exit(2);
}

const scope = resolveScope(name, scopesData);
const stages = plannedStages(scope, graph);
const out = process.stdout;
out.write(`# scope: ${name}\n`);
out.write(
  `- tier: ${scope.tier} / spec: ${scope.specPlanned} / 挙動変更: ${scope.behaviorChange}\n`,
);
out.write(`- 必須 sensor: ${scope.sensors.length ? scope.sensors.join(", ") : "なし"}\n`);
out.write(`- 実行 Stage: ${stages.map((s) => s.id).join(" → ")}\n`);
out.write(`- note: ${scope.note}\n`);
// scope→engine seed: この scope で engine state を初期化するコマンド
// state パスは -C 先（.claude/aidlc）からの相対で渡す（repo root 相対だとパスが二重化する）。
out.write(`- engine seed: pnpm -C .claude/aidlc report state/<TICKET>.md init scope=${name}\n`);
