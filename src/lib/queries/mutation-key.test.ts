import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutationKey } from "./mutation-key";

let dom: JSDOM;
let latest: ReturnType<typeof useMutationKey>;

function Probe(props: { tick: number }) {
  latest = useMutationKey();
  return createElement("span", null, props.tick);
}

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mount() {
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(createElement(Probe, { tick: 0 })));
  return root;
}

describe("useMutationKey", () => {
  it("[状態遷移] 同じ signature → 同じキー / signature 変更 → 新しいキー / reset 後 → 新しいキー", async () => {
    const root = await mount();
    const first = latest.keyFor("a");
    expect(latest.keyFor("a")).toBe(first);
    const changed = latest.keyFor("b");
    expect(changed).not.toBe(first);
    expect(latest.keyFor("b")).toBe(changed);
    latest.reset();
    const afterReset = latest.keyFor("b");
    expect(afterReset).not.toBe(changed);
    expect(afterReset).not.toBe(first);
    await act(async () => root.unmount());
  });

  it("[代表値] 再レンダー後も保持したキーが変わらない", async () => {
    const root = await mount();
    const key = latest.keyFor("bulk");
    await act(async () => root.render(createElement(Probe, { tick: 1 })));
    expect(latest.keyFor("bulk")).toBe(key);
    await act(async () => root.unmount());
  });
});
