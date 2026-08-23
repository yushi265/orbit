import { createFileRoute } from "@tanstack/react-router";
import { bootstrap } from "../../../server/api";

export const Route = createFileRoute("/api/v1/bootstrap")({
  server: { handlers: { GET: ({ request }) => bootstrap(request) } },
});
