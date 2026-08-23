import { createFileRoute } from "@tanstack/react-router";
import { currentBackgroundRun } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/background-runs/current")({
  server: { handlers: { GET: ({ request }) => currentBackgroundRun(request) } },
});
