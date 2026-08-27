import { createFileRoute } from "@tanstack/react-router";
import { deleteWorkflowState, updateWorkflowState } from "../../../../server/api";

export const Route = createFileRoute("/api/v1/workflow-states/$workflowStateId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => updateWorkflowState(request, params.workflowStateId),
      DELETE: ({ request, params }) => deleteWorkflowState(request, params.workflowStateId),
    },
  },
});
