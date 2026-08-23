import { eq } from "drizzle-orm";
import type { OrbitDb } from "../client";
import { userPreferences, userRuntimeLocks, users } from "../schema";

export async function findOwnedUser(db: OrbitDb, ownerUserId: string, email: string) {
  const row = await db.select().from(users).where(eq(users.id, ownerUserId)).get();
  if (!row || row.email.toLowerCase() !== email.toLowerCase()) return null;
  return row;
}

export async function bootstrapOwner(
  db: OrbitDb,
  ownerUserId: string,
  name: string,
  email: string,
  now: number,
) {
  await db
    .insert(users)
    .values({ id: ownerUserId, name, email, avatarUrl: null, createdAt: now })
    .onConflictDoNothing()
    .run();
  await db
    .insert(userPreferences)
    .values({
      userId: ownerUserId,
      timezone: "Asia/Tokyo",
      locale: "ja",
      theme: "system",
      issueCounter: 0,
      estimateEnabled: true,
      defaultIssueDisplayJson: "{}",
    })
    .onConflictDoNothing()
    .run();
  await db
    .insert(userRuntimeLocks)
    .values({
      userId: ownerUserId,
      runId: null,
      lockToken: null,
      status: "idle",
      acquiredAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
    })
    .onConflictDoNothing()
    .run();
}
