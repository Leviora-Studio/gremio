// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { listPublicLocations } from "@/lib/public-application-submission";
import {
  enforceRateLimits,
  RL_LOCATIONS,
  withPublicApi500,
} from "@/lib/public-api";

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
export const GET = withPublicApi500(async function GET() {
  const limited = await enforceRateLimits([RL_LOCATIONS]);
  if (limited) return limited;

  // Gemeinsame Quelle mit dem Browserformular (`app/page.tsx`): Der INNER JOIN
  // auf die Zielspalte erzwingt, dass sie existiert UND zum Ziel-Board gehört —
  // eine verwaiste Zuordnung fällt heraus. Reihenfolge identisch zum Formular.
  const rows = await listPublicLocations();

  return NextResponse.json(
    { locations: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
});
