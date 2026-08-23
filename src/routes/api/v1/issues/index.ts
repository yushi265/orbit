import { createFileRoute } from "@tanstack/react-router";
import { createIssue, listIssues } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/")({
  server: {
    handlers: {
      GET: ({ request }) => listIssues(request),
      POST: ({ request }) => createIssue(request),
    },
  },
});
