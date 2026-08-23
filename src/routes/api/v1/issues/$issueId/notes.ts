import { createFileRoute } from "@tanstack/react-router";
import { createIssueNote } from "../../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/$issueId/notes")({
  server: { handlers: { POST: ({ request, params }) => createIssueNote(request, params.issueId) } },
});
