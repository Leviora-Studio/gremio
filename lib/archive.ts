// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  attachments,
  boardArchive,
  boardStatuses,
  cards,
  type Card,
} from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { uploadAntragArchive } from "@/lib/nextcloud";
import { logActivity } from "@/lib/activity";
import {
  DEFAULT_ARCHIVE_FOLDER_FIELDS,
  DEFAULT_ARCHIVE_FOLDER_SEPARATOR,
} from "@/lib/constants";

/** Wert eines Ordnername-Feldes einer Karte (leer = wird ausgelassen). */
function archiveFieldValue(card: Card, key: string): string {
  switch (key) {
    case "number":
      return card.number ?? "";
    case "title":
      return card.title ?? "";
    case "applicant":
      return card.applicant ?? "";
    case "budget_title":
      return card.budgetTitle ?? "";
    case "meeting":
      return card.meeting ?? "";
    case "instruction_date":
      return card.instructionDate ?? "";
    case "deadline":
      return card.deadline ?? "";
    case "id":
      return String(card.id);
    default:
      return "";
  }
}

/** Baut den Ordnernamen aus den konfigurierten Feldern + Trennzeichen. */
export function buildArchiveFolderName(
  card: Card,
  folderFields: string | null,
  separator: string | null,
): string {
  const keys = (folderFields || DEFAULT_ARCHIVE_FOLDER_FIELDS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // null/leer → Leerzeichen.
  const sep =
    separator == null || separator === ""
      ? DEFAULT_ARCHIVE_FOLDER_SEPARATOR
      : separator;
  const parts = keys
    .map((k) => archiveFieldValue(card, k).trim())
    .filter((s) => s !== "");
  return parts.length ? parts.join(sep) : card.title || String(card.id);
}

// Advisory-Lock-Namespace (beliebige Konstante) für die Karten-Archivierung.
// pg_try_advisory_lock(ns, cardId) serialisiert je Karte über Sessions hinweg.
const ARCHIVE_LOCK_NS = 0x5747; // "GW"

/**
 * Einzige automatische Aktion der App: Erreicht eine Karte die Archiv-Trigger-
 * Spalte eines Boards mit aktivierter Nextcloud-Archivierung, werden alle
 * aktuellen Anhänge hochgeladen. Idempotent (nur einmal pro Karte).
 *
 * Pro Karte serialisiert über ein nicht-blockierendes Postgres-Advisory-Lock:
 * verhindert, dass zwei zeitgleiche Auslöser (z.B. Statuswechsel + Retry-Tick)
 * den `nextcloudLink`-Guard beide passieren und doppelt hochladen (TOCTOU).
 * Läuft bereits eine Archivierung für die Karte, kehren wir sofort zurück.
 */
export async function maybeArchive(cardId: number): Promise<void> {
  if (!Number.isInteger(cardId)) return;
  // Lock auf einer fest ausgecheckten Verbindung halten (session-scoped), damit
  // Erwerb und Freigabe garantiert auf demselben pg-Client laufen.
  const client = await pool.connect();
  try {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [ARCHIVE_LOCK_NS, cardId],
    );
    if (!res.rows[0]?.locked) return; // andere Archivierung dieser Karte läuft bereits
    try {
      await archiveLocked(cardId);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        ARCHIVE_LOCK_NS,
        cardId,
      ]);
    }
  } finally {
    client.release();
  }
}

/** Eigentliche Archivierungslogik — läuft unter dem Advisory-Lock der Karte. */
async function archiveLocked(cardId: number): Promise<void> {
  const [card] = await db
    .select()
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card || card.nextcloudLink) return; // nicht gefunden oder bereits archiviert

  // Eine offene Retry-Markierung räumen, sobald die Archivierung nicht (mehr)
  // anwendbar ist (Archiv aus/entfernt, oder Karte hat die Trigger-Spalte
  // verlassen) — sonst würde sie ewig erneut versucht / auf dem Dashboard hängen.
  const clearPending = async () => {
    if (card.archivePending) {
      await db
        .update(cards)
        .set({
          archivePending: false,
          archiveFirstFailedAt: null,
          archiveLastAttemptAt: null,
          archiveLastError: null,
        })
        .where(eq(cards.id, cardId));
    }
  };

  const [archive] = await db
    .select()
    .from(boardArchive)
    .where(eq(boardArchive.boardId, card.boardId))
    .limit(1);
  if (
    !archive ||
    !archive.enabled ||
    !archive.ncUrl ||
    !archive.ncUsername ||
    !archive.ncPasswordEnc ||
    !archive.targetFolder
  ) {
    await clearPending();
    return;
  }

  const [status] = await db
    .select()
    .from(boardStatuses)
    .where(eq(boardStatuses.id, card.statusId))
    .limit(1);
  if (!status || !status.isArchiveTrigger) {
    await clearPending();
    return;
  }

  const files = await db
    .select()
    .from(attachments)
    .where(eq(attachments.cardId, cardId));

  const now = new Date();
  try {
    const password = decryptSecret(archive.ncPasswordEnc);
    // Ordnername aus der Board-Konfiguration (Felder + Trennzeichen);
    // sanitizeSegment in uploadAntragArchive säubert ihn final.
    const subfolder = buildArchiveFolderName(
      card,
      archive.folderFields,
      archive.folderSeparator,
    );
    const folder = await uploadAntragArchive({
      creds: { url: archive.ncUrl, username: archive.ncUsername, password },
      targetFolder: archive.targetFolder,
      subfolder,
      files: files.map((f) => ({ relPath: f.path, filename: f.filename })),
    });
    await db
      .update(cards)
      .set({
        nextcloudLink: folder,
        archivePending: false,
        archiveFirstFailedAt: null,
        archiveLastAttemptAt: now,
        archiveLastError: null,
      })
      .where(eq(cards.id, cardId));
    console.log(`[archive] Karte #${cardId} nach Nextcloud archiviert: ${folder}`);
    // Sichtbarer Beleg an der Karte (die Archivierung ist sonst unsichtbar).
    await logActivity(cardId, null, "archive", `Nach Nextcloud archiviert: ${folder}`);
  } catch (e) {
    // Erster Fehlschlag (vorher nicht „pending")? → Aktivitäts-Zeile schreiben.
    // Bei Folge-Retrys nur Zeitstempel aktualisieren (kein Feed-Spam).
    const firstFailure = !card.archivePending;
    // Rohen WebDAV-/Nextcloud-Fehler NUR ins Server-Log (kann interne URLs/
    // Pfade/Servicedetails enthalten). In DB/UI nur eine generische Meldung;
    // Manager bekommen Details über „Verbindung testen" in den Board-Einstellungen.
    console.error(`[archive] Karte #${cardId} fehlgeschlagen:`, e);
    const generic =
      "Nextcloud-Archivierung fehlgeschlagen (wird automatisch erneut versucht) — bitte Verbindung und Zugangsdaten prüfen.";
    await db
      .update(cards)
      .set({
        archivePending: true,
        archiveFirstFailedAt: card.archiveFirstFailedAt ?? now,
        archiveLastAttemptAt: now,
        archiveLastError: generic,
      })
      .where(eq(cards.id, cardId));
    if (firstFailure) {
      await logActivity(cardId, null, "archive_failed", generic).catch(() => {});
    }
  }
}

/**
 * Versucht alle ausstehenden Archivierungen erneut (Karten in der Trigger-Spalte,
 * deren Upload bisher fehlschlug). maybeArchive prüft Anwendbarkeit selbst und
 * räumt Markierungen, wenn nicht mehr nötig. Läuft bis zum Erfolg — endlos im
 * Minuten-/10-Minuten-Takt (der Dashboard-Hinweis nach 24 h macht Dauerfehler
 * sichtbar).
 */
export async function retryPendingArchives(): Promise<number> {
  const pending = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.archivePending, true), isNull(cards.nextcloudLink)));
  for (const c of pending) {
    await maybeArchive(c.id).catch((e) =>
      console.error(`[archive-retry] Karte #${c.id}:`, e),
    );
  }
  if (pending.length > 0) {
    console.log(
      `[archive-retry] ${pending.length} ausstehende Archivierung(en) erneut versucht.`,
    );
  }
  return pending.length;
}

// --- Retry-Scheduler (eine Instanz je Prozess) -----------------------------
const g = globalThis as unknown as { __archiveRetryStarted?: boolean };

/** Startet den Retry-Scheduler für fehlgeschlagene Nextcloud-Archivierungen. */
export function startArchiveRetryScheduler(): void {
  if (g.__archiveRetryStarted) return;
  g.__archiveRetryStarted = true;
  const tick = () => {
    retryPendingArchives().catch((e) =>
      console.error("[archive-retry] Lauf fehlgeschlagen:", e),
    );
  };
  // Kurz nach Start einmal laufen (offene Fälle nach Neustart), dann alle 10 min.
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 10 * 60 * 1000);
}
