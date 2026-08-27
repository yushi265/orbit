import { createFileRoute } from "@tanstack/react-router";
import { recordRecentSearch } from "../../../server/api";

export const Route = createFileRoute("/api/v1/recent-searches")({
  server: { handlers: { POST: ({ request }) => recordRecentSearch(request) } },
});
