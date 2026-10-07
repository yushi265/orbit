import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRouter,
  type AnyRouter,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { queryClient } from "../lib/query";
import { Route as rootRoute } from "../routes/__root";
import { routeTree } from "../routeTree.gen";

// 本番の routeTree でアプリを描画するテスト用 helper（REFACTOR-ui-architecture Phase 0）。
// jsdom・fetch などのグローバルは呼び出し側のテストで用意する。
// __root は <html> を描画するため div 内に描画すると React が入れ子を警告する。
// テストでは root コンポーネントだけ Outlet に差し替える（head は pwa.test.ts が検証）。
// 差し替えは renderApp の呼び出し時に行い、import しただけでは本番の Route を変えない。

export type RenderedApp = {
  router: AnyRouter;
  unmount(): Promise<void>;
};

export async function renderApp(options: {
  url: string;
  container: HTMLElement;
  /** clear の後・描画の前にキャッシュを仕込む（例: Bootstrap 取得済みの状態から始める） */
  seed?: (client: QueryClient) => void;
  /** StrictMode で包んで描画する（effect の二重実行を検証するテスト用） */
  strict?: boolean;
}): Promise<RenderedApp> {
  // OrbitApp はモジュール単位の queryClient を使うので、テスト間のキャッシュ漏れを clear で防ぐ。
  rootRoute.update({ component: Outlet });
  queryClient.clear();
  options.seed?.(queryClient);
  // 本番の getRouter() の scrollRestoration は node 環境の jsdom では window グローバルを要するため使わない。
  // resetScroll などの遷移オプションは router.navigate の spy で検証する。
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [options.url] }),
    defaultPendingMinMs: 0,
  });
  const root = createRoot(options.container);
  await act(async () => {
    const app = createElement(RouterProvider, { router });
    root.render(options.strict ? createElement(StrictMode, null, app) : app);
  });
  await act(async () => {
    await router.load();
  });
  return {
    router,
    async unmount() {
      await act(async () => root.unmount());
      queryClient.clear();
    },
  };
}
