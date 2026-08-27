import { createFileRoute } from "@tanstack/react-router";
import { createWorkflowState, listWorkflowStates } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/workflow-states/")({
  server: {
    handlers: {
      GET: ({ request }) => listWorkflowStates(request),
      POST: ({ request }) => createWorkflowState(request),
    },
  },
});
