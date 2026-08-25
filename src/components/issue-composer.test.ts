import { describe, expect, it } from "vitest";
import { hasIssueTitle, shouldSubmitIssueOnEnter } from "./issue-composer";

describe("Issue composer keyboard behavior", () => {
  it("[状態遷移] IME変換中のEnterはsubmitせず、変換後のEnterだけsubmitする", () => {
    expect(shouldSubmitIssueOnEnter({ key: "Enter", shiftKey: false, isComposing: true })).toBe(
      false,
    );
    expect(shouldSubmitIssueOnEnter({ key: "Enter", shiftKey: false, isComposing: false })).toBe(
      true,
    );
  });

  it("[境界値] keyCode 229のIME EnterとShift + Enterはsubmitしない", () => {
    expect(
      shouldSubmitIssueOnEnter({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 }),
    ).toBe(false);
    expect(shouldSubmitIssueOnEnter({ key: "Enter", shiftKey: true, isComposing: false })).toBe(
      false,
    );
  });

  it("[境界値] 空白だけのtitleは拒否し、1文字titleは作成可能と判定する", () => {
    expect(hasIssueTitle("   ")).toBe(false);
    expect(hasIssueTitle("A")).toBe(true);
  });

  it("[状態遷移] 作成中はEnterを受け付けず、二重送信を防ぐ", () => {
    expect(shouldSubmitIssueOnEnter({ key: "Enter", isComposing: false, busy: true })).toBe(false);
  });
});
