import { createFileRoute } from "@tanstack/react-router";
import { createIssueRelation } from "../../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/$issueId/relations")({
  server: {
    handlers: { POST: ({ request, params }) => createIssueRelation(request, params.issueId) },
  },
});
