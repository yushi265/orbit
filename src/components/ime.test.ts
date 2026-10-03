import { describe, expect, it } from "vitest";
import { isImeComposing } from "./ime";

describe("isImeComposing", () => {
  it.each([
    [{ nativeEvent: { isComposing: true } }, true],
    [{ isComposing: true }, true],
    [{ keyCode: 229 }, true],
    [{ nativeEvent: { isComposing: false }, isComposing: false, keyCode: 13 }, false],
    [{ nativeEvent: { isComposing: false }, isComposing: true, keyCode: 13 }, true],
    [{ nativeEvent: { isComposing: true }, isComposing: false, keyCode: 13 }, true],
    [{ nativeEvent: { isComposing: false }, isComposing: false, keyCode: 229 }, true],
    [{ isComposing: false, keyCode: 13 }, false],
    [{ keyCode: 13 }, false],
    [{}, false],
  ])("[デシジョンテーブル] %j -> %s", (event, expected) => {
    expect(isImeComposing(event)).toBe(expected);
  });
});
