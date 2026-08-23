import { createFileRoute } from "@tanstack/react-router";
import { listNotifications } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/notifications/")({
  server: { handlers: { GET: ({ request }) => listNotifications(request) } },
});
