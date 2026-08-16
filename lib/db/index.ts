// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __pgPool?: Pool;
};

function createPool(): Pool {
  const p = new Pool({ connectionString: env.DATABASE_URL });
  // WICHTIG: Ohne 'error'-Handler beendet ein Fehler auf einem idle Client
  // (DB-Neustart, Netzabbruch, Server-Idle-Timeout) den GESAMTEN Node-Prozess.
  // Hier nur loggen — der Pool ersetzt defekte Verbindungen selbst.
  p.on("error", (err) => {
    console.error("[pg pool] idle client error:", err.message);
  });
  return p;
}

export const pool: Pool = globalForDb.__pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pgPool = pool;
}

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export { schema };
