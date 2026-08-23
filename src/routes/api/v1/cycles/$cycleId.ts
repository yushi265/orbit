import { createFileRoute } from "@tanstack/react-router";
import { closeCycle } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/cycles/$cycleId")({
  server: { handlers: { POST: ({ request, params }) => closeCycle(request, params.cycleId) } },
});
