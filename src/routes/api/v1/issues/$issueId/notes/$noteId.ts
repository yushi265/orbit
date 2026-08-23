import { createFileRoute } from "@tanstack/react-router";
import { deleteIssueNote, updateIssueNote } from "../../../../../../server/api";

export const Route = createFileRoute("/api/v1/issues/$issueId/notes/$noteId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => updateIssueNote(request, params.issueId, params.noteId),
      DELETE: ({ request, params }) => deleteIssueNote(request, params.issueId, params.noteId),
    },
  },
});
