// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { apiIdempotencyKeys } from "@/lib/db/schema";
import {
  APPLICATION_FILE_SLOTS,
  type PreparedUpload,
  type Tx,
} from "@/lib/public-application-submission";
import {
  normalizeFeedbackText,
  normalizeSubmitterName,
} from "@/lib/feedback-constants";

/**
 * Idempotenz für öffentliche API-Schreibzugriffe.
 *
 * Native Clients wiederholen Requests bei Timeouts — ohne Idempotenz entstünde
 * pro Retry ein weiterer Antrag. Der Client schickt je Vorgang einen
 * `Idempotency-Key`; gespeichert wird nur dessen SHA-256-Hash zusammen mit einem
 * kanonischen Fingerprint des Requests.
 */

/** Scopes der Endpunkte (die Tabelle ist für weitere Endpunkte offen). */
export const SCOPE_PUBLIC_APPLICATION = "public-application";
export const SCOPE_PUBLIC_FEEDBACK = "public-feedback";

// Advisory-Lock-Namespace ("AI" = API Idempotency). Serialisiert Lookup und
// Anlage je (scope, key) — zwei parallele Requests mit demselben Key können so
// niemals zwei Karten erzeugen.
const IDEMPOTENCY_LOCK_NS = 0x4149;

/** Obergrenze wie in der Doku zugesichert (UUID braucht 36). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MIN_IDEMPOTENCY_KEY_LENGTH = 16;

/**
 * Akzeptiert einen ausreichend langen, begrenzten, druckbaren Schlüssel
 * (empfohlen: UUID v4). Bewusst nicht auf UUID beschränkt, damit Clients auch
 * andere kollisionsfreie Verfahren nutzen können — aber lang genug, dass er
 * nicht versehentlich kollidiert.
 */
export function isValidIdempotencyKey(raw: string | null): raw is string {
  if (!raw) return false;
  const key = raw.trim();
  if (
    key.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    key.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return false;
  }
  // Nur druckbares ASCII ohne Steuerzeichen.
  return /^[\x21-\x7E]+$/.test(key);
}

const sha256 = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");

/** Der Klartext-Key wird NIE gespeichert — nur dieser Hash. */
export function hashIdempotencyKey(key: string): string {
  return sha256(key.trim());
}

/**
 * Kanonischer Fingerprint des fachlichen Requests.
 *
 * Bewusst NICHT über den rohen Multipart-Body: Boundary, Feldreihenfolge und
 * Dateiname ändern sich bei einem Retry regelmäßig, ohne dass der Antrag ein
 * anderer wäre. Stattdessen über die normalisierten Felder und den INHALT der
 * Dateien — ein logisch identischer Retry ergibt denselben Hash, eine geänderte
 * Datei oder ein geänderter Titel einen anderen.
 *
 * Enthalten sind: normalisierte locationId/title/applicant, für jeden der vier
 * Slots das Vorhandensein und — falls vorhanden — der serverseitig ermittelte
 * MIME-Typ plus SHA-256 des Dateiinhalts. Der Dateiname bleibt bewusst außen vor.
 */
export function computeRequestFingerprint(
  fields: { locationId: unknown; title: unknown; applicant: unknown },
  prepared: PreparedUpload[],
): string {
  const norm = (v: unknown) => String(v ?? "").trim();
  const locationId = Number.parseInt(norm(fields.locationId), 10);
  const lines: string[] = [
    "v1",
    `locationId:${Number.isFinite(locationId) ? locationId : ""}`,
    `title:${norm(fields.title)}`,
    `applicant:${norm(fields.applicant)}`,
  ];
  // Feste Slot-Reihenfolge → die Multipart-Reihenfolge ist irrelevant.
  for (const slot of APPLICATION_FILE_SLOTS) {
    const up = prepared.find((p) => p.field === slot.field);
    lines.push(
      up
        ? `file:${slot.field}:1:${up.mime}:${sha256(up.bytes)}`
        : `file:${slot.field}:0`,
    );
  }
  return sha256(lines.join("\n"));
}

/**
 * Kanonischer Fingerprint einer FEEDBACK-Einreichung.
 *
 * Bewusst NICHT über den rohen JSON-Body: Property-Reihenfolge, Einrückung und
 * Escaping unterscheiden sich zwischen Clients und Retries, ohne dass das
 * Feedback ein anderes wäre.
 *
 * Der Text wird exakt so normalisiert wie beim Speichern (`\r\n`/`\r` → `\n`,
 * außen trimmen) — INNERE Umbrüche und Leerzeichen bleiben erhalten, denn sie
 * sind Inhalt: Ein geänderter Absatz ist ein anderes Feedback und muss zu 409
 * führen.
 *
 * Der Name läuft durch dieselbe Normalisierung wie beim Speichern, inklusive
 * des „Anonym"-Ersatzes. Ein Retry, der den Namen einmal weglässt und einmal
 * explizit „Anonym" schickt, ist damit logisch dieselbe Einreichung und wird
 * als Replay erkannt statt mit 409 abgewiesen.
 */
export function computeFeedbackFingerprint(fields: {
  areaId: unknown;
  submitterName: unknown;
  feedback: unknown;
}): string {
  const areaId = Number.parseInt(String(fields.areaId ?? "").trim(), 10);
  const lines = [
    "v1",
    `areaId:${Number.isFinite(areaId) ? areaId : ""}`,
    `submitterName:${normalizeSubmitterName(fields.submitterName)}`,
    `feedback:${normalizeFeedbackText(fields.feedback)}`,
  ];
  return sha256(lines.join("\n"));
}

/**
 * Serialisiert alles Weitere für dieses (scope, key) innerhalb der Transaktion.
 * Der Lock fällt automatisch mit Commit/Rollback — nach einem vollständig
 * zurückgerollten Request ist derselbe Key also sofort wieder verwendbar.
 */
export async function lockIdempotencyKeyTx(
  tx: Tx,
  scope: string,
  keyHash: string,
): Promise<void> {
  // Deterministischer int32 aus scope+keyHash (pg_advisory_xact_lock nimmt ints).
  const lockId = createHash("sha256")
    .update(`${scope}:${keyHash}`)
    .digest()
    .readInt32BE(0);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${IDEMPOTENCY_LOCK_NS}, ${lockId})`,
  );
}

export type IdempotencyHit = {
  cardId: number;
  /** true = derselbe Key wurde bereits für einen ANDEREN Request verwendet. */
  conflict: boolean;
};

/**
 * Sucht einen vorhandenen Datensatz. Muss innerhalb der per
 * `lockIdempotencyKeyTx` gesperrten Transaktion laufen.
 */
export async function findIdempotencyRecordTx(
  tx: Tx,
  scope: string,
  keyHash: string,
  requestHash: string,
): Promise<IdempotencyHit | null> {
  const [row] = await tx
    .select({
      cardId: apiIdempotencyKeys.cardId,
      requestHash: apiIdempotencyKeys.requestHash,
    })
    .from(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.scope, scope),
        eq(apiIdempotencyKeys.keyHash, keyHash),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { cardId: row.cardId, conflict: row.requestHash !== requestHash };
}

/** Legt den Datensatz an — immer in derselben Transaktion wie die Karte. */
export async function insertIdempotencyRecordTx(
  tx: Tx,
  scope: string,
  keyHash: string,
  requestHash: string,
  cardId: number,
): Promise<void> {
  await tx
    .insert(apiIdempotencyKeys)
    .values({ scope, keyHash, requestHash, cardId });
}
