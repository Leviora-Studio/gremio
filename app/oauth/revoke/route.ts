// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpTokens, mcpGrants } from "@/lib/db/schema";
import { tokenHash } from "@/lib/mcp-oauth";
import { oauthError, oauthForm, oauthJson, oauthRate } from "@/lib/mcp-http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!oauthRate(req, "revoke"))
    return oauthError("temporarily_unavailable", "Zu viele Anfragen.", 429);
  const p = await oauthForm(req);
  if (!p?.get("token") || !p.get("client_id"))
    return oauthError("invalid_request", "Token und client_id erforderlich.");
  const [row] = await db
    .select({ id: mcpGrants.id })
    .from(mcpTokens)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpTokens.grantId))
    .where(
      and(
        eq(mcpTokens.hash, tokenHash(p.get("token")!)),
        eq(mcpGrants.clientId, p.get("client_id")!),
      ),
    );
  if (row)
    await db
      .update(mcpGrants)
      .set({ revokedAt: new Date() })
      .where(eq(mcpGrants.id, row.id));
  return oauthJson({});
}
