import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";
import { normalizeProjectSearch } from "../../lib/url-state/issues";

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: normalizeProjectSearch,
  component: ProjectDetailRoute,
});
function ProjectDetailRoute() {
  const { projectId } = Route.useParams();
  return (
    <OrbitApp initialSection="projects" projectId={projectId} projectSearch={Route.useSearch()} />
  );
}
