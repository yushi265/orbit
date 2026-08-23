// harness doctor: ハーネス自己診断の判定純関数（read-only）
// advisory ツール群の「サイレント死」（フェイルセーフの静かな無効化）と既知の環境罠を可視化する。
// 判定（本ファイル・純関数）と観測（cli.ts・fs/exec）を分離。修復はしない（コマンド提示のみ）。
// 検査の追加基準: 実際に踏まれた罠だけを検査化する（投機的検査を足さない = simplicity）。
// 下記の mise 検査は同梱の例。プロジェクトのツールチェーンに合わせて調整・削除する。

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

/** cli.ts が収集する観測データ。取得に失敗した項目は null（該当検査が skip/warn になる） */
export interface DoctorObservations {
  nodeModulesExists: boolean;
  pnpmAvailable: boolean;
  /** settings.json に登録されたフック .sh の実在（呼び出しは `bash <path>` 経由のため実行権は不問）。null = settings.json を読めず収集失敗（0 件検出とは区別する） */
  hookFiles: { path: string; exists: boolean }[] | null;
  /** git config core.hooksPath（未設定は null） */
  hooksPath: string | null;
  /** hooksPath が現 checkout 配下を指すか（hooksPath=null なら null） */
  hooksPathInsideRepo: boolean | null;
  /** mise trust 状態（mise 不在は null = skip） */
  miseTrusted: boolean | null;
  /** engine state 群（ticket・対応 spec ディレクトリの有無・parked） */
  states: { ticket: string; hasSpecDir: boolean; parked: boolean }[];
  /** drift テストの pass（--fast は null = skip） */
  driftPassed: boolean | null;
}

export function runChecks(obs: DoctorObservations): CheckResult[] {
  const results: CheckResult[] = [];

  results.push(
    !obs.nodeModulesExists
      ? {
          id: "deps",
          status: "fail",
          message: ".claude/aidlc/node_modules が無い（全 advisory ツールが無音で無効化される）",
          fix: "pnpm -C .claude/aidlc install --ignore-workspace",
        }
      : !obs.pnpmAvailable
        ? { id: "deps", status: "fail", message: "pnpm が見つからない", fix: "pnpm を導入（engine は pnpm/tsx 前提。使用中のツールチェーンマネージャ経由でも可）" }
        : { id: "deps", status: "ok", message: "依存導入済み・pnpm 到達可" },
  );

  if (obs.hookFiles === null) {
    // 「0 件検出」と「収集失敗」を区別する（検査不能を ok と誤読させない）
    results.push({
      id: "hooks-wiring",
      status: "warn",
      message: ".claude/settings.json を読めない（フック配線の検査不能）",
      fix: "settings.json の存在・JSON 構文を確認",
    });
  } else {
    const brokenHooks = obs.hookFiles.filter((h) => !h.exists);
    results.push(
      brokenHooks.length > 0
        ? {
            id: "hooks-wiring",
            status: "fail",
            message: `settings.json に登録されたフックが実在しない: ${brokenHooks.map((h) => h.path).join(", ")}`,
            fix: "ファイルの復元（または settings.json の登録行を除去）",
          }
        : { id: "hooks-wiring", status: "ok", message: `登録フック ${obs.hookFiles.length} 本すべて実在` },
    );
  }

  results.push(
    obs.hooksPath !== null && obs.hooksPathInsideRepo === false
      ? {
          id: "lefthook",
          status: "warn",
          message: `core.hooksPath が別 checkout を指している可能性: ${obs.hooksPath}（既知の罠: pre-commit が silently 素通り/誤発火する）`,
          fix: "npx lefthook install（この checkout で）",
        }
      : { id: "lefthook", status: "ok", message: "core.hooksPath は正常（未設定 or 本 checkout 配下）" },
  );

  // mise（.mise.toml が実在する時だけ検査。使わないプロジェクトでは miseTrusted=null で行ごと出さない）
  if (obs.miseTrusted !== null) {
    results.push(
      obs.miseTrusted
        ? { id: "mise", status: "ok", message: "mise trust 済み" }
        : {
            id: "mise",
            status: "fail",
            message: "mise が untrusted（mise 管理の pre-commit ツールが落ちる罠）",
            fix: "mise trust .mise.toml",
          },
    );
  }

  const orphans = obs.states.filter((s) => !s.parked && !s.hasSpecDir);
  results.push(
    orphans.length > 0
      ? {
          id: "state-orphan",
          status: "warn",
          message: `対応する docs/spec/<TICKET>-*/ が無い Running state: ${orphans.map((s) => s.ticket).join(", ")}`,
          fix: "再 init（spec を作る）or state ファイル削除（完了済みなら）",
        }
      : { id: "state-orphan", status: "ok", message: "孤児 state なし" },
  );

  results.push(
    obs.driftPassed === null
      ? { id: "drift", status: "skip", message: "--fast のため skip" }
      : obs.driftPassed
        ? { id: "drift", status: "ok", message: "正本 ↔ ミラー同期 green" }
        : {
            id: "drift",
            status: "fail",
            message: "正本とミラーが乖離（drift テスト fail）",
            fix: "cd .claude/aidlc && node --import tsx --test src/drift/*.test.ts で乖離箇所を確認",
          },
  );

  return results;
}

const ICON: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️", fail: "❌", skip: "⏭️" };

export function formatDoctorReport(results: CheckResult[]): string {
  const lines = ["[aidlc doctor] ハーネス自己診断（read-only・修復はコマンド提示のみ）"];
  for (const r of results) {
    lines.push(`${ICON[r.status]} ${r.id}: ${r.message}${r.fix ? `\n   → 修復: ${r.fix}` : ""}`);
  }
  return lines.join("\n");
}
