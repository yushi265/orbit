import { createFileRoute } from "@tanstack/react-router";
import { archiveProject, updateProject } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/projects/$projectId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => updateProject(request, params.projectId),
      POST: ({ request, params }) => archiveProject(request, params.projectId),
    },
  },
});
