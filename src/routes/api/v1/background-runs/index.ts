import { createFileRoute } from "@tanstack/react-router";
import { startBackgroundRun } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/background-runs/")({
  server: { handlers: { POST: ({ request }) => startBackgroundRun(request) } },
});
