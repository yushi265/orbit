import { createFileRoute } from "@tanstack/react-router";
import { getIssue, postIssueAction, updateIssue } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/$issueId")({
  server: {
    handlers: {
      GET: ({ request, params }) => getIssue(request, params.issueId),
      PATCH: ({ request, params }) => updateIssue(request, params.issueId),
      POST: ({ request, params }) => postIssueAction(request, params.issueId),
    },
  },
});
