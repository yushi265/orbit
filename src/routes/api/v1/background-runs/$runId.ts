import { createFileRoute } from "@tanstack/react-router";
import { getBackgroundRun } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/background-runs/$runId")({
  server: { handlers: { GET: ({ request, params }) => getBackgroundRun(request, params.runId) } },
});
