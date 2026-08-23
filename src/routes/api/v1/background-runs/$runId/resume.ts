import { createFileRoute } from "@tanstack/react-router";
import { resumeBackgroundRun } from "../../../../../server/api";

export const Route = createFileRoute("/api/v1/background-runs/$runId/resume")({
  server: {
    handlers: { POST: ({ request, params }) => resumeBackgroundRun(request, params.runId) },
  },
});
