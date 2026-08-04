// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import {
  enforceRateLimits,
  publicApiError,
  RL_FEEDBACK_AREAS,
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
 */
export async function GET() {
  const limited = await enforceRateLimits([RL_FEEDBACK_AREAS]);
  if (limited) return limited;

  try {
    const areas = await listPublicFeedbackAreas();
    return NextResponse.json(
      { areas },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return publicApiError(500, "Interner Fehler. Bitte später erneut versuchen.");
  }
}
