// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import {
  enforceRateLimits,
  publicApiError,
  publicApplicationLinks,
  readLimitedBody,
  RL_SUBMIT_BURST,
  RL_SUBMIT_DAY,
  withPublicApi500,
} from "@/lib/public-api";
import { submitPublicApplication } from "@/lib/public-application-submission";
import {
  computeRequestFingerprint,
  findIdempotencyRecordTx,
  hashIdempotencyKey,
  insertIdempotencyRecordTx,
  isValidIdempotencyKey,
  lockIdempotencyKeyTx,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  SCOPE_PUBLIC_APPLICATION,
} from "@/lib/public-api-idempotency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Grobe Obergrenze für den GESAMTEN Request: 4 Slots à MAX_UPLOAD_BYTES plus
// Multipart-Overhead. Schützt davor, einen absurd großen Body überhaupt erst
// zu parsen. Die verbindliche Grenze pro Datei prüft der gemeinsame Service.
const MAX_REQUEST_BYTES = 4 * MAX_UPLOAD_BYTES + 1024 * 1024;

/** Was `preflightTx` als Abbruchgrund zurückgeben kann. */
type Preflight =
  | { kind: "replay"; cardId: number }
  | { kind: "conflict" };

/**
 * Öffentliche Antragseinreichung für native Android-/iOS-Clients.
 *
 * Ohne Authentifizierung, ohne CORS-Header (native Clients brauchen keine).
 * Die Fachlogik teilt sich diese Route mit dem Browserformular
 * (`lib/public-application-submission.ts`) — beide können nicht auseinander-
 * laufen. Zusätzlich hier: verpflichtende Idempotenz und eigene Rate-Limits.
 */
export const POST = withPublicApi500(async function POST(req: Request) {
  // --- Rate-Limits (eigene Buckets, unabhängig vom Formular) ---------------
  const limited = await enforceRateLimits([RL_SUBMIT_BURST, RL_SUBMIT_DAY]);
  if (limited) return limited;

  // --- Transport prüfen ---------------------------------------------------
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return publicApiError(
      415,
      "Content-Type muss multipart/form-data sein.",
    );
  }
  // Angekündigte Länge zuerst prüfen — das spart das Lesen offensichtlich zu
  // großer Anfragen. Verlassen darf man sich darauf NICHT: Bei
  // `Transfer-Encoding: chunked` fehlt der Header per Definition, bei HTTP/2
  // regelmäßig. `Number(null)` ist 0 und `Number.isFinite(0)` true — die
  // Prüfung lief dann folgenlos durch. Die verbindliche Grenze setzt deshalb
  // `readLimitedBody` beim tatsächlichen Lesen durch.
  const declaredRaw = req.headers.get("content-length");
  if (declaredRaw != null) {
    const declared = Number(declaredRaw);
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
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

  // --- Body lesen (mit harter Grenze) -------------------------------------
  // Erst vollständig unter Aufsicht lesen, dann parsen: `req.formData()` würde
  // den Body sonst ungebremst puffern.
  const raw = await readLimitedBody(req, MAX_REQUEST_BYTES);
  if (!raw.ok) {
    return raw.reason === "too_large"
      ? publicApiError(413, "Die Anfrage ist zu groß.")
      : publicApiError(400, "Der Request-Body konnte nicht gelesen werden.");
  }
  let form: FormData;
  try {
    form = await new Response(raw.body, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return publicApiError(400, "Der multipart/form-data-Body ist ungültig.");
  }

  const fields = {
    locationId: form.get("locationId"),
    title: form.get("title"),
    applicant: form.get("applicant"),
  };

  // Wird in preflightTx aus den bereits gelesenen Dateibytes berechnet und in
  // withinTx erneut gebraucht (gleiche Transaktion, gleicher Wert).
  let requestHash = "";

  const result = await submitPublicApplication<Preflight>(
    {
      ...fields,
      files: {
        finance_request: form.get("finance_request"),
        student_card: form.get("student_card"),
        annex_a: form.get("annex_a"),
        annex_b: form.get("annex_b"),
      },
    },
    {
      activityDetail: "Antrag über die öffentliche API eingereicht",
      // Läuft als Erstes in der Transaktion — vor jedem Schreibzugriff.
      preflightTx: async (tx, prepared, validated) => {
        // Serialisiert parallele Requests mit demselben Key: der zweite wartet
        // hier, sieht anschließend den Datensatz des ersten und antwortet als
        // Replay. So kann nie eine zweite Karte entstehen.
        await lockIdempotencyKeyTx(tx, SCOPE_PUBLIC_APPLICATION, keyHash);
        // Über die GEPRÜFTEN Felder, nicht über die Rohwerte aus dem Formular.
        requestHash = computeRequestFingerprint(validated, prepared);
        const hit = await findIdempotencyRecordTx(
          tx,
          SCOPE_PUBLIC_APPLICATION,
          keyHash,
          requestHash,
        );
        if (!hit) return null; // neuer Key → normal anlegen
        return hit.conflict
          ? { kind: "conflict" }
          : { kind: "replay", cardId: hit.cardId };
      },
      // Läuft am Ende derselben Transaktion: Karte und Idempotenz-Datensatz
      // sind damit immer gemeinsam da oder gemeinsam weg.
      withinTx: async (tx, ctx) => {
        await insertIdempotencyRecordTx(
          tx,
          SCOPE_PUBLIC_APPLICATION,
          keyHash,
          requestHash,
          ctx.cardId,
        );
      },
    },
  );

  // --- Idempotenz-Ausgänge ------------------------------------------------
  if (!result.ok && result.reason === "aborted") {
    if (result.value.kind === "conflict") {
      return publicApiError(
        409,
        "Der Idempotency-Key wurde bereits für eine andere Einreichung verwendet.",
      );
    }
    // Replay: nichts wurde erneut geschrieben — keine Karte, keine Datei,
    // keine Aktivität, keine Antragsnummer. Dieselbe Antwort wie beim Original.
    const [card] = await db
      .select({ token: cards.token, number: cards.number })
      .from(cards)
      .where(eq(cards.id, result.value.cardId))
      .limit(1);
    if (!card?.token) {
      // Karte zwischenzeitlich gelöscht (Cascade räumt den Schlüssel normal
      // mit ab) — generisch bleiben, nichts Internes preisgeben.
      return publicApiError(
        500,
        "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.",
      );
    }
    return NextResponse.json(
      { ...publicApplicationLinks(card.token), number: card.number },
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
      case "location":
        return publicApiError(404, result.message, { issues: result.issues });
      case "file_too_large":
        return publicApiError(413, result.message, { issues: result.issues });
      case "validation":
      case "file":
        return publicApiError(400, result.message, { issues: result.issues });
      default:
        // Generisch — keine Stacktraces, SQL-Fehler oder Pfade nach außen.
        return publicApiError(
          500,
          "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.",
        );
    }
  }

  // --- Erfolg -------------------------------------------------------------
  // Bewusst NUR die öffentlichen Links und die Antragsnummer: keine Karten-ID,
  // kein /intern/card/{id}, kein Board, keine Spalte, keine Dateipfade.
  return NextResponse.json(
    { ...publicApplicationLinks(result.token), number: result.number },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}, "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.");
