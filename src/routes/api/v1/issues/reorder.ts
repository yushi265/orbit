import { createFileRoute } from "@tanstack/react-router";
import { reorderIssue } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/reorder")({
  server: {
    handlers: {
      POST: ({ request }) => reorderIssue(request),
    },
  },
});
