import { createFileRoute } from "@tanstack/react-router";
import { updateCycleSchedule } from "../../../../../server/api";

export const Route = createFileRoute("/api/v1/cycles/$cycleId/schedule")({
  server: {
    handlers: { PATCH: ({ request, params }) => updateCycleSchedule(request, params.cycleId) },
  },
});
