import { json, keyFromRequest, parseBody, parseNumber, withOwner } from "./http";
import { validationError } from "./errors";
import {
  getOrbitStore,
  CreateIssueInput,
  UpdateIssueInput,
  CreateProjectInput,
  UpdateProjectInput,
  CreateViewInput,
  MaintenanceRunInput,
  ContinueRunInput,
  NoteMutationInput,
  RelationMutationInput,
} from "./store";
import { IssueQuery, priorities } from "./model";
import {
  continueRunInputSchema,
  createIssueInputSchema,
  issueDetailResponseSchema,
  maintenanceRunCreateInputSchema,
  noteMutationSchema,
  relationMutationSchema,
  resumeRunInputSchema,
  updateIssueInputSchema,
} from "../shared/contracts";

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
      due: (url.searchParams.get("due") as IssueQuery["filter"]["due"]) || undefined,
    },
    order: (url.searchParams.get("order") as IssueQuery["order"]) || "manual",
    limit: parseNumber(url.searchParams.get("limit"), 100),
  };
}

export async function bootstrap(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(getOrbitStore(owner.userId).bootstrap(owner.userId), 200, requestId),
  );
}

export async function listIssues(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      { items: getOrbitStore(owner.userId).listIssues(owner.userId, parseQuery(request)) },
      200,
      requestId,
    ),
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
    const issue = getOrbitStore(owner.userId).createIssue(owner.userId, input);
    return json({ issue }, 201, requestId);
  });
}

export async function getIssue(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const detail = getOrbitStore(owner.userId).getIssueDetail(owner.userId, issueId);
    return json(issueDetailResponseSchema.parse(detail), 200, requestId);
  });
}

export async function createIssueNote(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const input = parseContract(noteMutationSchema, await parseBody(request)) as NoteMutationInput;
    return json(
      { note: getOrbitStore(owner.userId).createIssueNote(owner.userId, issueId, input) },
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
      { note: getOrbitStore(owner.userId).updateIssueNote(owner.userId, issueId, noteId, input) },
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
    getOrbitStore(owner.userId).deleteIssueNote(owner.userId, issueId, noteId, key);
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
      { relation: getOrbitStore(owner.userId).createIssueRelation(owner.userId, issueId, input) },
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
    getOrbitStore(owner.userId).deleteIssueRelation(owner.userId, issueId, relationId, key);
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
    const issue = getOrbitStore(owner.userId).updateIssue(owner.userId, input);
    return json({ issue }, 200, requestId);
  });
}

export async function archiveIssue(request: Request, issueId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        issue: getOrbitStore(owner.userId).archiveIssue(
          owner.userId,
          issueId,
          keyFromRequest(request),
        ),
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
        issue: getOrbitStore(owner.userId).restoreIssue(
          owner.userId,
          issueId,
          keyFromRequest(request),
        ),
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
        issue: getOrbitStore(owner.userId).trashIssue(
          owner.userId,
          issueId,
          keyFromRequest(request),
        ),
      },
      200,
      requestId,
    ),
  );
}

export async function listProjects(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: getOrbitStore(owner.userId).listProjects(owner.userId) }, 200, requestId),
  );
}

export async function createProject(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = {
      ...body,
      idempotencyKey: String(body.idempotencyKey ?? keyFromRequest(request)),
    } as unknown as CreateProjectInput;
    return json(
      { project: getOrbitStore(owner.userId).createProject(owner.userId, input) },
      201,
      requestId,
    );
  });
}

export async function updateProject(request: Request, projectId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = {
      id: projectId,
      patch: pickFields((body.patch ?? {}) as Record<string, unknown>, [
        "name",
        "description",
        "statusId",
        "priority",
        "color",
        "icon",
        "startAt",
        "targetAt",
      ]),
      idempotencyKey: String(body.idempotencyKey ?? keyFromRequest(request)),
    } as unknown as UpdateProjectInput;
    return json(
      { project: getOrbitStore(owner.userId).updateProject(owner.userId, input) },
      200,
      requestId,
    );
  });
}

export async function archiveProject(request: Request, projectId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        project: getOrbitStore(owner.userId).archiveProject(
          owner.userId,
          projectId,
          keyFromRequest(request),
        ),
      },
      200,
      requestId,
    ),
  );
}

export async function listCycles(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: getOrbitStore(owner.userId).listCycles(owner.userId) }, 200, requestId),
  );
}

export async function closeCycle(request: Request, cycleId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        cycle: getOrbitStore(owner.userId).closeCycle(
          owner.userId,
          cycleId,
          keyFromRequest(request),
        ),
      },
      200,
      requestId,
    ),
  );
}

export async function listViews(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: getOrbitStore(owner.userId).listViews(owner.userId) }, 200, requestId),
  );
}

export async function createView(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    const input = {
      ...body,
      idempotencyKey: String(body.idempotencyKey ?? keyFromRequest(request)),
    } as unknown as CreateViewInput;
    return json(
      { view: getOrbitStore(owner.userId).createView(owner.userId, input) },
      201,
      requestId,
    );
  });
}

export async function deleteView(request: Request, viewId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    getOrbitStore(owner.userId).deleteView(owner.userId, viewId, keyFromRequest(request));
    return json({ ok: true }, 200, requestId);
  });
}

export async function searchIssues(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return json({ items: getOrbitStore(owner.userId).search(owner.userId, query) }, 200, requestId);
  });
}

export async function listNotifications(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json({ items: getOrbitStore(owner.userId).listNotifications(owner.userId) }, 200, requestId),
  );
}

export async function markNotification(
  request: Request,
  notificationId: string,
): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const body = await parseBody(request);
    return json(
      {
        notification: getOrbitStore(owner.userId).markNotification(
          owner.userId,
          notificationId,
          body.read !== false,
          String(body.idempotencyKey ?? keyFromRequest(request)),
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
        preferences: getOrbitStore(owner.userId).updatePreferences(
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
    const run = getOrbitStore(owner.userId).startRun(owner.userId, input);
    return json({ run: getOrbitStore(owner.userId).publicRun(run) }, 202, requestId);
  });
}

export async function currentBackgroundRun(request: Request): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) => {
    const run = getOrbitStore(owner.userId).currentRun(owner.userId);
    return json({ run: run ? getOrbitStore(owner.userId).publicRun(run) : null }, 200, requestId);
  });
}

export async function getBackgroundRun(request: Request, runId: string): Promise<Response> {
  return withOwner(request, async ({ owner, requestId }) =>
    json(
      {
        run: getOrbitStore(owner.userId).publicRun(
          getOrbitStore(owner.userId).getRun(owner.userId, runId),
        ),
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
    const store = getOrbitStore(owner.userId);
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
    return json(
      { run: getOrbitStore(owner.userId).resumeRun(owner.userId, runId) },
      200,
      requestId,
    );
  });
}
