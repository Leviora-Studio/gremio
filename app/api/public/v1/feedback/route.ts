// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import {
  enforceRateLimits,
  publicApiError,
  publicFeedbackLinks,
  readLimitedBody,
  RL_FEEDBACK_BURST,
  RL_FEEDBACK_DAY,
  withPublicApi500,
} from "@/lib/public-api";
import { submitPublicFeedback } from "@/lib/public-feedback-submission";
import {
  computeFeedbackFingerprint,
  findIdempotencyRecordTx,
  hashIdempotencyKey,
  idempotencyClientHash,
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
export const POST = withPublicApi500(async function POST(req: Request) {
  // --- Rate-Limits (eigene Buckets, getrennt von Anträgen und Formular) ----
  const limited = await enforceRateLimits([RL_FEEDBACK_BURST, RL_FEEDBACK_DAY]);
  if (limited) return limited;

  // --- Transport prüfen ---------------------------------------------------
  const contentType = req.headers.get("content-type") ?? "";
  // `startsWith("application/json")` statt `endsWith("/json")`: Letzteres nahm
  // auch `text/json` oder frei erfundene Typen an. Der Suffix `+json`
  // (application/problem+json o. ä.) ist hier ebenfalls nicht vorgesehen.
  if (
    !contentType.toLowerCase().split(";")[0].trim().startsWith("application/json")
  ) {
    return publicApiError(415, "Content-Type muss application/json sein.");
  }
  // Angekündigte Länge nur als Abkürzung — verbindlich ist die Grenze beim
  // Lesen (`readLimitedBody`). Bei `chunked`/HTTP-2 fehlt der Header oft, und
  // `Number(null)` ist 0: Die Prüfung lief dann folgenlos durch.
  const declaredRaw = req.headers.get("content-length");
  if (declaredRaw != null) {
    const declared = Number(declaredRaw);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return publicApiError(413, "Die Anfrage ist zu groß.");
    }
  }

  // --- Idempotency-Key ----------------------------------------------------
  const rawKey = req.headers.get("idempotency-key");
  if (!isValidIdempotencyKey(rawKey)) {
    return publicApiError(
      400,
      `Header 'Idempotency-Key' fehlt oder ist ungültig (druckbares ASCII ohne Leerzeichen, 16–${MAX_IDEMPOTENCY_KEY_LENGTH} Zeichen; empfohlen: UUID v4).`,
    );
  }
  const keyHash = hashIdempotencyKey(rawKey);
  // Pseudonyme Client-Kennung EINMAL vor der Transaktion bestimmen (liest
  // Request-Header). Sie bindet den Schlüssel an den Einreicher: Ein Replay
  // gibt den geheimen Status-Link zurück und darf deshalb nur an denselben
  // Client gehen.
  const clientHash = await idempotencyClientHash();

  // --- Body lesen ---------------------------------------------------------
  // Beim Lesen begrenzen statt erst danach zu messen: `req.text()` puffert
  // sonst den gesamten Body, egal wie groß er ist.
  const rawBody = await readLimitedBody(req, MAX_BODY_BYTES);
  if (!rawBody.ok) {
    return rawBody.reason === "too_large"
      ? publicApiError(413, "Die Anfrage ist zu groß.")
      : publicApiError(400, "Der Request-Body konnte nicht gelesen werden.");
  }

  let body: { areaId?: unknown; submitterName?: unknown; feedback?: unknown };
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(rawBody.body).toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return publicApiError(400, "Der JSON-Body muss ein Objekt sein.");
    }
    body = parsed as typeof body;
  } catch {
    return publicApiError(400, "Der JSON-Body ist ungültig.");
  }

  // Unbekannte Felder ablehnen — gleiche Tippfehler-Konvention wie POST /status:
  // Ein vertipptes `submiterName` erzeugte sonst still eine „Anonym"-Einreichung,
  // ohne dass der Client je erfährt, dass sein Feld ins Leere ging.
  const KNOWN_FIELDS = ["areaId", "submitterName", "feedback"];
  const unknown = Object.keys(body).filter((k) => !KNOWN_FIELDS.includes(k));
  if (unknown.length) {
    return publicApiError(400, `Unbekanntes Feld: ${unknown.join(", ")}.`);
  }

  // Typen der Felder ausdrücklich prüfen. JSON kann Zahlen, Objekte und Arrays
  // transportieren, die Bereinigung macht daraus stillschweigend einen leeren
  // String: `submitterName: 42` wurde zu „Anonym", `feedback: {}` zu einer
  // irreführenden „Bitte Feedback eingeben."-Meldung. Ein falsch typisiertes
  // Feld soll stattdessen genau das sagen.
  if (body.submitterName != null && typeof body.submitterName !== "string") {
    return publicApiError(400, "Feld 'submitterName' muss eine Zeichenkette sein.", {
      issues: [{ field: "submitterName", message: "Erwartet wird eine Zeichenkette." }],
    });
  }
  if (typeof body.feedback !== "string") {
    return publicApiError(400, "Feld 'feedback' muss eine Zeichenkette sein.", {
      issues: [{ field: "feedback", message: "Erwartet wird eine Zeichenkette." }],
    });
  }
  if (typeof body.areaId !== "number" && typeof body.areaId !== "string") {
    return publicApiError(400, "Feld 'areaId' muss eine Zahl sein.", {
      issues: [{ field: "areaId", message: "Erwartet wird eine Zahl." }],
    });
  }

  const fields = {
    areaId: body.areaId,
    submitterName: body.submitterName,
    feedback: body.feedback,
  };
  // Wird in preflightTx aus den GEPRÜFTEN Feldern berechnet und in withinTx
  // erneut gebraucht (gleiche Transaktion, gleicher Wert).
  let requestHash = "";

  const result = await submitPublicFeedback<Preflight>(fields, {
    activityDetail: "Feedback über die öffentliche API eingereicht",
    // Läuft als Erstes in der Transaktion — vor jedem Schreibzugriff.
    preflightTx: async (tx, validated) => {
      // Serialisiert parallele Requests mit demselben Key: der zweite wartet
      // hier, sieht anschließend den Datensatz des ersten und antwortet als
      // Replay. So kann nie eine zweite Karte entstehen.
      await lockIdempotencyKeyTx(tx, SCOPE_PUBLIC_FEEDBACK, keyHash);
      // Über die GEPRÜFTEN Felder — unabhängig von Property-Reihenfolge und
      // Formatierung des JSON, und identisch zu dem, was gespeichert wird.
      requestHash = computeFeedbackFingerprint(validated);
      const hit = await findIdempotencyRecordTx(
        tx,
        SCOPE_PUBLIC_FEEDBACK,
        keyHash,
        requestHash,
        clientHash,
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
        clientHash,
      );
    },
  });

  // --- Idempotenz-Ausgänge ------------------------------------------------
  if (!result.ok && result.reason === "aborted") {
    if (result.value.kind === "conflict") {
      // Bewusst EINE Meldung für „andere Daten" und „anderer Client" — die
      // Antwort verrät damit nicht, ob ein fremder Einreicher denselben
      // Schlüssel benutzt. Beides behebt derselbe Schritt: neuen Key erzeugen.
      return publicApiError(
        409,
        "Der Idempotency-Key wurde bereits für eine andere Einreichung oder von einem anderen Client verwendet.",
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
}, "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.");
