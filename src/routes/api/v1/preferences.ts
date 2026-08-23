import { createFileRoute } from "@tanstack/react-router";
import { updatePreferences } from "../../../server/api";

export const Route = createFileRoute("/api/v1/preferences")({
  server: { handlers: { PATCH: ({ request }) => updatePreferences(request) } },
});
