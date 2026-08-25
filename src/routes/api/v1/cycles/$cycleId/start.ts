import { createFileRoute } from "@tanstack/react-router";
import { startCycle } from "../../../../../server/api";

export const Route = createFileRoute("/api/v1/cycles/$cycleId/start")({
  server: { handlers: { POST: ({ request, params }) => startCycle(request, params.cycleId) } },
});
