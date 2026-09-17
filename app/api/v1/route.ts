// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { authApi } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Kleiner Discovery-Endpunkt: bestätigt den Token und listet die Endpunkte. */
export async function GET(req: Request) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({
    api: "Gremio API",
    version: "v1",
    authenticatedAs: {
      id: ctx.user.id,
      username: ctx.user.username,
      role: ctx.user.role,
    },
    token: {
      scope: ctx.scope,
      boards: ctx.boardIds ? [...ctx.boardIds] : "all",
    },
    endpoints: {
      "GET /api/v1/cards": "Karten boardübergreifend suchen und paginieren",
      "GET /api/v1/boards/{id}/users": "Zuweisbare Nutzer suchen",
      "GET /api/v1/boards/{id}/accounts": "Kontenauswahl",
      "GET /api/v1/boards/{id}/priorities": "Prioritätsauswahl",
      "GET /api/v1/cards/{id}/comments": "Kommentare lesen",
      "POST /api/v1/cards/{id}/comments": "Kommentar hinzufügen",
      "PATCH /api/v1/cards/{id}/comments/{commentId}": "Eigenen Kommentar bearbeiten",
      "DELETE /api/v1/cards/{id}/comments/{commentId}": "Kommentar löschen (Autor/Verwalter)",
      "GET /api/v1/cards/{id}/activity": "Unveränderlichen Verlauf lesen",
      "GET /api/v1/cards/{id}/attachments": "Sichtbare Anhänge auflisten",
      "GET /api/v1/cards/{id}/attachments/{attachmentId}": "Sichtbaren Anhang herunterladen",
      "POST /api/v1/cards/{id}/attachments": "Anhang hochladen",
      "GET /api/v1/boards": "Zugängliche Boards auflisten",
      "GET /api/v1/boards/{id}": "Board mit Spalten & sichtbaren Feldern",
      "GET /api/v1/boards/{id}/cards":
        "Karten eines Boards (optional ?statusId=, ?archived=true|all)",
      "POST /api/v1/boards/{id}/cards": "Karte anlegen",
      "GET /api/v1/me/cards": "Mir zugewiesene Karten (board-übergreifend)",
      "GET /api/v1/cards/{id}": "Karte abrufen",
      "PATCH /api/v1/cards/{id}":
        "Karte ändern / verschieben (statusId, position) / wiederherstellen (archived:false). Manuelles Archivieren (archived:true) ist nicht möglich.",
      "DELETE /api/v1/cards/{id}": "Karte löschen",
    },
  });
}
