// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import {
  enforceRateLimits,
  RL_FEEDBACK_AREAS,
  withPublicApi500,
} from "@/lib/public-api";
import { listPublicFeedbackAreas } from "@/lib/public-feedback-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Auswählbare Feedback-Bereiche für native Clients.
 *
 * Liefert exakt die Bereiche, die auch im öffentlichen Formular erscheinen:
 * aktiviert UND mit einer Zielspalte, die wirklich zum Ziel-Board gehört.
 * Ohne Authentifizierung und bewusst ohne CORS-Header.
 *
 * `withPublicApi500` wie beim Schwester-Endpunkt `/locations`: Die
 * Spezifikation sichert für ALLE öffentlichen Endpunkte einen 500er als
 * `application/json` zu. Ein eigenes try/catch nur um den Datenzugriff ließ die
 * Rate-Limit-Prüfung davor ungedeckt — ein Fehler dort hätte Nexts HTML-
 * Fehlerseite geliefert statt des dokumentierten JSON-Formats.
 */
export const GET = withPublicApi500(async function GET() {
  const limited = await enforceRateLimits([RL_FEEDBACK_AREAS]);
  if (limited) return limited;

  const areas = await listPublicFeedbackAreas();
  return NextResponse.json(
    { areas },
    { headers: { "Cache-Control": "no-store" } },
  );
});
