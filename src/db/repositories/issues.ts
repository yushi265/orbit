import { and, eq, isNull } from "drizzle-orm";
import type { OrbitDb } from "../client";
import { issues } from "../schema";

export function listOwnedIssues(db: OrbitDb, ownerUserId: string) {
  return db
    .select()
    .from(issues)
    .where(and(eq(issues.userId, ownerUserId), isNull(issues.deletedAt)));
}

export async function updateIssueByVersion(
  db: OrbitDb,
  ownerUserId: string,
  issueId: string,
  version: number,
  patch: Partial<typeof issues.$inferInsert>,
) {
  return db
    .update(issues)
    .set({ ...patch, version: version + 1, updatedAt: Date.now() })
    .where(and(eq(issues.id, issueId), eq(issues.userId, ownerUserId), eq(issues.version, version)))
    .run();
}
