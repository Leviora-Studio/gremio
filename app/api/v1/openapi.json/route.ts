// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { openApiV1Spec } from "@/lib/openapi-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * OpenAPI 3.1 der INTERNEN API — nur für angemeldete Gremio-Nutzer.
 *
 * Anders als die öffentliche Spezifikation (`/api/public/v1/openapi.json`) ist
 * dieses Dokument NICHT anonym abrufbar: Es beschreibt interne Strukturen und
 * Berechtigungsregeln. Geprüft wird serverseitig die Web-Session — bei
 * fehlender Anmeldung gibt es ein API-gerechtes 401 (JSON), kein HTML und
 * keinen Redirect, damit auch maschinelle Abrufe eine klare Antwort bekommen.
 *
 * Die Anmeldung erlaubt nur das LESEN der Spezifikation. Die beschriebenen
 * Endpunkte selbst verlangen unverändert einen Bearer-Token.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      {
        error:
          "Anmeldung erforderlich. Die interne API-Dokumentation ist nur für angemeldete Nutzer abrufbar.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(openApiV1Spec, {
    headers: { "Cache-Control": "no-store" },
  });
}
