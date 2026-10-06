import type { ScheduledCycleTransition } from "./model";

export type CycleMail = { subject: string; text: string };
export type CycleMailEnvironment = {
  EMAIL?: Pick<SendEmail, "send">;
  MAIL_FROM?: string;
  OWNER_EMAIL?: string;
};

const REMAINING_LINE = "未処理のCycleが残っています。次回の自動実行で処理します。";

export function buildTransitionMail(
  transitions: ScheduledCycleTransition[],
  hasRemaining: boolean,
): CycleMail {
  const lines = transitions.map((item) =>
    item.type === "completed"
      ? `${item.name} が完了しました（繰越 ${item.moved} 件）`
      : `${item.name} を開始しました`,
  );
  const body = lines.join("\n");
  return {
    subject: "[Orbit] Cycleを更新しました",
    text: hasRemaining ? `${body}\n\n${REMAINING_LINE}` : body,
  };
}

export function buildFailureMail(message: string): CycleMail {
  return {
    subject: "[Orbit] Cycleの自動処理に失敗しました",
    text: `Cycleの自動処理に失敗しました。次回の自動実行（毎時）で再試行します。\n\n原因: ${message}`,
  };
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "unknown";
}

export async function sendCycleMail(
  env: CycleMailEnvironment,
  mail: CycleMail,
): Promise<"sent" | "not_configured" | "failed"> {
  const { EMAIL, MAIL_FROM, OWNER_EMAIL } = env;
  if (!EMAIL || !MAIL_FROM || !OWNER_EMAIL) {
    console.log(JSON.stringify({ event: "cycle_mail", outcome: "not_configured" }));
    return "not_configured";
  }
  try {
    await EMAIL.send({ from: MAIL_FROM, to: OWNER_EMAIL, subject: mail.subject, text: mail.text });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "cycle_mail", outcome: "failed", code: errorCode(error) }),
    );
    return "failed";
  }
  console.log(JSON.stringify({ event: "cycle_mail", outcome: "sent" }));
  return "sent";
}
