import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";

export const Route = createFileRoute("/issues/$issueId")({
  component: IssueDetailRoute,
});
function IssueDetailRoute() {
  const { issueId } = Route.useParams();
  return <OrbitApp initialSection="issues" issueId={issueId} issueSearch={Route.useSearch()} />;
}
