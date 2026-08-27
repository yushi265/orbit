import { createFileRoute } from "@tanstack/react-router";
import { listRecent } from "../../../server/api";

export const Route = createFileRoute("/api/v1/recent")({
  server: { handlers: { GET: ({ request }) => listRecent(request) } },
});
