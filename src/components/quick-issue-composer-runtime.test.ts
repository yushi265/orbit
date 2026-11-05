import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleViewModel } from "../shared/view-models";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewIssue } from "./review-ui.test-fixtures";

// FEAT: Issueのクイック追加。c でタイトル・Project・Due dateだけのクイック追加を開き、
// Shift+C で従来のフル入力を開く。「詳細で登録」で入力を引き継いでフル入力へ切り替える。

let dom: JSDOM;
let app: RenderedApp | undefined;
let posted: Record<string, unknown>[];
const issue = reviewIssue("issue-1");
const activeCycle: CycleViewModel = {
  id: "cycle-1",
  userId: "owner",
  number: 1,
  name: "Cycle 1",
  nameOverride: null,
  description: "",
  startsAt: Date.UTC(2026, 9, 1),
  endsAt: Date.UTC(2026, 9, 14),
  status: "active",
  completedAt: null,
  scheduleOverridden: false,
};

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  posted = [];
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  for (const name of ["attachEvent", "detachEvent"] as const)
    Object.defineProperty(dom.window.HTMLElement.prototype, name, {
      value: function (this: HTMLElement, event: string, handler: EventListener) {
        const type = event.replace(/^on/, "");
        if (name === "attachEvent") this.addEventListener(type, handler);
        else this.removeEventListener(type, handler);
      },
    });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap")
        return json({ ...reviewBootstrap([issue]), cycles: [activeCycle] });
      if (path.startsWith("/api/v1/background-runs")) return json({ run: null });
      if (path === "/api/v1/issues" && method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posted.push(body);
        return json({
          issue: reviewIssue("issue-new", { title: String(body.title) }),
        });
      }
      return json({ items: [] });
    }),
  );
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  dom.window.close();
  vi.unstubAllGlobals();
});

const doc = () => dom.window.document;
const q = (selector: string) => doc().querySelector(selector);
async function open(url: string) {
  app = await renderApp({ url, container: doc().getElementById("root")! });
  await vi.waitFor(() => expect(q("h1")).not.toBeNull());
}
async function press(init: KeyboardEventInit, target: EventTarget = dom.window) {
  await act(async () => {
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}
const title = () =>
  q('textarea[aria-label="新しいIssueのタイトル"]') as unknown as HTMLTextAreaElement | null;
const project = () => q("#new-issue-project") as unknown as HTMLSelectElement | null;
async function typeTitle(value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  // jsdom上のReactはattachEvent経由のpropertychangeで入力を拾う（cycle-confirm-runtimeと同じ方法）。
  await act(async () => {
    title()!.focus();
    setter.call(title(), value);
    title()!.dispatchEvent(
      Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
        propertyName: "value",
      }),
    );
  });
}
async function chooseProject(value: string) {
  await act(async () => {
    project()!.value = value;
    project()!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const button = (label: string) =>
  [...doc().querySelectorAll("button")].find((item) => item.textContent?.trim() === label);

describe("クイック追加の開き方（デシジョンテーブル）", () => {
  it("[デシジョンテーブル] c → タイトル・Projectだけのクイック追加が開く", async () => {
    await open("/issues");
    await press({ key: "c" });
    expect(q("#issue-composer-title")?.textContent).toBe("クイック追加");
    expect(title()).not.toBeNull();
    expect(project()).not.toBeNull();
    expect(q("#new-issue-due-date")).toBeNull();
    expect(q("#new-issue-cycle")).toBeNull();
    expect(q("#new-issue-priority")).toBeNull();
    expect(q("#new-issue-parent")).toBeNull();
    expect(button("詳細で登録")).toBeDefined();
  });

  it("[デシジョンテーブル] Shift+C → 従来のフル入力が開く", async () => {
    await open("/issues");
    await press({ key: "C", shiftKey: true });
    expect(q("#issue-composer-title")?.textContent).toBe("新しいIssue");
    expect(q("#new-issue-cycle")).not.toBeNull();
    expect(q("#new-issue-priority")).not.toBeNull();
    expect(q("#new-issue-parent")).not.toBeNull();
    expect(button("詳細で登録")).toBeUndefined();
  });

  it.each([
    ["/projects/project-1", "project-1"],
    ["/projects/missing-project", ""],
    ["/issues", ""],
  ])("[同値分割] %s で c を押すとProject初期値は「%s」", async (url, expected) => {
    await open(url);
    await press({ key: "c" });
    expect(project()!.value).toBe(expected);
  });
});

describe("クイック追加の登録", () => {
  it("[代表値] Enterでタイトル・Projectだけ送り、Cycle・Priority・Parentは付けない", async () => {
    await open("/projects/project-1");
    await press({ key: "c" });
    await typeTitle("牛乳を買う");
    await press({ key: "Enter" }, title()!);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      title: "牛乳を買う",
      projectId: "project-1",
      dueAt: null,
      cycleId: null,
      priority: "no_priority",
      parentId: null,
    });
  });

  it("[状態遷移] 登録後もクイック追加を開いたまま、タイトルだけ空にしてProjectを維持し、続けて登録できる", async () => {
    await open("/projects/project-1");
    await press({ key: "c" });
    await typeTitle("1件目");
    await press({ key: "Enter" }, title()!);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    await vi.waitFor(() => expect(title()!.value).toBe(""));
    expect(q("#issue-composer-title")?.textContent).toBe("クイック追加");
    expect(project()!.value).toBe("project-1");
    expect(doc().activeElement).toBe(title());
    await typeTitle("2件目");
    await press({ key: "Enter" }, title()!);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toMatchObject({ title: "2件目", projectId: "project-1" });
  });

  it("[状態遷移] ボタンで登録しても開いたままで、タイトル欄にフォーカスが戻る", async () => {
    await open("/issues");
    await press({ key: "c" });
    await typeTitle("ボタンで登録");
    await chooseProject("project-1");
    await act(async () => button("Issueを作成")!.click());
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    await vi.waitFor(() => expect(title()!.value).toBe(""));
    expect(project()!.value).toBe("project-1");
    expect(doc().activeElement).toBe(title());
  });

  it("[状態遷移] フル入力で登録した場合は従来どおり閉じる", async () => {
    await open("/issues");
    await press({ key: "C", shiftKey: true });
    await typeTitle("フル入力");
    await act(async () => button("Issueを作成")!.click());
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    await vi.waitFor(() => expect(q(".composer")).toBeNull());
  });

  it("[境界値] タイトルが空白だけならEnterでも送らない", async () => {
    await open("/issues");
    await press({ key: "c" });
    await typeTitle("   ");
    await press({ key: "Enter" }, title()!);
    expect(posted).toHaveLength(0);
    expect(q(".composer")).not.toBeNull();
  });

  it("[同値分割] IME変換中のEnterでは送らない", async () => {
    await open("/issues");
    await press({ key: "c" });
    await typeTitle("ぎゅうにゅう");
    await press({ key: "Enter", isComposing: true }, title()!);
    expect(posted).toHaveLength(0);
  });
});

describe("詳細で登録への切り替え（状態遷移）", () => {
  it("[状態遷移] クイック → 詳細で登録 → フル入力へ、タイトルとProjectを引き継ぐ", async () => {
    await open("/issues");
    await press({ key: "c" });
    await typeTitle("引き継ぐタイトル");
    await chooseProject("project-1");
    await act(async () => button("詳細で登録")!.click());
    expect(q("#issue-composer-title")?.textContent).toBe("新しいIssue");
    expect(title()!.value).toBe("引き継ぐタイトル");
    expect(project()!.value).toBe("project-1");
    expect(q("#new-issue-cycle")).not.toBeNull();
    expect(doc().activeElement).toBe(title());
  });

  it("[状態遷移] フル入力へ切り替えた後はCycle初期値（Active Cycle）を送る", async () => {
    await open("/issues");
    await press({ key: "c" });
    await typeTitle("詳細で作る");
    await act(async () => button("詳細で登録")!.click());
    await act(async () => button("Issueを作成")!.click());
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      title: "詳細で作る",
      cycleId: "cycle-1",
    });
  });

  it("[状態遷移] 閉じて再度 c を押すとクイック追加で開き、入力は空に戻る", async () => {
    await open("/issues");
    await press({ key: "c" });
    await typeTitle("捨てる");
    await act(async () => button("詳細で登録")!.click());
    await act(async () => button("キャンセル")!.click());
    expect(q(".composer")).toBeNull();
    await press({ key: "c" });
    expect(q("#issue-composer-title")?.textContent).toBe("クイック追加");
    expect(title()!.value).toBe("");
  });
});

describe("案内表示", () => {
  it("[代表値] ショートカット一覧に C（クイック追加）と Shift + C（詳細）が出る", async () => {
    await open("/issues");
    await press({ key: "?" });
    const rows = [...doc().querySelectorAll(".shortcut-row")].map((row) => row.textContent);
    expect(rows).toContain("CIssueをクイック追加");
    expect(rows).toContain("Shift + CIssueを詳細で作成");
  });

  it("[代表値] コマンドパレットにクイック追加があり、選ぶとクイック追加が開く", async () => {
    await open("/issues");
    await press({ key: "k", ctrlKey: true });
    const item = [...doc().querySelectorAll(".command-palette button")].find((el) =>
      el.textContent?.includes("Issueをクイック追加"),
    ) as HTMLButtonElement;
    expect(item).toBeDefined();
    await act(async () => item.click());
    expect(q("#issue-composer-title")?.textContent).toBe("クイック追加");
  });
});
