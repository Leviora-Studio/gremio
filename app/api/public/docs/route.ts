// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { swaggerHtml } from "@/lib/swagger-ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Interaktive Swagger UI der ÖFFENTLICHEN API. Darf öffentlich erreichbar sein
 * — die dokumentierten Endpunkte sind es ebenfalls.
 *
 * Zeigt ausschließlich `/api/public/v1`. Die interne API hat eine eigene,
 * anmeldepflichtige Oberfläche unter `/api/v1/docs` mit eigener Spezifikation;
 * beide werden bewusst nicht zusammengeführt.
 */
const PAGE = swaggerHtml({
  title: "Gremio — Öffentliche API",
  specUrl: "/api/public/v1/openapi.json",
});

export async function GET() {
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
