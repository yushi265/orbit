import { createFileRoute } from "@tanstack/react-router";
import { createProject, listProjects } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/projects/")({
  server: {
    handlers: {
      GET: ({ request }) => listProjects(request),
      POST: ({ request }) => createProject(request),
    },
  },
});
