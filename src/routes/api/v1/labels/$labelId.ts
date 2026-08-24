import { createFileRoute } from "@tanstack/react-router";
import { deleteLabel, updateLabel } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/labels/$labelId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => updateLabel(request, params.labelId),
      DELETE: ({ request, params }) => deleteLabel(request, params.labelId),
    },
  },
});
