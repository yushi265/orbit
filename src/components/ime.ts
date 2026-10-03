export interface ImeKeyEventLike {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}

/** IME変換中（確定/取消のEnter・Escapeを含む）のキーイベントか。 */
export function isImeComposing(event: ImeKeyEventLike): boolean {
  return (
    event.nativeEvent?.isComposing === true || event.isComposing === true || event.keyCode === 229
  );
}
