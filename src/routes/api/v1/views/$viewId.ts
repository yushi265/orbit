import { createFileRoute } from "@tanstack/react-router";
import { deleteView, updateView } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/views/$viewId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => updateView(request, params.viewId),
      DELETE: ({ request, params }) => deleteView(request, params.viewId),
    },
  },
});
