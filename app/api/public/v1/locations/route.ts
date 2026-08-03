// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, locations } from "@/lib/db/schema";
import { enforceRateLimits, RL_LOCATIONS } from "@/lib/public-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Auswählbare Standorte für native Clients — dieselbe Menge wie im öffentlichen
 * Formular: aktiviert UND vollständig geroutet (Ziel-Board + Zielspalte, wobei
 * die Spalte auch wirklich zu diesem Board gehört). Ein Standort ohne gültiges
 * Ziel hätte keinen Platz für die Karte und darf gar nicht erst angeboten
 * werden.
 *
 * Bewusst OHNE CORS-Header: native Apps unterliegen keinem Browser-CORS.
 */
export async function GET() {
  const limited = await enforceRateLimits([RL_LOCATIONS]);
  if (limited) return limited;

  const rows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    // INNER JOIN auf die Zielspalte: erzwingt, dass sie existiert UND zum
    // Ziel-Board gehört (eine verwaiste Zuordnung fällt so heraus).
    .innerJoin(
      boardStatuses,
      and(
        eq(boardStatuses.id, locations.targetStatusId),
        eq(boardStatuses.boardId, locations.targetBoardId),
      ),
    )
    .where(and(eq(locations.enabled, true), isNotNull(locations.targetBoardId)))
    // Gleiche Reihenfolge wie im öffentlichen Formular.
    .orderBy(asc(locations.position), asc(locations.id));

  return NextResponse.json(
    { locations: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}
