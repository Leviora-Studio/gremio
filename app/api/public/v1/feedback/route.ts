// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import {
  enforceRateLimits,
  publicApiError,
  publicFeedbackLinks,
  RL_FEEDBACK_BURST,
  RL_FEEDBACK_DAY,
} from "@/lib/public-api";
import { submitPublicFeedback } from "@/lib/public-feedback-submission";
import {
  computeFeedbackFingerprint,
  findIdempotencyRecordTx,
  hashIdempotencyKey,
  insertIdempotencyRecordTx,
  isValidIdempotencyKey,
  lockIdempotencyKeyTx,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  SCOPE_PUBLIC_FEEDBACK,
} from "@/lib/public-api-idempotency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Feedback ist reines JSON ohne Uploads — 32 KiB reichen für 10.000 Zeichen
// Text (auch mehrbyteig) samt Feldern deutlich aus.
const MAX_BODY_BYTES = 32 * 1024;

/** Was `preflightTx` als Abbruchgrund zurückgeben kann. */
type Preflight = { kind: "replay"; cardId: number } | { kind: "conflict" };

/**
 * Öffentliche Feedback-Einreichung für native Android-/iOS-Clients.
 *
 * Ohne Authentifizierung, ohne CORS-Header. Die Fachlogik teilt sich diese Route
 * mit dem Browserformular (`lib/public-feedback-submission.ts`). Zusätzlich hier:
 * verpflichtende Idempotenz und eigene Rate-Limits.
 */
export async function POST(req: Request) {
  // --- Rate-Limits (eigene Buckets, getrennt von Anträgen und Formular) ----
  const limited = await enforceRateLimits([RL_FEEDBACK_BURST, RL_FEEDBACK_DAY]);
  if (limited) return limited;

  // --- Transport prüfen ---------------------------------------------------
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().split(";")[0].trim().endsWith("/json")) {
    return publicApiError(415, "Content-Type muss application/json sein.");
  }
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return publicApiError(413, "Die Anfrage ist zu groß.");
  }

  // --- Idempotency-Key ----------------------------------------------------
  const rawKey = req.headers.get("idempotency-key");
  if (!isValidIdempotencyKey(rawKey)) {
    return publicApiError(
      400,
      `Header 'Idempotency-Key' fehlt oder ist ungültig (druckbares ASCII, 16–${MAX_IDEMPOTENCY_KEY_LENGTH} Zeichen; empfohlen: UUID v4).`,
    );
  }
  const keyHash = hashIdempotencyKey(rawKey);

  // --- Body lesen ---------------------------------------------------------
  // Auch ohne (oder mit gelogener) Content-Length hart begrenzen.
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return publicApiError(400, "Der Request-Body konnte nicht gelesen werden.");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return publicApiError(413, "Die Anfrage ist zu groß.");
  }

  let body: { areaId?: unknown; submitterName?: unknown; feedback?: unknown };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return publicApiError(400, "Der JSON-Body muss ein Objekt sein.");
    }
    body = parsed as typeof body;
  } catch {
    return publicApiError(400, "Der JSON-Body ist ungültig.");
  }

  const fields = {
    areaId: body.areaId,
    submitterName: body.submitterName,
    feedback: body.feedback,
  };
  // Aus den normalisierten Feldern — unabhängig von Property-Reihenfolge und
  // Formatierung des JSON.
  const requestHash = computeFeedbackFingerprint(fields);

  const result = await submitPublicFeedback<Preflight>(fields, {
    activityDetail: "Feedback über die öffentliche API eingereicht",
    // Läuft als Erstes in der Transaktion — vor jedem Schreibzugriff.
    preflightTx: async (tx) => {
      // Serialisiert parallele Requests mit demselben Key: der zweite wartet
      // hier, sieht anschließend den Datensatz des ersten und antwortet als
      // Replay. So kann nie eine zweite Karte entstehen.
      await lockIdempotencyKeyTx(tx, SCOPE_PUBLIC_FEEDBACK, keyHash);
      const hit = await findIdempotencyRecordTx(
        tx,
        SCOPE_PUBLIC_FEEDBACK,
        keyHash,
        requestHash,
      );
      if (!hit) return null; // neuer Key → normal anlegen
      return hit.conflict
        ? { kind: "conflict" }
        : { kind: "replay", cardId: hit.cardId };
    },
    // Läuft am Ende derselben Transaktion: Karte, Snapshot und Idempotenz-
    // Datensatz sind damit immer gemeinsam da oder gemeinsam weg.
    withinTx: async (tx, ctx) => {
      await insertIdempotencyRecordTx(
        tx,
        SCOPE_PUBLIC_FEEDBACK,
        keyHash,
        requestHash,
        ctx.cardId,
      );
    },
  });

  // --- Idempotenz-Ausgänge ------------------------------------------------
  if (!result.ok && result.reason === "aborted") {
    if (result.value.kind === "conflict") {
      return publicApiError(
        409,
        "Der Idempotency-Key wurde bereits für eine andere Einreichung verwendet.",
      );
    }
    // Replay: nichts wurde erneut geschrieben — keine Karte, kein Snapshot,
    // keine Aktivität, keine Nummer. Dieselbe Antwort wie beim Original.
    const [card] = await db
      .select({ token: cards.token, number: cards.number })
      .from(cards)
      .where(eq(cards.id, result.value.cardId))
      .limit(1);
    if (!card?.token) {
      return publicApiError(
        500,
        "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.",
      );
    }
    return NextResponse.json(
      { ...publicFeedbackLinks(card.token), number: card.number },
      {
        status: 200,
        headers: {
          "Idempotency-Replayed": "true",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  // --- Fachliche Fehler ---------------------------------------------------
  if (!result.ok) {
    switch (result.reason) {
      case "area":
        return publicApiError(404, result.message, { issues: result.issues });
      case "validation":
        return publicApiError(400, result.message, { issues: result.issues });
      default:
        // Generisch — keine Stacktraces, SQL-Fehler oder internen Details.
        return publicApiError(
          500,
          "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.",
        );
    }
  }

  // --- Erfolg -------------------------------------------------------------
  // Bewusst NUR die öffentlichen Links und die Nummer: keine Karten-ID, kein
  // Board, keine Spalte, keine internen Notizen.
  return NextResponse.json(
    { ...publicFeedbackLinks(result.token), number: result.number },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
