import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";
import { normalizeIssueSearch } from "../../lib/url-state/issues";

export const Route = createFileRoute("/issues/")({
  validateSearch: normalizeIssueSearch,
  component: IssueListRoute,
});

function IssueListRoute() {
  return <OrbitApp initialSection="issues" issueSearch={Route.useSearch()} />;
}
