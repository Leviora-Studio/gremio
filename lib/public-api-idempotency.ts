// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clientIpHmac } from "@/lib/client-ip";
import { deriveKey } from "@/lib/crypto";
import { apiIdempotencyKeys } from "@/lib/db/schema";
import {
  APPLICATION_FILE_SLOTS,
  type PreparedUpload,
  type Tx,
  type ValidatedApplicationFields,
} from "@/lib/public-application-submission";
import type { ValidatedFeedbackFields } from "@/lib/public-feedback-submission";

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

// Zweckgebundener HMAC-Schlüssel für die Client-Bindung (nicht das rohe
// AUTH_SECRET und nicht derselbe Unterschlüssel wie Rate-Limit/Zeitfalle —
// ein Wert aus dem einen Zweck verrät so nichts über den anderen).
const IDEMPOTENCY_CLIENT_KEY = deriveKey("public-api-idempotency-client");

/**
 * Pseudonyme Kennung des einreichenden Clients (HMAC der Client-IP, nie die IP
 * selbst — DSGVO, siehe `lib/client-ip.ts`).
 *
 * ZWECK: Ein Replay gibt den geheimen Status-Link der ursprünglichen
 * Einreichung zurück. Ohne diese Bindung genügte ein erratener oder
 * abgefangener `Idempotency-Key` samt identischer Daten, um an den Vorgang
 * eines FREMDEN Einreichers zu kommen — beim Feedback besteht der Fingerprint
 * nur aus Bereich, Name und Text.
 *
 * GRENZE: Die Kennung ist eine IP, kein Gerät. Hinter demselben NAT (Hochschul-
 * netz, Carrier) teilen sich viele Clients eine Kennung; dort schützt die
 * Bindung nicht. Sie hebt die Hürde, sie beseitigt sie nicht — der eigentliche
 * Schutz bleibt ein zufälliger Schlüssel (UUID v4) auf Client-Seite.
 */
export async function idempotencyClientHash(): Promise<string> {
  return clientIpHmac(IDEMPOTENCY_CLIENT_KEY);
}

/**
 * Kanonischer Fingerprint des fachlichen Requests.
 *
 * Bewusst NICHT über den rohen Multipart-Body: Boundary, Feldreihenfolge und
 * Dateiname ändern sich bei einem Retry regelmäßig, ohne dass der Antrag ein
 * anderer wäre. Stattdessen über die GEPRÜFTEN Felder (`ValidatedApplicationFields`
 * — genau die Werte, die in der Karte landen) und den INHALT der Dateien: Ein
 * logisch identischer Retry ergibt denselben Hash, eine geänderte Datei oder ein
 * geänderter Titel einen anderen.
 *
 * Die eigene Normalisierung von früher (`String(v).trim()`) hätte die
 * Eingangsbereinigung aus `lib/text.ts` nachbauen müssen und wäre bei jeder
 * Änderung daran auseinandergelaufen: Zwei Requests, die dieselbe Karte
 * erzeugen, hätten verschiedene Fingerprints bekommen und der Retry eines
 * Clients wäre als 409 gelandet statt als Replay.
 *
 * Der SHA-256 der Dateien kommt fertig aus `PreparedUpload` (beim Einlesen
 * berechnet, vor der Transaktion). Der Dateiname bleibt bewusst außen vor.
 */
export function computeRequestFingerprint(
  fields: ValidatedApplicationFields,
  prepared: PreparedUpload[],
): string {
  const lines: string[] = [
    "v1",
    `locationId:${fields.locationId}`,
    `title:${fields.title}`,
    `applicant:${fields.applicant}`,
  ];
  // Feste Slot-Reihenfolge → die Multipart-Reihenfolge ist irrelevant.
  for (const slot of APPLICATION_FILE_SLOTS) {
    const up = prepared.find((p) => p.field === slot.field);
    lines.push(
      up
        ? `file:${slot.field}:1:${up.mime}:${up.sha256}`
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
 * Gebildet wird er über die GEPRÜFTEN Felder (`ValidatedFeedbackFields`) — also
 * über die Werte, die tatsächlich gespeichert werden, inklusive des
 * „Anonym"-Ersatzes. Ein Retry, der den Namen einmal weglässt und einmal
 * explizit „Anonym" schickt, ist damit logisch dieselbe Einreichung und wird
 * als Replay erkannt statt mit 409 abgewiesen.
 */
export function computeFeedbackFingerprint(
  fields: ValidatedFeedbackFields,
): string {
  const lines = [
    "v1",
    `areaId:${fields.areaId}`,
    `submitterName:${fields.submitterName}`,
    `feedback:${fields.feedback}`,
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
  /**
   * true = der Schlüssel gehört NICHT zu diesem Request. Zwei Gründe, bewusst
   * nicht unterschieden: abweichende Daten (klassischer Konflikt) ODER ein
   * anderer Client (siehe `idempotencyClientHash`). Beide führen zu 409 und zur
   * selben Meldung — ein Aufrufer soll aus der Antwort nicht ablesen können,
   * ob ein fremder Client denselben Schlüssel benutzt hat.
   */
  conflict: boolean;
};

/**
 * Gehört ein gefundener Datensatz NICHT zu diesem Request?
 *
 * Bewusst als eigene, DB-freie Funktion: Das ist die Sicherheitsregel hinter
 * dem Replay — ein Replay gibt den geheimen Status-Link heraus und darf deshalb
 * nur laufen, wenn Daten UND Client passen. Datensätze ohne `clientHash`
 * (Altbestand aus der Zeit vor der Client-Bindung) bleiben replay-fähig; sie
 * verfallen nach IDEMPOTENCY_TTL_DAYS von selbst.
 */
export function isIdempotencyConflict(
  row: { requestHash: string; clientHash: string | null },
  requestHash: string,
  clientHash: string,
): boolean {
  if (row.requestHash !== requestHash) return true;
  return row.clientHash != null && row.clientHash !== clientHash;
}

/**
 * Sucht einen vorhandenen Datensatz. Muss innerhalb der per
 * `lockIdempotencyKeyTx` gesperrten Transaktion laufen.
 */
export async function findIdempotencyRecordTx(
  tx: Tx,
  scope: string,
  keyHash: string,
  requestHash: string,
  clientHash: string,
): Promise<IdempotencyHit | null> {
  const [row] = await tx
    .select({
      cardId: apiIdempotencyKeys.cardId,
      requestHash: apiIdempotencyKeys.requestHash,
      clientHash: apiIdempotencyKeys.clientHash,
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
  return {
    cardId: row.cardId,
    conflict: isIdempotencyConflict(row, requestHash, clientHash),
  };
}

/** Legt den Datensatz an — immer in derselben Transaktion wie die Karte. */
export async function insertIdempotencyRecordTx(
  tx: Tx,
  scope: string,
  keyHash: string,
  requestHash: string,
  cardId: number,
  clientHash: string,
): Promise<void> {
  await tx
    .insert(apiIdempotencyKeys)
    .values({ scope, keyHash, requestHash, cardId, clientHash });
}

// ---------------------------------------------------------------------------
// Aufbewahrung
// ---------------------------------------------------------------------------

/**
 * Wie lange ein Idempotenz-Datensatz gilt.
 *
 * Ohne Ablauf wuchs die Tabelle unbegrenzt: Jede API-Einreichung legt eine Zeile
 * an, und gelöscht wurde nur, was am Kartenlöschen mithing (`ON DELETE CASCADE`)
 * — Karten bleiben aber dauerhaft bestehen. Nach einem Jahr Betrieb wäre die
 * Tabelle so groß wie die Kartentabelle, ohne dass ein einziger Eintrag davon
 * noch gebraucht würde.
 *
 * 30 Tage sind großzügig bemessen: Ein Retry eines nativen Clients kommt
 * innerhalb von Sekunden bis Minuten, im Offline-Fall innerhalb von Tagen. Nach
 * Ablauf verhält sich derselbe Key wie ein neuer — ein Retry NACH 30 Tagen legt
 * also einen zweiten Antrag an. Das ist in der API-Doku zugesichert.
 */
export const IDEMPOTENCY_TTL_DAYS = 30;

/**
 * Entfernt abgelaufene Idempotenz-Datensätze. Gibt die Anzahl zurück.
 *
 * Löscht NUR die Schlüsselzeilen, nie Karten: Die Fremdschlüsselrichtung zeigt
 * von hier auf `cards`, nicht umgekehrt.
 */
export async function pruneExpiredIdempotencyKeys(): Promise<number> {
  const rows = await db
    .delete(apiIdempotencyKeys)
    .where(
      sql`${apiIdempotencyKeys.createdAt} < now() - ${sql.raw(`interval '${IDEMPOTENCY_TTL_DAYS} days'`)}`,
    )
    .returning({ id: apiIdempotencyKeys.id });
  if (rows.length > 0) {
    console.log(
      `[idempotency] ${rows.length} abgelaufene Schlüssel entfernt (älter als ${IDEMPOTENCY_TTL_DAYS} Tage).`,
    );
  }
  return rows.length;
}

// --- Scheduler (eine Instanz je Prozess) -----------------------------------
const g = globalThis as unknown as { __idempotencySweeperStarted?: boolean };

/**
 * Startet das tägliche Aufräumen (idempotent). Läuft einmal beim Start und
 * danach alle 24 Stunden — der Datensatz ist unkritisch, ein exakter Zeitpunkt
 * spielt keine Rolle.
 */
export function startIdempotencySweeper(): void {
  if (g.__idempotencySweeperStarted) return;
  g.__idempotencySweeperStarted = true;
  const tick = () => {
    pruneExpiredIdempotencyKeys().catch((e) =>
      console.error("[idempotency] Aufräumen fehlgeschlagen:", e),
    );
  };
  tick();
  const timer = setInterval(tick, 24 * 60 * 60 * 1000);
  timer.unref?.();
}
