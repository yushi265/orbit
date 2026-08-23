// sensor manifest — sensor の宣言的登録と glob 解決
// 「未知 sensor id は読込時に loud error」: manifest ↔ 実装レジストリの
// 双方向突合で、宣言漏れ・実装漏れ・重複をすべて起動時に検出する（設定破損を silent skip しない）。
// timeout フィールドは持たせない（現 sensor は全て in-process 関数で該当なし = YAGNI。
// 外部コマンド sensor 導入時に追加する）。

import { relative, resolve } from "node:path";
import { matchGlob } from "../guard/artifacts";

export interface SensorEntry {
  id: string;
  /** 発火条件の glob（matchGlob 記法: `**` = 任意階層 / `*` = セグメント内任意）。
   *  tier-tripwire の実発火条件は tier-triggers.json が正本（ここでは `**` で委譲・二重定義しない） */
  glob: string;
  /** 実装を持たず他ツールへ委譲するドキュメントエントリ（例: secret-scan → lefthook gitleaks）。
   *  レジストリ突合・glob 解決の対象外（機械処理されない・manifest 上の申し送りとして残る） */
  delegate?: string;
  advisory?: boolean;
  $comment?: string;
}

export interface SensorManifest {
  $comment?: string;
  version: number;
  sensors: SensorEntry[];
}

/** manifest と実装レジストリを双方向突合する。不一致・重複 id は throw（loud error・起動時 fail fast） */
export function validateManifest(manifest: SensorManifest, registry: Set<string>): void {
  const seen = new Set<string>();
  for (const s of manifest.sensors) {
    if (seen.has(s.id)) throw new Error(`sensors.manifest.json に重複 id: '${s.id}'`);
    seen.add(s.id);
    if (s.delegate) continue; // 委譲エントリはドキュメント（実装を要求しない）
    if (!registry.has(s.id)) {
      throw new Error(
        `sensors.manifest.json の '${s.id}' に対応する実装が dispatch のレジストリに無い（未知 id・loud error）`,
      );
    }
  }
  for (const id of registry) {
    if (!seen.has(id)) {
      throw new Error(`実装レジストリの '${id}' が sensors.manifest.json に未宣言（宣言漏れ・loud error）`);
    }
  }
}

/**
 * ファイルパス（repo root 相対）に発火する sensor id を manifest 宣言順で返す（純関数・delegate は対象外）。
 * 判定は **case-insensitive**（旧 dispatch の `/\.sql$/i` 挙動を維持。glob は小文字で書く）。
 */
export function sensorsForFile(relPath: string, manifest: SensorManifest): string[] {
  const p = relPath.toLowerCase();
  return manifest.sensors
    .filter((s) => !s.delegate && matchGlob(s.glob.toLowerCase(), p))
    .map((s) => s.id);
}

/**
 * CLI 引数のパスを repo root 相対へ解決する。cwd 基準で実在しなければ **repoRoot 基準へフォールバック**する
 * （`pnpm -C .claude/aidlc` は cwd が .claude/aidlc になるため、repo root 相対で渡された引数が
 * 黙って空振りする罠への機構対応。両方に実在しない場合は従来どおり cwd 基準 = 削除済みファイル等）。
 * fs 依存は exists 注入でテスト可能にする。
 */
export function resolveRelPath(
  f: string,
  cwd: string,
  repoRoot: string,
  exists: (abs: string) => boolean,
): string {
  const fromCwd = resolve(cwd, f);
  if (exists(fromCwd)) return relative(repoRoot, fromCwd);
  const fromRoot = resolve(repoRoot, f);
  if (exists(fromRoot)) return relative(repoRoot, fromRoot);
  return relative(repoRoot, fromCwd);
}

/**
 * 1 ファイル分の sensor 実行オーケストレーション（manifest 解決 → registry 呼び出し → 件数集計）。
 * sensor の throw は**無音スキップ**（fail-open・advisory を編集の妨げにしない。truth table 縮退版の中核）。
 */
export function dispatchFile(
  relPath: string,
  absPath: string,
  manifest: SensorManifest,
  registry: Record<string, (absPath: string, relPath: string) => number>,
): number {
  let total = 0;
  for (const id of sensorsForFile(relPath, manifest)) {
    try {
      total += registry[id](absPath, relPath);
    } catch {
      // fail-open: sensor 実行の失敗（読込不可・パース例外等）で編集を妨げない（advisory）
    }
  }
  return total;
}
