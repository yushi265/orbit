import type { FileRoutesByTo } from "../../routeTree.gen";

// ナビゲーション項目と遷移先の対応表（REFACTOR-ui-architecture）。
// `to` を型付きの対応表から渡すことで、router の型検査を受けたまま項目 id から遷移できる。
export type NavId =
  | "home"
  | "issues"
  | "cycles"
  | "projects"
  | "search"
  | "inbox"
  | "views"
  | "settings";

export const NAV_PATHS = {
  home: "/",
  issues: "/issues",
  cycles: "/cycles",
  projects: "/projects",
  search: "/search",
  inbox: "/inbox",
  views: "/views",
  settings: "/settings",
} as const satisfies Record<NavId, keyof FileRoutesByTo>;
