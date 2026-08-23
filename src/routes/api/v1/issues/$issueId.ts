import { createFileRoute } from "@tanstack/react-router";
import {
  archiveIssue,
  getIssue,
  restoreIssue,
  trashIssue,
  updateIssue,
} from "../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/$issueId")({
  server: {
    handlers: {
      GET: ({ request, params }) => getIssue(request, params.issueId),
      PATCH: ({ request, params }) => updateIssue(request, params.issueId),
      POST: ({ request, params }) => {
        const action = new URL(request.url).searchParams.get("action");
        return action === "restore"
          ? restoreIssue(request, params.issueId)
          : action === "trash"
            ? trashIssue(request, params.issueId)
            : archiveIssue(request, params.issueId);
      },
    },
  },
});
