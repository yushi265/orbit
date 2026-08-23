import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema";

export type OrbitBindings = { DB: D1Database };

export function createDb(bindings: OrbitBindings) {
  return drizzle(bindings.DB, { schema });
}

export type OrbitDb = ReturnType<typeof createDb>;
