import { createFileRoute } from "@tanstack/react-router";
import { createView, listViews } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/views/")({
  server: {
    handlers: {
      GET: ({ request }) => listViews(request),
      POST: ({ request }) => createView(request),
    },
  },
});
