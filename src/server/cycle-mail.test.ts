import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFailureMail, buildTransitionMail, sendCycleMail } from "./cycle-mail";
import type { CycleMailEnvironment } from "./cycle-mail";
import type { ScheduledCycleTransition } from "./model";

const FROM = "orbit@sender.test";
const TO = "me@owner.test";
const REMAINING = "未処理のCycleが残っています。次回の自動実行で処理します。";

const completed = (name = "Cycle 1", moved = 3): ScheduledCycleTransition => ({
  type: "completed",
  cycleId: "c1",
  name,
  moved,
});
const started = (name = "Cycle 2"): ScheduledCycleTransition => ({
  type: "started",
  cycleId: "c2",
  name,
});

afterEach(() => vi.restoreAllMocks());

describe("buildTransitionMail", () => {
  it("[代表値] 完了1件 → 件名と本文", () => {
    expect(buildTransitionMail([completed()], false)).toEqual({
      subject: "[Orbit] Cycleを更新しました",
      text: "Cycle 1 が完了しました（繰越 3 件）",
    });
  });

  it("[代表値] 開始1件 → 本文", () => {
    expect(buildTransitionMail([started()], false).text).toBe("Cycle 2 を開始しました");
  });

  it.each([0, 1])("[境界値] 繰越%d件", (moved) => {
    expect(buildTransitionMail([completed("Cycle 1", moved)], false).text).toBe(
      `Cycle 1 が完了しました（繰越 ${moved} 件）`,
    );
  });

  it("[代表値] 完了 → 開始の2件は2行がこの順で改行区切り", () => {
    expect(buildTransitionMail([completed(), started()], false).text).toBe(
      "Cycle 1 が完了しました（繰越 3 件）\nCycle 2 を開始しました",
    );
  });

  it.each([
    [true, `Cycle 2 を開始しました\n\n${REMAINING}`],
    [false, "Cycle 2 を開始しました"],
  ])("[同値分割] hasRemaining=%s", (hasRemaining, text) => {
    expect(buildTransitionMail([started()], hasRemaining).text).toBe(text);
  });

  it("[代表値] 件名にCycle名が入らない（改行を含む名前でも固定）", () => {
    const mail = buildTransitionMail([completed("Evil\nName"), started("Other")], true);
    expect(mail.subject).toBe("[Orbit] Cycleを更新しました");
  });
});

describe("buildFailureMail", () => {
  it("[代表値] 件名固定・本文に原因", () => {
    expect(buildFailureMail("D1_WRITE_CONFLICT")).toEqual({
      subject: "[Orbit] Cycleの自動処理に失敗しました",
      text: "Cycleの自動処理に失敗しました。次回の自動実行（毎時）で再試行します。\n\n原因: D1_WRITE_CONFLICT",
    });
  });
});

describe("sendCycleMail", () => {
  const mail = { subject: "S", text: "T" };

  function spies() {
    return {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  }

  const okSend = () => vi.fn(async () => ({ messageId: "x" }));
  const binding = (send: unknown) => ({ send }) as unknown as CycleMailEnvironment["EMAIL"];

  // [EMAIL, MAIL_FROM, OWNER_EMAIL]: 有 / 無 / 空文字（空文字は「無い」扱い）
  const table: Array<[boolean, string | undefined, string | undefined, boolean]> = [
    [true, FROM, TO, true],
    [true, FROM, undefined, false],
    [true, undefined, TO, false],
    [true, undefined, undefined, false],
    [false, FROM, TO, false],
    [false, FROM, undefined, false],
    [false, undefined, TO, false],
    [false, undefined, undefined, false],
    [true, "", TO, false],
    [true, FROM, "", false],
  ];

  it.each(table)(
    "[デシジョンテーブル] EMAIL有=%s MAIL_FROM=%j OWNER_EMAIL=%j → 送信=%s",
    async (hasEmail, from, to, expectSent) => {
      const { log, error } = spies();
      const send = okSend();
      const env: CycleMailEnvironment = {
        EMAIL: hasEmail ? binding(send) : undefined,
        MAIL_FROM: from,
        OWNER_EMAIL: to,
      };

      const result = await sendCycleMail(env, mail);

      expect(result).toBe(expectSent ? "sent" : "not_configured");
      expect(send).toHaveBeenCalledTimes(expectSent ? 1 : 0);
      expect(error).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ event: "cycle_mail", outcome: expectSent ? "sent" : "not_configured" }),
      );
    },
  );

  it("[代表値] 送信引数が { from, to, subject, text } と一致", async () => {
    spies();
    const send = okSend();
    await sendCycleMail({ EMAIL: binding(send), MAIL_FROM: FROM, OWNER_EMAIL: TO }, mail);
    expect(send).toHaveBeenCalledWith({ from: FROM, to: TO, subject: "S", text: "T" });
  });

  it.each([
    [
      "codeを持つError",
      Object.assign(new Error("boom"), { code: "E_SENDER_NOT_VERIFIED" }),
      "E_SENDER_NOT_VERIFIED",
    ],
    ["codeの無いError", new Error("boom"), "unknown"],
    ["Errorでない値", "oops", "unknown"],
    ["codeが文字列でないError", Object.assign(new Error("boom"), { code: 42 }), "unknown"],
  ])("[同値分割] sendの例外が%s → failed・例外は投げない", async (_label, thrown, code) => {
    const { log, error } = spies();
    const send = vi.fn(async () => {
      throw thrown;
    });

    const result = await sendCycleMail(
      { EMAIL: binding(send), MAIL_FROM: FROM, OWNER_EMAIL: TO },
      mail,
    );

    expect(result).toBe("failed");
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ event: "cycle_mail", outcome: "failed", code }),
    );
    expect(log).not.toHaveBeenCalled();
  });

  it("[代表値] ログのキーは成功{event,outcome}・失敗{event,outcome,code}・未設定{event,outcome}だけ", async () => {
    const { log, error } = spies();
    const ng = vi.fn(async () => {
      throw new Error("x");
    });
    await sendCycleMail({ EMAIL: binding(okSend()), MAIL_FROM: FROM, OWNER_EMAIL: TO }, mail);
    await sendCycleMail({}, mail);
    await sendCycleMail({ EMAIL: binding(ng), MAIL_FROM: FROM, OWNER_EMAIL: TO }, mail);

    const keys = (spy: typeof log) =>
      spy.mock.calls.map(([line]) => Object.keys(JSON.parse(String(line))).sort());
    expect(keys(log)).toEqual([
      ["event", "outcome"],
      ["event", "outcome"],
    ]);
    expect(keys(error)).toEqual([["code", "event", "outcome"]]);
  });

  it("[代表値] どのログにも送信元・宛先・Cycle名・本文が含まれない", async () => {
    const { log, error } = spies();
    const secretMail = buildTransitionMail([completed("SECRET-CYCLE-NAME")], false);
    const ng = vi.fn(async () => {
      throw new Error(`rejected ${FROM} ${TO} SECRET-CYCLE-NAME`);
    });
    await sendCycleMail({ EMAIL: binding(ng), MAIL_FROM: FROM, OWNER_EMAIL: TO }, secretMail);
    await sendCycleMail({ EMAIL: binding(okSend()), MAIL_FROM: FROM, OWNER_EMAIL: TO }, secretMail);

    const output = [...log.mock.calls, ...error.mock.calls].flat().join("\n");
    for (const forbidden of [FROM, TO, "SECRET-CYCLE-NAME", "が完了しました"])
      expect(output).not.toContain(forbidden);
  });
});
