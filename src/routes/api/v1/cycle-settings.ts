import { createFileRoute } from "@tanstack/react-router";
import { updateCycleSettings } from "../../../server/api";

export const Route = createFileRoute("/api/v1/cycle-settings")({
  server: { handlers: { PATCH: ({ request }) => updateCycleSettings(request) } },
});
