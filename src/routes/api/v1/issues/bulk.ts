import { createFileRoute } from "@tanstack/react-router";
import { bulkUpdateIssues } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/bulk")({
  server: {
    handlers: {
      POST: ({ request }) => bulkUpdateIssues(request),
    },
  },
});
