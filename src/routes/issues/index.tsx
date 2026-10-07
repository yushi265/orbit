import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";

export const Route = createFileRoute("/issues/")({
  component: IssueListRoute,
});

function IssueListRoute() {
  return <OrbitApp initialSection="issues" issueSearch={Route.useSearch()} />;
}
