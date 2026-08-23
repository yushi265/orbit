// referee-check（権威再実行の純関数部）
// audit 表記は 3 値（REFEREE_GREEN|RED|UNAVAILABLE）— 実装過程の self-review で
// 「unavailable を RED と混同させない」指摘を受けて 2 値から精密化した。
// Stage 5「メインループから全ゲートを再実行して証跡を取る」を 1 コマンドに集約する。
// **exit 0 の集合だけが権威 green**——worker/AI の自己申告は判定に使わない。
// コマンド表は referee.config.json が持つ（ハードコードしない）。spawn 等の I/O は cli.ts 側。

export interface LayerCommand {
  cwd: string;
  command: string[];
  /** 実行前提（cwd 相対パス・例 "node_modules"）。欠落時は spawn せず unavailable にする
   *  （npx / pnpm 経由は ENOENT にならず exit 非 0 で死ぬため、deps 未導入を RED と誤判定しない） */
  precondition?: string;
}

export interface RefereeConfig {
  layers: Record<string, LayerCommand>;
  /** `all` 指定時に最後へ追加実行するコマンド（lefthook 等）。無ければレイヤーのみ */
  post?: LayerCommand & { name: string };
}

export type Verdict = "GREEN" | "RED" | "unavailable";

export interface RefereeResult {
  name: string;
  verdict: Verdict;
  /** 出力の最後 5 行（RED 時の一次切り分け材料。全文は再実行で得る） */
  summary: string[];
}

/** layer 指定 → 実行対象のリスト。未知名は利用可能一覧付きで throw（fail fast） */
export function decideTargets(
  layerArg: string,
  config: RefereeConfig,
): { name: string; cmd: LayerCommand }[] {
  if (layerArg === "all") {
    const targets = Object.entries(config.layers).map(([name, cmd]) => ({ name, cmd }));
    if (config.post) targets.push({ name: config.post.name, cmd: config.post });
    return targets;
  }
  const cmd = config.layers[layerArg];
  if (!cmd) {
    throw new Error(
      `未知のレイヤー: '${layerArg}'（利用可能: ${Object.keys(config.layers).join(" | ")} | all）`,
    );
  }
  return [{ name: layerArg, cmd }];
}

/** 実行結果 → verdict。コマンド不在は RED でなく unavailable（環境差の誤赤を防ぐ） */
export function toResult(
  name: string,
  outcome: { exit: number | null; output: string; notFound?: boolean },
): RefereeResult {
  const summary = outcome.output
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(-5);
  if (outcome.notFound) return { name, verdict: "unavailable", summary };
  return { name, verdict: outcome.exit === 0 ? "GREEN" : "RED", summary };
}

/** 全体判定。RED が最優先・unavailable が混ざれば GREEN を名乗らない（全実行できてこそ権威） */
export function overallVerdict(results: RefereeResult[]): Verdict {
  if (results.some((r) => r.verdict === "RED")) return "RED";
  if (results.some((r) => r.verdict === "unavailable")) return "unavailable";
  return "GREEN";
}

/** 実行前提（deps 等）の欠落判定。precondition 宣言があり、かつ実在しなければ unavailable 扱い */
export function missingPrecondition(cmd: LayerCommand, exists: (relPath: string) => boolean): boolean {
  return cmd.precondition != null && !exists(`${cmd.cwd}/${cmd.precondition}`);
}

/** spawnSync の結果 → toResult の outcome（ENOENT 判定を純関数化し cli の I/O 境界を薄く保つ） */
export function classifyOutcome(proc: {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: NodeJS.ErrnoException | null;
}): { exit: number | null; output: string; notFound: boolean } {
  return {
    exit: proc.status,
    output: `${proc.stdout ?? ""}${proc.stderr ?? ""}`,
    notFound: proc.error != null && proc.error.code === "ENOENT",
  };
}

/**
 * audit へ書く note 文字列。**決定論**（同一入力 → バイト同一）にすることで、
 * applyReportToDocument の既存重複スキップ（直前シグネチャ一致）が「同一判定の連続実行は
 * 追記しない」という冪等性をそのまま担保する。3 値をそのまま刻む（unavailable を RED と
 * 混同させない——本物のテスト失敗と環境差を audit 上で区別可能に保つ。green は名乗らない）。
 */
export function buildAuditNote(layerArg: string, results: RefereeResult[], overall: Verdict): string {
  const detail = results.map((r) => `${r.name}=${r.verdict}`).join(" ");
  return `REFEREE_${overall.toUpperCase()} ${layerArg}（${detail}）`;
}
