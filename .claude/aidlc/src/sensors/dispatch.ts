// sensor dispatcher（tier tripwire + manifest 駆動化・advisory）
// 使い方: pnpm -C .claude/aidlc sensor [--strict] <file> [<file2> ...]
//   例（staged な SQL を走査）: pnpm -C .claude/aidlc sensor $(git diff --cached --name-only -- '*.sql')
// 発火条件は sensors.manifest.json が宣言する（id は下記の実装レジストリと起動時に双方向突合され、
// 未知 id・宣言漏れ・重複は loud error で非 0 exit = 設定破損を silent skip しない）。
// 各 sensor の実行失敗（読込不可・パース例外）は無音スキップ（fail-open・advisory を編集の妨げにしない）。
// 既定は advisory（exit 0）。--strict 指定時のみ指摘ありで exit 1。
//
// 実行する sensor（詳細・knownGaps は sensors.manifest.json）:
// - codekb-refs: codekb の「参照:」パス切れ検査
// - tier-tripwire: tier-triggers.json のトリガー該当 × engine state の宣言 tier 突合。
//   新規追加行（git diff HEAD）のみ評価。git 不能・state なしは無音（fail-open）
// - spec-sections: spec 必須節（AC 番号 / テスト戦略 / 対象外・担保 AC / テストケース / 異常系・レスポンシブ）の充足
// - learnings-format: learnings.md 追記行の書式（日付 / カテゴリ / 還流先 / 出典）

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { checkTierTripwire, type TriggersData } from "./tier-tripwire";
import { scanCodekbRefs } from "./codekb-refs";
import { scanSpecSections } from "./spec-sections";
import { scanLearningsFormat } from "./learnings-format";
import { validateManifest, resolveRelPath, dispatchFile, type SensorManifest } from "./manifest";
import { matchGlob } from "../guard/artifacts";
import { parseStateFile } from "../state/state";
import type { Tier } from "../types";

const aidlcRoot = fileURLToPath(new URL("../..", import.meta.url)); // .claude/aidlc
const repoRoot = join(aidlcRoot, "..", "..");

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const files = args.filter((a) => !a.startsWith("--"));

// --- tier tripwire の判定材料（読めなければ tripwire を黙ってスキップ） ------------
function loadTriggers(): TriggersData | null {
  try {
    return JSON.parse(readFileSync(join(aidlcRoot, "tier-triggers.json"), "utf8"));
  } catch {
    return null;
  }
}

/** engine state 群の最小 tier（= 最も高リスクの宣言）。state なしは null（非 AI-DLC 作業 → 無音） */
function declaredTier(): Tier | null {
  const stateDir = join(aidlcRoot, "state");
  if (!existsSync(stateDir)) return null;
  let min: Tier | null = null;
  try {
    for (const entry of readdirSync(stateDir)) {
      if (!entry.endsWith(".md")) continue;
      try {
        const doc = parseStateFile(readFileSync(join(stateDir, entry), "utf8"));
        if (doc.state.parked) continue;
        if (min === null || doc.state.tier < min) min = doc.state.tier;
      } catch {
        // 壊れた state は無視（fail-open）
      }
    }
  } catch {
    return null;
  }
  return min;
}

/** 編集ファイルの新規追加行（git diff HEAD の + 行。untracked は全行）。git 不能は []（無音） */
function addedLinesOf(relPath: string): string[] {
  const opts = { encoding: "utf8" as const, cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 };
  try {
    const diff = execFileSync("git", ["diff", "HEAD", "--", relPath], opts);
    if (diff.trim()) {
      return diff
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1));
    }
    const status = execFileSync("git", ["status", "--porcelain", "--", relPath], opts);
    if (status.startsWith("??")) {
      return readFileSync(join(repoRoot, relPath), "utf8").split("\n"); // 新規ファイル = 全行が追加
    }
    return [];
  } catch {
    return [];
  }
}

const triggersData = loadTriggers();
const tier = triggersData ? declaredTier() : null;

// --- 実装レジストリ（id → 実行関数）。stderr へ指摘を出し件数を返す。throw は呼び出し側で fail-open ---
const registry: Record<string, (f: string, relPath: string) => number> = {
  "codekb-refs": (_f, relPath) => {
    const md = readFileSync(join(repoRoot, relPath), "utf8");
    let n = 0;
    for (const fd of scanCodekbRefs(md, (p) => existsSync(join(repoRoot, p)))) {
      n++;
      process.stderr.write(
        `[sensor:codekb-refs] ${relPath}:${fd.line} 参照パスが実在しない: ${fd.path}（codekb の鮮度規約: 参照パスは実在必須）\n`,
      );
    }
    return n;
  },
  "tier-tripwire": (_f, relPath) => {
    if (!triggersData || tier === null || relPath.startsWith("..")) return 0;
    // glob 事前判定は tier-triggers.json が正本（manifest の ** から委譲）。該当時のみ git diff のコストを払う
    if (!triggersData.triggers.some((t) => matchGlob(t.glob, relPath))) return 0;
    let n = 0;
    for (const fd of checkTierTripwire(relPath, addedLinesOf(relPath), tier, triggersData.triggers)) {
      n++;
      process.stderr.write(`[sensor:tier-tripwire] [${fd.triggerId}] ${fd.message}\n`);
    }
    return n;
  },
  "spec-sections": (_f, relPath) => {
    const md = readFileSync(join(repoRoot, relPath), "utf8");
    let n = 0;
    for (const fd of scanSpecSections(relPath, md)) {
      n++;
      process.stderr.write(`[sensor:spec-sections] ${relPath}: ${fd.message}\n`);
    }
    return n;
  },
  "learnings-format": (_f, relPath) => {
    const md = readFileSync(join(repoRoot, relPath), "utf8");
    let n = 0;
    for (const fd of scanLearningsFormat(md)) {
      n++;
      process.stderr.write(`[sensor:learnings-format] ${relPath}:${fd.line} ${fd.message}\n`);
    }
    return n;
  },
};

// --- manifest 読込 + 双方向突合（未知 id・宣言漏れ・重複は loud error） -----
const manifest: SensorManifest = JSON.parse(
  readFileSync(join(aidlcRoot, "sensors.manifest.json"), "utf8"),
);
try {
  validateManifest(manifest, new Set(Object.keys(registry)));
} catch (e) {
  process.stderr.write(`⚠ ${(e as Error).message}\n`);
  process.exit(1);
}

let total = 0;
for (const f of files) {
  // 絶対パス（hook 由来）/ cwd 相対 / repo root 相対（pnpm -C の cwd 罠）のいずれも正規化する
  const relPath = resolveRelPath(f, process.cwd(), repoRoot, existsSync);
  const absPath = resolve(repoRoot, relPath);
  total += dispatchFile(relPath, absPath, manifest, registry);
}

process.stderr.write(
  total === 0
    ? "[sensor] findings なし\n"
    : `[sensor] ${total} 件の指摘（advisory・非強制）\n`,
);
process.exit(strict && total > 0 ? 1 : 0);
