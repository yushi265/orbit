import { createFileRoute } from "@tanstack/react-router";
import { recordRecentIssueView } from "../../../server/api";

export const Route = createFileRoute("/api/v1/recent-issue-views")({
  server: { handlers: { POST: ({ request }) => recordRecentIssueView(request) } },
});
