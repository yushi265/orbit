import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";
import { normalizeIssueSearch } from "../../lib/url-state/issues";

export const Route = createFileRoute("/issues/$issueId")({
  validateSearch: normalizeIssueSearch,
  component: IssueDetailRoute,
});
function IssueDetailRoute() {
  const { issueId } = Route.useParams();
  return <OrbitApp initialSection="issues" issueId={issueId} issueSearch={Route.useSearch()} />;
}
