import { z } from "zod";
import { json, keyFromRequest, parseBody, parseNumber, withOwner } from "./http";
import { validationError } from "./errors";
import {
  CreateIssueInput,
  UpdateIssueInput,
  CreateProjectInput,
  UpdateProjectInput,
  CreateViewInput,
  MaintenanceRunInput,
  ContinueRunInput,
  BulkIssueInput,
  NoteMutationInput,
  RelationMutationInput,
  CreateLabelInput,
  UpdateLabelInput,
  UpdateCycleMetadataInput,
  UpdateViewInput,
} from "./store";
import { IssueQuery, priorities } from "./model";
import {
  continueRunInputSchema,
  createIssueInputSchema,
  cycleMetadataMutationSchema,
  issueDetailResponseSchema,
  maintenanceRunCreateInputSchema,
  noteMutationSchema,
  bulkIssueMutationSchema,
  labelMutationSchema,
  labelUpdateSchema,
  notificationReadMutationSchema,
  projectCreateMutationSchema,
  projectMetadataMutationSchema,
  relationMutationSchema,
  resumeRunInputSchema,
  savedViewMutationSchema,
  savedViewUpdateSchema,
  updateIssueInputSchema,
} from "../shared/contracts";

const projectMetadataPatchEnvelopeSchema = z.strictObject({
  idempotencyKey: z.string().min(1).optional(),
  patch: z.unknown(),
});
const projectMetadataPatchSchema = projectMetadataMutationSchema.omit({ idempotencyKey: true });

function bodyMutationKey(body: Record<string, unknown>, request: Request): unknown {
  return Object.prototype.hasOwnProperty.call(body, "idempotencyKey")
    ? body.idempotencyKey
    : request.headers.get("Idempotency-Key");
}

function parseContract<T>(
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { flatten: () => { fieldErrors: Record<string, string[]> } };
        };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw validationError(parsed.error.flatten().fieldErrors);
}

function textFromDocument(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  const ownText = typeof node.text === "string" ? node.text : "";
  const separator = node.type === "doc" ? "\n" : "";
  const children = Array.isArray(node.content)
    ? node.content.map(textFromDocument).join(separator)
    : "";
  return `${ownText}${children}`;
}

function pickFields(
  body: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => field in body).map((field) => [field, body[field]]),
  );
}

function parsePriorityList(value: string | null): IssueQuery["filter"]["priorities"] {
  if (!value) return undefined;
  return value
    .split(",")
    .filter((item): item is (typeof priorities)[number] =>
      priorities.includes(item as (typeof priorities)[number]),
    );
}

function parseQuery(request: Request): Partial<IssueQuery> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "board" ? "board" : "list";
  return {
    mode,
    filter: {
      text: url.searchParams.get("q") ?? undefined,
      priorities: parsePriorityList(url.searchParams.get("priority")),
      statusIds: url.searchParams.get("status")?.split(",").filter(Boolean),
      projectIds: url.searchParams.get("project")?.split(",").filter(Boolean),
      cycleIds: url.searchParams.get("cycle")?.split(",").filter(Boolean),
      labelIds: url.searchParams.get("label")?.split(",").filter(Boolean),
      due: (url.searchParams.get("due") as IssueQuery["filter"]["due"]) || undefined,
    },
    order: (url.searchParams.get("order") as IssueQuery["order"]) || "manual",
    limit: parseNumber(url.searchParams.get("limit"), 100),
  };
}

export async function bootstrap(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(owner.store.bootstrap(owner.userId), 200, requestId),
  );
}

export async function listIssues(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: owner.store.listIssues(owner.userId, parseQuery(request)) }, 200, requestId),
  );
}

export async function createIssue(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const rawInput = {
      ...body,
      idempotencyKey: body.idempotencyKey,
    };
    const parsed = parseContract(createIssueInputSchema, rawInput);
    const input = {
      ...parsed,
      description: textFromDocument(parsed.descriptionJson),
    } as unknown as CreateIssueInput;
    const issue = owner.store.createIssue(owner.userId, input);
    return json({ issue }, 201, requestId);
  });
}

export async function getIssue(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const detail = owner.store.getIssueDetail(owner.userId, issueId);
    return json(issueDetailResponseSchema.parse(detail), 200, requestId);
  });
}

export async function createIssueNote(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(noteMutationSchema, await parseBody(request)) as NoteMutationInput;
    return json(
      { note: owner.store.createIssueNote(owner.userId, issueId, input) },
      201,
      requestId,
    );
  });
}

export async function updateIssueNote(
  request: Request,
  issueId: string,
  noteId: string,
): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(noteMutationSchema, await parseBody(request)) as NoteMutationInput;
    return json(
      { note: owner.store.updateIssueNote(owner.userId, issueId, noteId, input) },
      200,
      requestId,
    );
  });
}

export async function deleteIssueNote(
  request: Request,
  issueId: string,
  noteId: string,
): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const key = request.headers.get("Idempotency-Key");
    if (!key) throw validationError({ idempotencyKey: ["Idempotency-Keyを指定してください。"] });
    owner.store.deleteIssueNote(owner.userId, issueId, noteId, key);
    return json({ ok: true }, 200, requestId);
  });
}

export async function createIssueRelation(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(
      relationMutationSchema,
      await parseBody(request),
    ) as RelationMutationInput;
    return json(
      { relation: owner.store.createIssueRelation(owner.userId, issueId, input) },
      201,
      requestId,
    );
  });
}

export async function deleteIssueRelation(
  request: Request,
  issueId: string,
  relationId: string,
): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const key = request.headers.get("Idempotency-Key");
    if (!key) throw validationError({ idempotencyKey: ["Idempotency-Keyを指定してください。"] });
    owner.store.deleteIssueRelation(owner.userId, issueId, relationId, key);
    return json({ ok: true }, 200, requestId);
  });
}

export async function updateIssue(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const rawInput = {
      id: issueId,
      version: Number(body.version),
      patch: body.patch ?? {},
      idempotencyKey: body.idempotencyKey,
    };
    const parsed = parseContract(updateIssueInputSchema, rawInput);
    const { descriptionJson, ...patchWithoutDocument } = parsed.patch;
    const input = {
      ...parsed,
      patch: {
        ...patchWithoutDocument,
        ...(descriptionJson !== undefined
          ? { description: textFromDocument(descriptionJson) }
          : {}),
      },
    } as unknown as UpdateIssueInput;
    const issue = owner.store.updateIssue(owner.userId, input);
    return json({ issue }, 200, requestId);
  });
}

export async function archiveIssue(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        issue: owner.store.archiveIssue(owner.userId, issueId, keyFromRequest(request)),
      },
      200,
      requestId,
    ),
  );
}

export async function restoreIssue(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        issue: owner.store.restoreIssue(owner.userId, issueId, keyFromRequest(request)),
      },
      200,
      requestId,
    ),
  );
}

export async function trashIssue(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        issue: owner.store.trashIssue(owner.userId, issueId, keyFromRequest(request)),
      },
      200,
      requestId,
    ),
  );
}

export async function listProjects(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: owner.store.listProjects(owner.userId) }, 200, requestId),
  );
}

export async function listLabels(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: owner.store.listLabels(owner.userId) }, 200, requestId),
  );
}

export async function createLabel(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(labelMutationSchema, await parseBody(request)) as CreateLabelInput;
    return json({ label: owner.store.createLabel(owner.userId, input) }, 201, requestId);
  });
}

export async function updateLabel(request: Request, labelId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(labelUpdateSchema, await parseBody(request)) as UpdateLabelInput;
    return json({ label: owner.store.updateLabel(owner.userId, labelId, input) }, 200, requestId);
  });
}

export async function deleteLabel(request: Request, labelId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const mutationKey = request.headers.get("Idempotency-Key");
    if (!mutationKey)
      throw validationError({ idempotencyKey: ["Idempotency-Keyを指定してください。"] });
    owner.store.deleteLabel(owner.userId, labelId, mutationKey);
    return json({ ok: true }, 200, requestId);
  });
}

export async function bulkUpdateIssues(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(
      bulkIssueMutationSchema,
      await parseBody(request),
    ) as BulkIssueInput;
    return json({ items: owner.store.bulkUpdateIssues(owner.userId, input) }, 200, requestId);
  });
}

export async function createProject(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = parseContract(projectCreateMutationSchema, {
      ...body,
      idempotencyKey: bodyMutationKey(body, request),
    }) as CreateProjectInput;
    return json({ project: owner.store.createProject(owner.userId, input) }, 201, requestId);
  });
}

export async function updateProject(request: Request, projectId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const parsed = Object.prototype.hasOwnProperty.call(body, "patch")
      ? (() => {
          const envelope = parseContract(projectMetadataPatchEnvelopeSchema, body);
          const patch = parseContract(projectMetadataPatchSchema, envelope.patch);
          return parseContract(projectMetadataMutationSchema, {
            ...patch,
            idempotencyKey: envelope.idempotencyKey ?? request.headers.get("Idempotency-Key"),
          });
        })()
      : parseContract(projectMetadataMutationSchema, {
          ...body,
          idempotencyKey: bodyMutationKey(body, request),
        });
    const { idempotencyKey, ...patch } = parsed;
    const input = {
      id: projectId,
      patch,
      idempotencyKey,
    } as unknown as UpdateProjectInput;
    return json({ project: owner.store.updateProject(owner.userId, input) }, 200, requestId);
  });
}

export async function archiveProject(request: Request, projectId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        project: owner.store.archiveProject(owner.userId, projectId, keyFromRequest(request)),
      },
      200,
      requestId,
    ),
  );
}

export async function listCycles(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: owner.store.listCycles(owner.userId) }, 200, requestId),
  );
}

export async function closeCycle(request: Request, cycleId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        cycle: owner.store.closeCycle(owner.userId, cycleId, keyFromRequest(request)),
      },
      200,
      requestId,
    ),
  );
}

export async function updateCycleMetadata(request: Request, cycleId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(
      cycleMetadataMutationSchema,
      await parseBody(request),
    ) as UpdateCycleMetadataInput;
    return json(
      { cycle: owner.store.updateCycleMetadata(owner.userId, cycleId, input) },
      200,
      requestId,
    );
  });
}

export async function listViews(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: owner.store.listViews(owner.userId) }, 200, requestId),
  );
}

export async function createView(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = parseContract(savedViewMutationSchema, {
      ...body,
      idempotencyKey: bodyMutationKey(body, request),
    }) as CreateViewInput;
    return json({ view: owner.store.createView(owner.userId, input) }, 201, requestId);
  });
}

export async function updateView(request: Request, viewId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = parseContract(savedViewUpdateSchema, {
      ...body,
      idempotencyKey: bodyMutationKey(body, request),
    }) as UpdateViewInput;
    return json({ view: owner.store.updateView(owner.userId, viewId, input) }, 200, requestId);
  });
}

export async function deleteView(request: Request, viewId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const mutationKey = request.headers.get("Idempotency-Key");
    if (!mutationKey) throw validationError({ idempotencyKey: ["冪等性キーを指定してください。"] });
    owner.store.deleteView(owner.userId, viewId, mutationKey);
    return json({ ok: true }, 200, requestId);
  });
}

export async function searchIssues(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return json({ items: owner.store.search(owner.userId, query) }, 200, requestId);
  });
}

export async function listNotifications(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: owner.store.listNotifications(owner.userId) }, 200, requestId),
  );
}

export async function markNotification(
  request: Request,
  notificationId: string,
): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(notificationReadMutationSchema, await parseBody(request));
    return json(
      {
        notification: owner.store.markNotification(
          owner.userId,
          notificationId,
          input.read,
          input.idempotencyKey,
        ),
      },
      200,
      requestId,
    );
  });
}

export async function updatePreferences(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    return json(
      {
        preferences: owner.store.updatePreferences(
          owner.userId,
          pickFields(body, ["timezone", "locale", "theme", "estimateEnabled"]),
          String(body.idempotencyKey ?? keyFromRequest(request)),
        ),
      },
      200,
      requestId,
    );
  });
}

export async function startBackgroundRun(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = parseContract(maintenanceRunCreateInputSchema, body) as MaintenanceRunInput;
    const run = owner.store.startRun(owner.userId, input);
    return json({ run: owner.store.publicRun(run) }, 202, requestId);
  });
}

export async function currentBackgroundRun(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const run = owner.store.currentRun(owner.userId);
    return json({ run: run ? owner.store.publicRun(run) : null }, 200, requestId);
  });
}

export async function getBackgroundRun(request: Request, runId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        run: owner.store.publicRun(owner.store.getRun(owner.userId, runId)),
      },
      200,
      requestId,
    ),
  );
}

export async function continueBackgroundRun(request: Request, runId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = parseContract(continueRunInputSchema, {
      expected_cursor: body.expected_cursor,
      idempotencyKey: body.idempotencyKey,
    }) as ContinueRunInput;
    const store = owner.store;
    return json(
      store.continueRun(owner.userId, runId, input, store.lockTokenFor(owner.userId, runId)),
      200,
      requestId,
    );
  });
}

export async function resumeBackgroundRun(request: Request, runId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    parseContract(resumeRunInputSchema, {
      idempotencyKey: body.idempotencyKey,
    });
    return json({ run: owner.store.resumeRun(owner.userId, runId) }, 200, requestId);
  });
}
