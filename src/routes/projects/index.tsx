import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";
import { normalizeProjectSearch } from "../../lib/url-state/issues";

export const Route = createFileRoute("/projects/")({
  validateSearch: normalizeProjectSearch,
  component: ProjectListRoute,
});

function ProjectListRoute() {
  return <OrbitApp initialSection="projects" projectSearch={Route.useSearch()} />;
}
