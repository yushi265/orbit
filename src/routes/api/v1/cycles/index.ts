import { createFileRoute } from "@tanstack/react-router";
import { listCycles } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/cycles/")({
  server: { handlers: { GET: ({ request }) => listCycles(request) } },
});
