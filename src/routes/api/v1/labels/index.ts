import { createFileRoute } from "@tanstack/react-router";
import { createLabel, listLabels } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/labels/")({
  server: {
    handlers: {
      GET: ({ request }) => listLabels(request),
      POST: ({ request }) => createLabel(request),
    },
  },
});
