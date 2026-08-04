// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { swaggerHtml } from "@/lib/swagger-ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Interaktive Swagger UI der INTERNEN API — nur für angemeldete Gremio-Nutzer.
 *
 * Die Prüfung läuft serverseitig: Ohne gültige Web-Session wird die Seite gar
 * nicht erst ausgeliefert (Weiterleitung auf /login, wie überall sonst im
 * internen Bereich). Eine rein clientseitige Umleitung würde die Spezifikation
 * bereits ausgeliefert haben.
 *
 * Wichtig — die Anmeldung ersetzt den API-Token NICHT:
 *   1. Die Web-Session berechtigt zum Öffnen dieser Dokumentation.
 *   2. Für „Try it out" gibt der Nutzer über „Authorize" seinen eigenen
 *      API-Token ein (bleibt im Browser, wird nie serverseitig erzeugt).
 *   3. Die aufgerufene /api/v1-Route prüft diesen Token unabhängig davon und
 *      wendet alle Board-, Gruppen- und Rollenrechte an.
 */
const PAGE = swaggerHtml({
  title: "Gremio — Interne API",
  specUrl: "/api/v1/openapi.json",
  notice:
    "Interne API · Zum Ausprobieren oben rechts über „Authorize“ einen eigenen API-Token hinterlegen (Mein Konto → API-Tokens). Deine Anmeldung hier ersetzt den Token nicht.",
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    const base = env.APP_BASE_URL.replace(/\/+$/, "");
    return NextResponse.redirect(`${base}/login`, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nie zwischenspeichern: Nach dem Logout darf die Seite nicht aus dem
      // Cache erneut erscheinen.
      "Cache-Control": "no-store, private",
    },
  });
}
