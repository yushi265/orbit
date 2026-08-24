import { createFileRoute } from "@tanstack/react-router";
import { closeCycle, updateCycleMetadata } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/cycles/$cycleId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => updateCycleMetadata(request, params.cycleId),
      POST: ({ request, params }) => closeCycle(request, params.cycleId),
    },
  },
});
