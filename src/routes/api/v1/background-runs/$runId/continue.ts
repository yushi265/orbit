import { createFileRoute } from "@tanstack/react-router";
import { continueBackgroundRun } from "../../../../../server/api";

export const Route = createFileRoute("/api/v1/background-runs/$runId/continue")({
  server: {
    handlers: { POST: ({ request, params }) => continueBackgroundRun(request, params.runId) },
  },
});
