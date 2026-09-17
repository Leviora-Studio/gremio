// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpClients } from "@/lib/db/schema";
import { registrationSchema } from "@/lib/mcp-oauth";
import { apiJson } from "@/lib/api-card-extras";
import { oauthError, oauthJson, oauthRate } from "@/lib/mcp-http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!oauthRate(req, "register", 10))
    return oauthError(
      "temporarily_unavailable",
      "Zu viele Registrierungen.",
      429,
    );
  const parsed = registrationSchema.safeParse(await apiJson(req, 16384));
  if (!parsed.success)
    return oauthError(
      "invalid_client_metadata",
      "Name, sichere redirect_uris und PKCE-Client ohne Secret erforderlich.",
    );
  const p = parsed.data,
    id = randomUUID();
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(18352026)`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mcpClients);
    if (count >= 10000) return false;
    await tx
      .insert(mcpClients)
      .values({ id, name: p.client_name, redirectUris: p.redirect_uris });
    return true;
  });
  if (!inserted)
    return oauthError(
      "temporarily_unavailable",
      "Registrierung derzeit nicht verfügbar.",
      503,
    );
  return oauthJson(
    { ...p, client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000) },
    201,
  );
}
