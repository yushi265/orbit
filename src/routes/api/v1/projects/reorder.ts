import { createFileRoute } from "@tanstack/react-router";
import { reorderProject } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/projects/reorder")({
  server: {
    handlers: {
      POST: ({ request }) => reorderProject(request),
    },
  },
});
