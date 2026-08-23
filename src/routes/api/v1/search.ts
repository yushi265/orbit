import { createFileRoute } from "@tanstack/react-router";
import { searchIssues } from "../../../server/api";

export const Route = createFileRoute("/api/v1/search")({
  server: { handlers: { GET: ({ request }) => searchIssues(request) } },
});
