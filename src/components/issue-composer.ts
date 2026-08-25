export interface IssueComposerKeyEvent {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  busy?: boolean;
}

export function hasIssueTitle(value: string): boolean {
  return value.trim().length > 0;
}

export function shouldSubmitIssueOnEnter(event: IssueComposerKeyEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.busy
  );
}
