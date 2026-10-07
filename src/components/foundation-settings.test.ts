import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunOverlay, SettingsView } from "./OrbitApp";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";

const preferences = {
  userId: "owner",
  timezone: "Asia/Tokyo",
  locale: "ja" as const,
  theme: "system" as const,
  colorTheme: "coral" as const,
  estimateEnabled: true,
  issueCounter: 0,
};

const workflowStates = [
  {
    id: "state-todo",
    userId: "owner",
    name: "Todo",
    category: "unstarted" as const,
    color: "#8B93A1",
    position: 0,
    isDefault: true,
  },
];
const cycleSettings = {
  userId: "owner",
  enabled: true,
  durationWeeks: 2,
  cooldownWeeks: 0,
  startWeekday: 1,
  futureCount: 3,
  autoAddToCurrentCycle: false,
};

const settingsProps = {
  preferences,
  cycleSettings,
  labels: [],
  onRefresh: () => undefined,
  run: null,
  runBusy: false,
  onRun: () => undefined,
  onResume: () => undefined,
  onPreferences: async () => undefined,
  onCycleSettings: async () => undefined,
  onColorTheme: async () => undefined,
  canInstallPwa: false,
  onInstallPwa: () => undefined,
};

describe("Phase 1 Settings UI contract", () => {
  it("[代表値] renders editable preference and Workflow controls", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingsView, { ...settingsProps, workflowStates }),
    );

    expect(markup).toContain('aria-labelledby="setting-timezone-label"');
    expect(markup).toContain('aria-labelledby="setting-language-label"');
    expect(markup).not.toContain("Estimate");
    expect(markup).toContain('aria-label="Workflow名"');
    expect(markup).toContain("Todo");
  });

  it("[状態遷移] renders an empty Workflow state and a resumable paused Run", () => {
    const settingsMarkup = renderToStaticMarkup(
      createElement(SettingsView, { ...settingsProps, workflowStates: [] }),
    );
    const runMarkup = renderToStaticMarkup(
      createElement(RunOverlay, {
        run: {
          run_id: "run-1",
          kind: "maintenance",
          status: "paused",
          progress: {
            current_step: "purge",
            step_index: 1,
            step_count: 3,
            cursor: "cycle_transition:1",
            processed: 1,
            total: null,
            percent: 33,
          },
          error: null,
          requested_at: 1,
          started_at: 1,
          heartbeat_at: 1,
          finished_at: null,
          resume_count: 1,
        },
        busy: false,
        onResume: () => undefined,
      }),
    );
    const pendingMarkup = renderToStaticMarkup(
      createElement(RunOverlay, {
        run: {
          run_id: "run-pending",
          kind: "maintenance",
          status: "pending",
          progress: {
            current_step: "cycle_transition",
            step_index: 0,
            step_count: 3,
            cursor: null,
            processed: 0,
            total: null,
            percent: 0,
          },
          error: null,
          requested_at: 1,
          started_at: null,
          heartbeat_at: null,
          finished_at: null,
          resume_count: 0,
        },
        busy: false,
        onResume: () => undefined,
      }),
    );

    expect(settingsMarkup).toContain("Workflowはまだありません");
    expect(runMarkup).toContain("処理が一時停止しました");
    expect(runMarkup).toContain("Runを再開");
    expect(pendingMarkup).toContain("処理を開始しています");
    expect(pendingMarkup).not.toContain("Maintenance complete");
  });

  it("[アクセシビリティ/レスポンシブ] keeps mobile wrapping CSS and initial markup clean", () => {
    const rules = parseStyleRules();
    const mobile = "(max-width: 767px)";
    const markup = renderToStaticMarkup(
      createElement(SettingsView, { ...settingsProps, workflowStates }),
    );

    expect(declarationsFor(rules, ".workflow-settings-row").get("flex-wrap")).toBe("wrap");
    expect(declarationsFor(rules, ".cycle-settings-actions").get("display")).toBe("flex");
    expect(declarationsFor(rules, ".workflow-settings-row .text-input", mobile).get("width")).toBe(
      "100%",
    );
    expect(declarationsFor(rules, ".cycle-settings-actions", mobile).get("flex-direction")).toBe(
      "column",
    );
    expect(markup).not.toContain('role="alert"');
  });
});
