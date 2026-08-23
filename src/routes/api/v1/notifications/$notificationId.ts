import { createFileRoute } from "@tanstack/react-router";
import { markNotification } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/notifications/$notificationId")({
  server: {
    handlers: { PATCH: ({ request, params }) => markNotification(request, params.notificationId) },
  },
});
