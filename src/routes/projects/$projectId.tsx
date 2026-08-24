import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";

export const Route = createFileRoute("/projects/$projectId")({ component: ProjectDetailRoute });
function ProjectDetailRoute() {
  const { projectId } = Route.useParams();
  return <OrbitApp initialSection="projects" projectId={projectId} />;
}
