import { createFileRoute } from "@tanstack/react-router";
import { deleteIssueRelation } from "../../../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/$issueId/relations/$relationId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        deleteIssueRelation(request, params.issueId, params.relationId),
    },
  },
});
