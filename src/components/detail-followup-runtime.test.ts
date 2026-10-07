import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../lib/query";
import { renderApp, type RenderedApp } from "./render-app.test-fixtures";
import { reviewBootstrap, reviewDetail, reviewIssue } from "./review-ui.test-fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
let dom: JSDOM;
let detailDocument: Document;
let app: RenderedApp | undefined;
let serverIssue = reviewIssue();
let serverNotes: ReturnType<typeof reviewDetail>["notes"];
let patches: Array<{
  body: { idempotencyKey: string; version: number; patch: Record<string, unknown> };
  response: ReturnType<typeof deferred<Response>>;
}>;
let unexpected: string[];
let noLabels = false;
function bootstrap() {
  const data = reviewBootstrap([serverIssue]);
  if (noLabels) {
    data.labels = [];
    return data;
  }
  data.labels.push({ id: "label-2", userId: "owner", name: "Label 2", color: "#ffffff" });
  data.labels.push({
    id: "foreign-label",
    userId: "other",
    name: "Foreign Label",
    color: "#ffffff",
  });
  data.projects.push({ ...data.projects[0], id: "project-2", name: "Project 2" });
  return data;
}
async function render() {
  app = await renderApp({
    url: "/issues/issue-1",
    container: detailDocument.getElementById("root")!,
  });
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
function selectProject(value: string) {
  const select = projectSelect();
  select.value = value;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function projectSelect(): HTMLSelectElement {
  const element = dom.window.document.getElementById("issue-project");
  expect(element?.tagName).toBe("SELECT");
  return element;
}
function changeText(value: string) {
  const textarea = detailDocument.querySelector<HTMLTextAreaElement>("#issue-description")!;
  textarea.focus();
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(
    Object.assign(new dom.window.Event("propertychange", { bubbles: true }), {
      propertyName: "value",
    }),
  );
}
async function savePatch(
  index: number,
  patch: Partial<typeof serverIssue>,
  status = 200,
  message = "保存に失敗",
) {
  if (status === 200) serverIssue = { ...serverIssue, ...patch, version: serverIssue.version + 1 };
  await act(async () =>
    patches[index].response.resolve(
      status === 200
        ? json({ issue: serverIssue })
        : json(
            {
              error: {
                code: status === 409 ? "ISSUE_VERSION_CONFLICT" : "INTERNAL_ERROR",
                message,
              },
            },
            status,
          ),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://orbit.example/issues/issue-1",
  });
  detailDocument = dom.window.document;
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  for (const eventName of ["attachEvent", "detachEvent"])
    Object.defineProperty(dom.window.HTMLElement.prototype, eventName, {
      value: function (this: HTMLElement, name: string, handler: EventListener) {
        if (eventName === "attachEvent") this.addEventListener(name.replace(/^on/, ""), handler);
        else this.removeEventListener(name.replace(/^on/, ""), handler);
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
  serverIssue = reviewIssue();
  noLabels = false;
  serverNotes = [];
  patches = [];
  unexpected = [];
  queryClient.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (path === "/api/v1/bootstrap" && method === "GET")
        return Promise.resolve(json(bootstrap()));
      if (path === "/api/v1/background-runs/current" && method === "GET")
        return Promise.resolve(json({ run: null }));
      if (path === "/api/v1/issues/issue-1" && method === "GET")
        return Promise.resolve(json({ ...reviewDetail(serverIssue), notes: serverNotes }));
      if (path === "/api/v1/recent-issue-views" && method === "POST")
        return Promise.resolve(json({}));
      if (path === "/api/v1/issues/issue-1" && method === "PATCH") {
        expect(new Headers(init.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
        const response = deferred<Response>();
        patches.push({ body: JSON.parse(String(init.body)), response });
        return response.promise;
      }
      unexpected.push(`${method} ${path}`);
      return Promise.reject(new Error(`Unexpected API request: ${method} ${path}`));
    }),
  );
});
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  queryClient.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});

describe("Detail follow-up runtime", () => {
  it("[編集維持/セキュリティ] Noteは編集と取消後も原文を維持し危険schemeだけの説明にPreviewを出さない", async () => {
    const unsafe = "javascript:alert(1) data:text/html,<b>危険</b>\n日本語";
    serverIssue = { ...serverIssue, description: unsafe };
    serverNotes = [
      {
        id: "note-edit",
        userId: "owner",
        issueId: "issue-1",
        body: "改行\nhttps://example.com/edit",
        createdAt: 1,
        editedAt: null,
        deletedAt: null,
      },
    ];
    await render();
    expect(detailDocument.querySelector(".detail-description-preview")).toBeNull();
    expect(detailDocument.querySelector<HTMLTextAreaElement>("#issue-description")?.value).toBe(
      unsafe,
    );
    const edit = [
      ...detailDocument.querySelectorAll<HTMLButtonElement>(".note-footer button"),
    ].find((button) => button.textContent === "編集")!;
    await act(async () => edit.click());
    expect(
      detailDocument.querySelector<HTMLTextAreaElement>('textarea[aria-label="編集中の作業メモ"]')
        ?.value,
    ).toBe(serverNotes[0].body);
    const cancel = [
      ...detailDocument.querySelectorAll<HTMLButtonElement>(".note-footer button"),
    ].find((button) => button.textContent === "取消")!;
    await act(async () => cancel.click());
    expect(detailDocument.querySelector(".note-body")?.textContent).toBe(serverNotes[0].body);
    expect(detailDocument.querySelector(".note-body a")?.getAttribute("href")).toBe(
      "https://example.com/edit",
    );
    expect(patches).toHaveLength(0);
  });

  it.each(["Project", "Label"] as const)(
    "[競合] %sの409後に最新Cache/versionへ同期して再試行する",
    async (kind) => {
      await render();
      await act(async () => {
        if (kind === "Project") selectProject("project-2");
        else detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 2"]')!.click();
      });
      serverIssue = { ...serverIssue, version: 2, priority: "low", updatedAt: 2 };
      await savePatch(0, {}, 409, "別の端末で更新されました");
      expect(
        queryClient.getQueryData<ReturnType<typeof bootstrap>>(["bootstrap"])?.issues[0],
      ).toMatchObject({ version: 2, priority: "low" });
      expect(
        queryClient.getQueryData<ReturnType<typeof reviewDetail>>(["issue-detail", "issue-1"])
          ?.issue,
      ).toMatchObject({ version: 2, priority: "low" });
      const retry = [...detailDocument.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === `${kind}を再試行`,
      )!;
      await act(async () => retry.click());
      expect(patches[1].body).toMatchObject({
        version: 2,
        patch:
          kind === "Project" ? { projectId: "project-2" } : { labelIds: ["label-1", "label-2"] },
      });
      await savePatch(
        1,
        kind === "Project" ? { projectId: "project-2" } : { labelIds: ["label-1", "label-2"] },
      );
      expect(
        queryClient.getQueryData<ReturnType<typeof bootstrap>>(["bootstrap"])?.issues[0].priority,
      ).toBe("low");
    },
  );

  it("[境界値] Projectなしはnullで保存し同じProjectの再選択は送信しない", async () => {
    await render();
    await act(async () => selectProject("project-1"));
    expect(patches).toHaveLength(0);
    await act(async () => selectProject(""));
    expect(patches[0].body.patch).toEqual({ projectId: null });
    await savePatch(0, { projectId: null });
    expect(projectSelect()?.value).toBe("");
  });

  it("[故障注入] 説明保存失敗後もProject選択をRetryで回収できる", async () => {
    await render();
    await act(async () => {
      changeText("Retryする説明");
      selectProject("project-2");
    });
    expect(patches).toHaveLength(1);
    await savePatch(0, {}, 500, "説明の保存失敗");
    expect(patches).toHaveLength(1);
    let retryProject = [...detailDocument.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Projectを再試行",
    );
    expect(retryProject).toBeDefined();
    const retryDescription = [...detailDocument.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "説明を再試行",
    )!;
    await act(async () => retryDescription.click());
    await savePatch(1, { description: "Retryする説明" });
    retryProject = [...detailDocument.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Projectを再試行",
    );
    expect(retryProject).toBeDefined();
    await act(async () => retryProject!.click());
    expect(patches).toHaveLength(3);
    expect(patches[2].body).toMatchObject({ version: 2, patch: { projectId: "project-2" } });
    await savePatch(2, { projectId: "project-2" });
    expect(detailDocument.querySelector('[role="alert"]:not(:empty)')).toBeNull();
  });

  it.each(["Project", "Label"] as const)(
    "[状態遷移] %s保存は説明PATCH完了を待って新versionを使う",
    async (kind) => {
      await render();
      await act(async () => {
        changeText("先に保存する説明");
        if (kind === "Project") selectProject("project-2");
        else detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 2"]')!.click();
      });
      expect(patches).toHaveLength(1);
      expect(patches[0].body.patch).toHaveProperty("descriptionJson");
      await savePatch(0, { description: "先に保存する説明" });
      expect(patches).toHaveLength(2);
      expect(patches[1].body).toMatchObject({
        version: 2,
        patch:
          kind === "Project" ? { projectId: "project-2" } : { labelIds: ["label-1", "label-2"] },
      });
      await savePatch(
        1,
        kind === "Project" ? { projectId: "project-2" } : { labelIds: ["label-1", "label-2"] },
      );
    },
  );

  it.each(["Project", "Label", "cross"] as const)(
    "[連打] 同tickの%s操作は最初の1PATCHだけを送る",
    async (kind) => {
      await render();
      await act(async () => {
        if (kind === "Label") {
          const checkbox = detailDocument.querySelector<HTMLInputElement>(
            'input[aria-label="Label 2"]',
          )!;
          checkbox.click();
          checkbox.click();
        } else {
          selectProject("project-2");
          if (kind === "Project") selectProject("");
          else
            detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 2"]')!.click();
        }
      });
      expect(patches).toHaveLength(1);
      expect(patches[0].body.patch).toEqual(
        kind === "Label" ? { labelIds: ["label-1", "label-2"] } : { projectId: "project-2" },
      );
      await savePatch(
        0,
        kind === "Label" ? { labelIds: ["label-1", "label-2"] } : { projectId: "project-2" },
      );
      expect(patches).toHaveLength(1);
    },
  );

  it.each(["Project", "Label"] as const)(
    "[失敗/再試行] %sの500後も選択を保持しRetryで保存する",
    async (kind) => {
      await render();
      await act(async () => {
        if (kind === "Project") selectProject("project-2");
        else detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 2"]')!.click();
      });
      await savePatch(0, {}, 500);
      expect(detailDocument.querySelector('[role="alert"]')?.textContent).toContain("保存に失敗");
      if (kind === "Project") expect(projectSelect()?.value).toBe("project-2");
      const retry = [...detailDocument.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === `${kind}を再試行`,
      )!;
      expect(retry).toBeDefined();
      await act(async () => {
        retry.click();
        retry.click();
      });
      expect(patches).toHaveLength(2);
      expect(patches[1].body).toMatchObject({
        version: 1,
        patch:
          kind === "Project" ? { projectId: "project-2" } : { labelIds: ["label-1", "label-2"] },
      });
      await savePatch(
        1,
        kind === "Project" ? { projectId: "project-2" } : { labelIds: ["label-1", "label-2"] },
      );
      expect(detailDocument.querySelector('[role="alert"]:not(:empty)')).toBeNull();
    },
  );

  it("[セキュリティ/表示] Noteと説明Previewは安全URLだけをリンク化し原文・編集を保持する", async () => {
    const description =
      "日本語の説明\nhttps://example.com/docs\n<script>危険</script> javascript:alert(1) data:text/html,危険";
    serverIssue = { ...serverIssue, description };
    serverNotes = [
      {
        id: "note-1",
        userId: "owner",
        issueId: "issue-1",
        body: "メモ\nhttp://example.org/確認 <img src=x onerror=alert(1)>",
        createdAt: 1,
        editedAt: null,
        deletedAt: null,
      },
    ];
    await render();
    const preview = detailDocument.querySelector(".detail-description-preview");
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain(description);
    expect(preview?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/docs");
    const note = detailDocument.querySelector(".note-body");
    expect(note?.textContent).toBe(serverNotes[0].body);
    expect(note?.querySelector("a")?.getAttribute("href")).toBe(
      "http://example.org/%E7%A2%BA%E8%AA%8D",
    );
    const links = [
      ...detailDocument.querySelectorAll(".detail-description-preview a, .note-body a"),
    ];
    expect(links).toHaveLength(2);
    expect(
      links.every(
        (link) =>
          link.getAttribute("target") === "_blank" &&
          link.getAttribute("rel") === "noopener noreferrer",
      ),
    ).toBe(true);
    expect(
      detailDocument.querySelector(
        ".detail-panel script, .detail-panel img, .detail-panel [onerror]",
      ),
    ).toBeNull();
    expect(detailDocument.querySelector<HTMLTextAreaElement>("#issue-description")?.value).toBe(
      description,
    );
  });

  it("[状態遷移/Owner境界] Labelを付け外しし保存後の一覧・再読込へ反映する", async () => {
    await render();
    const checkbox = detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 2"]');
    expect(checkbox).not.toBeNull();
    expect(detailDocument.querySelector('input[aria-label="Foreign Label"]')).toBeNull();
    await act(async () => checkbox!.click());
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({
      version: 1,
      patch: { labelIds: ["label-1", "label-2"] },
    });
    await savePatch(0, { labelIds: ["label-1", "label-2"] });
    expect(
      queryClient.getQueryData<ReturnType<typeof bootstrap>>(["bootstrap"])?.issues[0].labelIds,
    ).toEqual(["label-1", "label-2"]);
    expect(
      detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 2"]')?.checked,
    ).toBe(true);
    await act(async () =>
      detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 1"]')!.click(),
    );
    expect(patches[1].body).toMatchObject({ version: 2, patch: { labelIds: ["label-2"] } });
    await savePatch(1, { labelIds: ["label-2"] });
    await act(async () => queryClient.invalidateQueries({ queryKey: ["issue-detail", "issue-1"] }));
    expect(
      detailDocument.querySelector<HTMLInputElement>('input[aria-label="Label 1"]')?.checked,
    ).toBe(false);
  });

  it("[空状態] Labelがない場合は作成場所へ進める", async () => {
    noLabels = true;
    await render();
    expect(detailDocument.querySelector('.detail-label-editor input[type="checkbox"]')).toBeNull();
    expect(
      detailDocument.querySelector<HTMLButtonElement>('button[aria-label="Label設定を開く"]'),
    ).not.toBeNull();
  });

  it("[表示順] 説明と作業メモを親子Issue・Cycle履歴より先に置く", async () => {
    await render();
    const selectors = [
      "#issue-description",
      '.detail-section:has([aria-label="新しい作業メモ"])',
      ".issue-hierarchy",
      ".cycle-history-section",
    ];
    const elements = selectors.map((selector) => detailDocument.querySelector(selector));
    expect(elements.every(Boolean)).toBe(true);
    for (let index = 1; index < elements.length; index++) {
      expect(Boolean(elements[index - 1]!.compareDocumentPosition(elements[index]!) & 4)).toBe(
        true,
      );
    }
    // 親Issue編集はプロパティ側（aside）へ移った。
    expect(detailDocument.querySelector(".detail-side #issue-parent")).not.toBeNull();
  });

  it("[Dialog] カレンダー表示中のEscapeは詳細を閉じず日付選択だけ閉じる", async () => {
    await render();
    await act(async () =>
      detailDocument
        .querySelector<HTMLButtonElement>('button[aria-label="IssueのDue dateのカレンダー"]')!
        .click(),
    );
    expect(detailDocument.querySelector(".orbit-calendar")).not.toBeNull();
    await act(async () =>
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(detailDocument.querySelector(".orbit-calendar")).toBeNull();
    expect(detailDocument.querySelector('[aria-label="Issue詳細を閉じる"]')).not.toBeNull();
    expect(app!.router.state.location.pathname).toBe("/issues/issue-1");
  });

  it("[状態遷移] Project選択だけで自動保存し手動保存ボタンを表示しない", async () => {
    await render();
    await act(async () => selectProject("project-2"));
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({ version: 1, patch: { projectId: "project-2" } });
    expect(
      [...detailDocument.querySelectorAll("button")].some(
        (button) => button.textContent === "Projectを保存",
      ),
    ).toBe(false);
    await savePatch(0, { projectId: "project-2" });
    expect(
      queryClient.getQueryData<ReturnType<typeof bootstrap>>(["bootstrap"])?.issues[0].projectId,
    ).toBe("project-2");
    expect(projectSelect()?.value).toBe("project-2");
  });
});
