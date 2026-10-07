import { Outlet, createFileRoute } from "@tanstack/react-router";
import { normalizeIssueSearch } from "../lib/url-state/issues";

// Issues のレイアウトルート。search の正規化を一覧と詳細で共有する（REFACTOR-ui-architecture Phase 3a）。
// Phase 3c で一覧（IssuesPage）をここへ移し、詳細は子ルートのオーバーレイになる。
export const Route = createFileRoute("/issues")({
  validateSearch: normalizeIssueSearch,
  component: Outlet,
});
