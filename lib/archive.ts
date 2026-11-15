// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { retryCashbookArchives } from "@/lib/cashbook/archive";
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { db, pool, schema } from "@/lib/db";
import {
  nextcloudArchiveJobs,
  cardActivity,
  attachments,
  attachmentFolders,
  boardArchive,
  boards,
  boardStatuses,
  cards,
  type Card,
} from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { uploadAntragArchive } from "@/lib/nextcloud";
import { loadBudgetPositions } from "@/lib/card-budget-db";
import { budgetTitles } from "@/lib/card-budget";
import { isBoardTriggerAvailable } from "@/lib/board-trigger-policy";
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
 * Ist der bestätigte öffentliche Kartenstatus eine Archiv-Trigger-Spalte und
 * die Nextcloud-Archivierung des Boards aktiv, werden alle aktuellen Anhänge
 * hochgeladen. Sperrspalten warten auf die Sperre. Nur einmal pro Karte.
 *
 * Pro Karte serialisiert über ein nicht-blockierendes Postgres-Advisory-Lock:
 * verhindert, dass zwei zeitgleiche Auslöser (z.B. Statuswechsel + Retry-Tick)
 * den `nextcloudLink`-Guard beide passieren und doppelt hochladen (TOCTOU).
 * Läuft bereits eine Archivierung, bleibt der dauerhafte Auftrag für den Worker bestehen.
 */
export async function maybeArchive(cardId: number): Promise<void> {
  if (!Number.isSafeInteger(cardId) || cardId < 1 || cardId > 2147483647) return;
  // Save before trying the nonblocking delivery lock. A skipped call must leave
  // work behind; card/status database triggers already cover the commit gap.
  await db.execute(sql`select queue_nextcloud_archive(${cardId})`);
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
      await archiveLocked(cardId, drizzle(client, { schema }));
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

/** Cancel only after a fresh check under the card lock. A concurrent move
 * back into a trigger queues a new job after this transaction instead of losing it. */
type ArchiveDb = typeof db;
async function discardInapplicableArchive(cardId: number, connection: ArchiveDb): Promise<void> {
  await connection.transaction(async tx => {
    const [card] = await tx.select().from(cards).where(trashAnd(activeRows.cards, eq(cards.id, cardId))).for("update");
    if (!card) return;
    const result = await tx.execute<{ eligible: boolean }>(sql`select nextcloud_archive_eligible(${cardId}) as eligible`);
    if (result.rows[0]?.eligible) return;
    await tx.delete(nextcloudArchiveJobs).where(eq(nextcloudArchiveJobs.cardId, cardId));
    if (card.archivePending) await tx.update(cards).set({ archivePending: false, archiveFirstFailedAt: null, archiveLastAttemptAt: null, archiveLastError: null }).where(eq(cards.id, cardId));
  });
}

/** Eigentliche Archivierungslogik — läuft unter dem Advisory-Lock der Karte. */
async function archiveLocked(cardId: number, connection: ArchiveDb): Promise<void> {
  const [card] = await connection
    .select()
    .from(cards)
    .where(trashAnd(activeRows.cards, eq(cards.id, cardId)))
    .limit(1);
  if (!card) return; // missing/deleted boards stay paused; hard deletion cascades jobs
  if (card.nextcloudLink) { await discardInapplicableArchive(cardId, connection); return; }

  const clearPending = () => discardInapplicableArchive(cardId, connection);

  const [board] = await connection.select().from(boards).where(trashAnd(activeRows.boards, eq(boards.id, card.boardId))).limit(1);
  if (!board || !isBoardTriggerAvailable(board, "archive")) {
    await clearPending();
    return;
  }

  // A move awaiting an irreversible lock has not published its target status.
  // Never archive it (including retries) before that confirmation commits.
  if (card.publicStatusId == null || card.publicStatusId !== card.statusId) {
    await clearPending();
    return;
  }

  const [archive] = await connection
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

  const [status] = await connection
    .select()
    .from(boardStatuses)
    .where(trashAnd(activeRows.boardStatuses, and(eq(boardStatuses.id, card.publicStatusId), eq(boardStatuses.boardId, board.id))))
    .limit(1);
  if (!status || !status.isArchiveTrigger || (board.isApplicationBoard && status.isLockColumn && !card.lockedAt)) {
    await clearPending();
    return;
  }

  const files = await connection
    .select()
    .from(attachments)
    .where(trashAnd(activeRows.attachments, eq(attachments.cardId, cardId)));

  const folders = await connection.select().from(attachmentFolders).where(trashAnd(activeRows.attachmentFolders, eq(attachmentFolders.cardId, cardId)));

  const now = new Date();
  const [attempt] = await connection.update(nextcloudArchiveJobs).set({
    attempts: sql`${nextcloudArchiveJobs.attempts} + 1`, lastAttemptAt: now,
  }).where(eq(nextcloudArchiveJobs.cardId, cardId)).returning({ cardId: nextcloudArchiveJobs.cardId });
  if (!attempt) return;
  try {
    const password = decryptSecret(archive.ncPasswordEnc);
    // Ordnername aus der Board-Konfiguration (Felder + Trennzeichen);
    // sanitizeSegment in uploadAntragArchive säubert ihn final.
    const subfolder = buildArchiveFolderName(
      card.budgetMode === "positions" ? { ...card, budgetTitle: budgetTitles(await loadBudgetPositions(card.id, connection)) } : card,
      archive.folderFields,
      archive.folderSeparator,
    );
    const folder = await uploadAntragArchive({
      creds: { url: archive.ncUrl, username: archive.ncUsername, password },
      targetFolder: archive.targetFolder,
      subfolder,
      folders,
      files: files.map((f) => ({ id: f.id, relPath: f.path, filename: f.filename, folderId: f.folderId })),
    });
    // Commit success, visible history and acknowledgement together. A crash
    // after remote PUT but before this commit leaves the job retryable.
    await connection.transaction(async tx => {
      const [saved] = await tx.update(cards).set({
        nextcloudLink: folder, archivePending: false, archiveFirstFailedAt: null,
        archiveLastAttemptAt: now, archiveLastError: null,
      }).where(trashAnd(activeRows.cards, eq(cards.id, cardId))).returning({ id: cards.id });
      if (!saved) throw new Error("Card no longer available for archive acknowledgement");
      await tx.insert(cardActivity).values({ cardId, userId: null, type: "archive", detail: `Nach Nextcloud archiviert: ${folder}` });
      await tx.delete(nextcloudArchiveJobs).where(eq(nextcloudArchiveJobs.cardId, cardId));
    });
    console.log(`[archive] Karte #${cardId} nach Nextcloud archiviert: ${folder}`);
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
    await connection.transaction(async tx => {
      await tx.update(nextcloudArchiveJobs).set({ lastError: generic }).where(eq(nextcloudArchiveJobs.cardId, cardId));
      const [failed] = await tx.update(cards).set({
        archivePending: true, archiveFirstFailedAt: card.archiveFirstFailedAt ?? now,
        archiveLastAttemptAt: now, archiveLastError: generic,
      }).where(trashAnd(activeRows.cards, eq(cards.id, cardId))).returning({ id: cards.id });
      if (failed && firstFailure) await tx.insert(cardActivity).values({ cardId, userId: null, type: "archive_failed", detail: generic });
    });
  }
}

/**
 * Verarbeitet dauerhafte Archivaufträge und übernimmt alte Fehlermarkierungen,
 * einschließlich noch nie gestarteter Aufträge nach einem Abbruch. maybeArchive prüft selbst und
 * räumt Markierungen, wenn nicht mehr nötig. Läuft bis zum Erfolg — endlos im
 * Minuten-/10-Minuten-Takt (der Dashboard-Hinweis nach 24 h macht Dauerfehler
 * sichtbar).
 */
export async function retryPendingArchives(): Promise<number> {
  const pending = await db.select({ id: cards.id }).from(cards)
    .leftJoin(nextcloudArchiveJobs, eq(nextcloudArchiveJobs.cardId, cards.id))
    .where(trashAnd(activeRows.cards, or(isNotNull(nextcloudArchiveJobs.cardId), eq(cards.archivePending, true))))
    .orderBy(asc(nextcloudArchiveJobs.requestedAt), asc(cards.id));
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

/** Starts the durable archive worker after startup, then every ten minutes. */
export function startArchiveRetryScheduler(): void {
  if (g.__archiveRetryStarted) return;
  g.__archiveRetryStarted = true;
  const tick = () => {
    retryCashbookArchives().catch(error=>console.error("[cashbook-archive] Worker failed",error instanceof Error?error.name:"Error"));
    retryPendingArchives().catch((e) =>
      console.error("[archive-retry] Lauf fehlgeschlagen:", e),
    );
  };
  // Kurz nach Start einmal laufen (offene Fälle nach Neustart), dann alle 10 min.
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 10 * 60 * 1000);
}
