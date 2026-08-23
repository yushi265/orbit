import { createFileRoute } from "@tanstack/react-router";
import { deleteView } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/views/$viewId")({
  server: { handlers: { DELETE: ({ request, params }) => deleteView(request, params.viewId) } },
});
