// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { serveSwaggerAsset } from "@/lib/swagger-ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Neutrale Asset-Route für BEIDE Swagger-UIs (öffentlich und intern) — eine
 * Quelle statt zweier Kopien derselben CSS-/JS-Dateien.
 *
 * Bewusst ohne Anmeldung erreichbar: Hier liegen ausschließlich die
 * unveränderten Dateien der Abhängigkeit `swagger-ui-dist`, keine
 * Spezifikation und keine internen Daten. Geschützt sind die interne
 * Doku-Seite (`/api/v1/docs`) und die interne Spezifikation
 * (`/api/v1/openapi.json`).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  return serveSwaggerAsset(file);
}
