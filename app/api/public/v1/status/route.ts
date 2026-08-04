// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import {
  enforceRateLimits,
  publicApiError,
  RL_STATUS,
} from "@/lib/public-api";
import {
  attachmentUrlFor,
  MAX_STATUS_URL_LENGTH,
  parseStatusLink,
  statusLinksFor,
} from "@/lib/public-status-url";
import { getApplicationStatusByToken } from "@/lib/public-status";
import { getFeedbackByToken } from "@/lib/public-feedback-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ein Status-Link braucht ~60 Zeichen — 8 KiB sind großzügig. */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * Öffentlicher Statusabruf für native Android-/iOS-Clients.
 *
 * WARUM POST FÜR EINEN LESENDEN ABRUF: Der Status-Link ist ein geheimes
 * Bearer-Credential. Als Query-Parameter (`GET ?statusUrl=…`) landete er in
 * Browser-Historien, Proxy- und Access-Logs, Monitoring und Referrer-Headern.
 * Im JSON-Body bleibt er davon verschont. Der Endpunkt verändert NICHTS:
 * keine Karte, kein Zeitstempel, keine Aktivität, keine Datei — und braucht
 * deshalb auch keinen `Idempotency-Key`.
 *
 * Die übergebene URL wird niemals abgerufen (siehe lib/public-status-url.ts),
 * sondern nur lokal geparst und gegen APP_BASE_URL geprüft.
 *
 * Ausgegeben wird ausschließlich, was die jeweilige öffentliche Webansicht
 * zeigt — dieselben Loader liefern die Daten.
 */

/** Header für alle Antworten: nichts zwischenspeichern, keinen Referrer lecken. */
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

/** Bewusst identisch für unbekannten Token, gelöschte Karte und falschen Typ. */
const NOT_FOUND = "Der Vorgang wurde nicht gefunden.";

export async function POST(req: Request) {
  const limited = await enforceRateLimits([RL_STATUS]);
  if (limited) return limited;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().split(";")[0].trim().startsWith("application/json")) {
    return publicApiError(415, "Content-Type muss application/json sein.", {
      headers: SECURITY_HEADERS,
    });
  }

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return publicApiError(413, "Die Anfrage ist zu groß.", {
      headers: SECURITY_HEADERS,
    });
  }

  // Auch ohne (oder mit gelogener) Content-Length hart begrenzen.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return publicApiError(413, "Die Anfrage ist zu groß.", {
      headers: SECURITY_HEADERS,
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return publicApiError(400, "Der JSON-Body ist ungültig.", {
      headers: SECURITY_HEADERS,
    });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return publicApiError(400, "Der JSON-Body muss ein Objekt sein.", {
      headers: SECURITY_HEADERS,
    });
  }

  // Unbekannte Felder ablehnen — gleiche Tippfehler-Konvention wie die übrigen
  // Endpunkte der öffentlichen API.
  const keys = Object.keys(body as Record<string, unknown>);
  const unknown = keys.filter((k) => k !== "statusUrl");
  if (unknown.length) {
    return publicApiError(400, `Unbekanntes Feld: ${unknown.join(", ")}.`, {
      headers: SECURITY_HEADERS,
    });
  }

  const parsed = parseStatusLink((body as { statusUrl?: unknown }).statusUrl);
  if (!parsed.ok) {
    // Absichtlich EINE Meldung für alle Formfehler — sie verrät nichts darüber,
    // welcher Teil des Links „fast" gepasst hätte. Der Link selbst wird nicht
    // zurückgegeben und nicht geloggt.
    const message =
      parsed.reason === "missing"
        ? "Bitte einen gültigen Status-Link angeben."
        : `Der Status-Link ist ungültig. Erlaubt sind ausschließlich Links dieser Instanz in der Form /status/{token} oder /feedback/status/{token} (max. ${MAX_STATUS_URL_LENGTH} Zeichen).`;
    return publicApiError(400, message, { headers: SECURITY_HEADERS });
  }

  const links = statusLinksFor(parsed.kind, parsed.token);

  if (parsed.kind === "application") {
    // Liefert auch dann undefined, wenn der Token zu einem FEEDBACK gehört —
    // von außen nicht von „unbekannt" unterscheidbar.
    const a = await getApplicationStatusByToken(parsed.token);
    if (!a) {
      return publicApiError(404, NOT_FOUND, { headers: SECURITY_HEADERS });
    }
    return NextResponse.json(
      {
        type: "application",
        ...links,
        number: a.number,
        submittedAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        application: {
          title: a.title,
          applicant: a.applicant,
        },
        status: {
          name: a.statusName,
          resubmittedAt: a.resubmittedAt ? a.resubmittedAt.toISOString() : null,
          archived: a.archived,
        },
        // Leerer Hinweis zählt als „keiner" — wie in der Webansicht, die den
        // Kasten dann gar nicht erst rendert.
        publicNote:
          a.applicantNote && a.applicantNote.trim() !== ""
            ? a.applicantNote
            : null,
        documents: a.documents.map((d) => ({
          kind: d.kind,
          label: d.label,
          filename: d.filename,
          mimeType: d.mime,
          downloadUrl: attachmentUrlFor(parsed.token, d.id),
        })),
        availableActions: {
          canUploadDocuments: a.canUploadDocuments,
          submitMode: a.submitMode,
        },
      },
      { status: 200, headers: SECURITY_HEADERS },
    );
  }

  const fb = await getFeedbackByToken(parsed.token);
  if (!fb) {
    return publicApiError(404, NOT_FOUND, { headers: SECURITY_HEADERS });
  }
  return NextResponse.json(
    {
      type: "feedback",
      ...links,
      number: fb.number,
      submittedAt: fb.createdAt.toISOString(),
      updatedAt: fb.updatedAt.toISOString(),
      // Snapshot der Originaleinreichung — spätere interne Änderungen an
      // `cards.applicant`/`cards.notes` wirken sich hier NICHT aus.
      feedback: {
        area: fb.areaName,
        submitterName: fb.submitterName,
        text: fb.feedbackText,
      },
      status: { name: fb.statusName },
      publicNote:
        fb.applicantNote && fb.applicantNote.trim() !== ""
          ? fb.applicantNote
          : null,
      // Feedback kennt weder Anhänge noch öffentliche Aktionen.
      documents: [],
      availableActions: { canUploadDocuments: false, submitMode: null },
    },
    { status: 200, headers: SECURITY_HEADERS },
  );
}
