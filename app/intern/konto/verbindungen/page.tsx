// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getAccessibleBoards } from "@/lib/authz";
import { db } from "@/lib/db";
import { mcpClients, mcpGrants, mcpGrantBoards } from "@/lib/db/schema";
import { mcpResource } from "@/lib/mcp-oauth";
import { McpConnection } from "@/components/McpConnection";
export const metadata = { title: "Verbundene Anwendungen — Gremio" };
export default async function ConnectionsPage() {
  const user = await requireUser();
  const grants = await db
    .select({ grant: mcpGrants, name: mcpClients.name })
    .from(mcpGrants)
    .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
    .where(and(eq(mcpGrants.userId, user.id), isNull(mcpGrants.revokedAt)))
    .orderBy(desc(mcpGrants.createdAt));
  const rows = grants.length
    ? await db
        .select()
        .from(mcpGrantBoards)
        .where(
          inArray(
            mcpGrantBoards.grantId,
            grants.map((g) => g.grant.id),
          ),
        )
    : [];
  const boards = (await getAccessibleBoards(user)).map((b) => ({
    id: b.id,
    name: b.name,
  }));
  const fmt = (date: Date) =>
    date.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/intern/konto" className="text-sm text-blue-700">
        ← Mein Konto
      </Link>
      <h1 className="text-2xl font-bold">Verbundene Anwendungen</h1>
      <p>
        Füge diese MCP-Adresse in deiner Anwendung hinzu und melde dich
        anschließend mit deinem Gremien-Konto an:
      </p>
      <code className="block break-all rounded bg-slate-100 p-3 text-sm">
        {mcpResource()}
      </code>
      {!grants.length && (
        <p className="text-slate-500">Noch keine Anwendungen verbunden.</p>
      )}
      {grants.map(({ grant: g, name }) => (
        <McpConnection
          key={`${g.id}-${g.scope}-${g.restricted}-${rows
            .filter((r) => r.grantId === g.id)
            .map((r) => r.boardId)
            .join(",")}`}
          boards={boards}
          connection={{
            id: g.id,
            name,
            scope: g.scope,
            allBoards: !g.restricted,
            boardIds: rows
              .filter((r) => r.grantId === g.id)
              .map((r) => r.boardId),
            createdAt: fmt(g.createdAt),
            lastUsedAt: g.lastUsedAt ? fmt(g.lastUsedAt) : null,
          }}
        />
      ))}
    </div>
  );
}
