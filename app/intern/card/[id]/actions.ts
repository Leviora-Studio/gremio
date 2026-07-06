// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { and, eq, isNull, max } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cards,
  attachments,
  boardCardFields,
  boardStatuses,
  cardComments,
  accounts,
  priorities,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import {
  canAccessBoard,
  canManageBoard,
  getBoardById,
  getBoardMemberUsers,
} from "@/lib/authz";
import {
  AUSWEIS_MIME,
  CARD_FIELD_LABELS,
  PDF_MIME,
  type AttachmentKind,
} from "@/lib/constants";
import { deleteStoredFile, saveAntragFile, validateUpload } from "@/lib/attachments";
import { maybeArchive } from "@/lib/archive";
import {
  assigneeActivityDetail,
  deadlineActivityDetail,
  logActivity,
} from "@/lib/activity";
import { setCardAssignees } from "@/lib/assignees";
import { parseEuroToCents } from "@/lib/money";
import { maybeSetTriggerDates } from "@/lib/instruction";
import { doneSinceForStatus } from "@/lib/done-archive";
import { syncLoanFromCard } from "@/lib/inventory-loans";

export type State = { error?: string; success?: string };

async function loadCard(cardId: number) {
  const user = await requireUser();
  // Manipulierte RPC-Argumente (z. B. String statt Int) dürfen keinen
  // pg-Fehler/500 auslösen — wie ein nicht gefundener Datensatz behandeln.
  if (!Number.isInteger(cardId)) notFound();
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) notFound();
  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) notFound();
  return { user, board, card };
}

async function visibleFields(boardId: number): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(boardCardFields)
    .where(and(eq(boardCardFields.boardId, boardId), eq(boardCardFields.visible, true)));
  return new Set(rows.map((r) => r.fieldKey));
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/** Echtes Datum (nicht nur Format) — weist z. B. 2026-99-99 / 2026-13-01 ab. */
function isValidDate(s: string): boolean {
  if (!dateRe.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type CardValues = {
  title: string;
  applicant: string;
  budgetTitle: string | null;
  number: string | null;
  creatorUserId: number | null;
  assigneeUserIds: number[];
  deadline: string | null;
  meeting: string | null;
  decisionRef: string | null;
  instructionDate: string | null;
  transferDate: string | null;
  approvedAmount: string | null; // Euro-Eingabe (Rohstring)
  actualAmount: string | null; // Euro-Eingabe (Rohstring)
  priorityId: number | null;
  accountId: number | null;
  notes: string | null;
  applicantNote: string | null;
};

/** Auto-Speichern: nur sichtbare Felder werden übernommen (Titel immer). */
export async function saveCardAction(
  cardId: number,
  values: Partial<CardValues>,
): Promise<{ ok: boolean; error?: string }> {
  const { user, board, card } = await loadCard(cardId);
  const visible = await visibleFields(board.id);
  const update: Partial<typeof cards.$inferInsert> = { updatedAt: new Date() };

  if (typeof values.title === "string") {
    const t = values.title.trim();
    // Leeren Titel ignorieren — jede Karte muss einen Titel behalten.
    if (t) update.title = t.slice(0, 200);
  }
  if (visible.has("applicant") && typeof values.applicant === "string") {
    update.applicant = values.applicant.trim().slice(0, 200);
  }
  if (visible.has("budget_title") && "budgetTitle" in values) {
    const v = values.budgetTitle;
    // Auf 60 begrenzt wie der Plan-haushaltstitel — sonst könnte ein Karten-
    // Haushaltstitel > 60 Zeichen nie auf eine Planzeile matchen.
    update.budgetTitle = v ? String(v).slice(0, 60) : null;
  }
  // Antragsnummer ist nur durch Board-Verwalter editierbar; der Zähler bleibt
  // davon unberührt (er erhöht sich nur bei der automatischen Vergabe).
  if (
    visible.has("number") &&
    "number" in values &&
    canManageBoard(user, board)
  ) {
    const v = values.number;
    update.number = v && String(v).trim() ? String(v).trim().slice(0, 100) : null;
  }

  const members = await getBoardMemberUsers(board);
  const memberIds = new Set(members.map((m) => m.id));
  if (visible.has("creator") && "creatorUserId" in values) {
    const v = values.creatorUserId ?? null;
    update.creatorUserId = v && memberIds.has(v) ? v : null;
  }
  // Zuweisungen (mehrere) liegen in card_assignees, nicht in der cards-Spalte —
  // nach dem Karten-Update separat synchronisieren (s. unten).
  let targetAssignees: number[] | null = null;
  if (visible.has("assignee") && "assigneeUserIds" in values) {
    targetAssignees = Array.isArray(values.assigneeUserIds)
      ? [
          ...new Set(
            values.assigneeUserIds.filter(
              (n) => Number.isInteger(n) && memberIds.has(n),
            ),
          ),
        ]
      : [];
  }
  // Datums-/Betragsfelder: eine NICHT-leere, aber ungültige Eingabe wird NICHT
  // still zu null geschrieben (sonst löscht ein Tippfehler heimlich einen Wert
  // und meldet „Gespeichert"). Stattdessen Fehler zurückgeben — analog zum
  // Finanz-Plan-Editor.
  if (visible.has("deadline") && "deadline" in values) {
    if (values.deadline && !isValidDate(values.deadline))
      return { ok: false, error: "Deadline ist kein gültiges Datum (JJJJ-MM-TT)." };
    update.deadline = values.deadline || null;
  }
  if (visible.has("meeting") && "meeting" in values) {
    if (values.meeting && !isValidDate(values.meeting))
      return { ok: false, error: "Sitzungsdatum ist kein gültiges Datum (JJJJ-MM-TT)." };
    update.meeting = values.meeting || null;
  }
  if (visible.has("decision_ref") && "decisionRef" in values) {
    update.decisionRef = values.decisionRef
      ? String(values.decisionRef).slice(0, 200)
      : null;
  }
  // Anweisungsdatum ist — wie die Antragsnummer — verwalter-exklusiv
  // (Konsistenz mit REST-API und CLAUDE.md).
  if (
    visible.has("instruction_date") &&
    "instructionDate" in values &&
    canManageBoard(user, board)
  ) {
    if (values.instructionDate && !isValidDate(values.instructionDate))
      return {
        ok: false,
        error: "Anweisungsdatum ist kein gültiges Datum (JJJJ-MM-TT).",
      };
    update.instructionDate = values.instructionDate || null;
  }
  // Überweisungsdatum ist — wie das Anweisungsdatum — verwalter-exklusiv.
  if (
    visible.has("transfer_date") &&
    "transferDate" in values &&
    canManageBoard(user, board)
  ) {
    if (values.transferDate && !isValidDate(values.transferDate))
      return {
        ok: false,
        error: "Überweisungsdatum ist kein gültiges Datum (JJJJ-MM-TT).",
      };
    update.transferDate = values.transferDate || null;
  }
  if (visible.has("approved_amount") && "approvedAmount" in values) {
    const cents = values.approvedAmount
      ? parseEuroToCents(values.approvedAmount)
      : null;
    if (values.approvedAmount && cents === null)
      return {
        ok: false,
        error: "Genehmigter Betrag ist ungültig oder zu groß (max. 20.000.000,00 €).",
      };
    update.approvedAmount = cents;
  }
  if (visible.has("actual_amount") && "actualAmount" in values) {
    const cents = values.actualAmount
      ? parseEuroToCents(values.actualAmount)
      : null;
    if (values.actualAmount && cents === null)
      return {
        ok: false,
        error: "Tatsächliche Ausgaben sind ungültig oder zu groß (max. 20.000.000,00 €).",
      };
    update.actualAmount = cents;
  }
  if (visible.has("priority") && "priorityId" in values) {
    const v = values.priorityId ?? null;
    if (v && Number.isInteger(v)) {
      const [p] = await db
        .select({ id: priorities.id })
        .from(priorities)
        .where(eq(priorities.id, v))
        .limit(1);
      update.priorityId = p ? v : null;
    } else {
      update.priorityId = null;
    }
  }
  if (visible.has("account") && "accountId" in values) {
    const v = values.accountId ?? null;
    if (v && Number.isInteger(v)) {
      const [acc] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, v))
        .limit(1);
      update.accountId = acc ? v : null;
    } else {
      update.accountId = null;
    }
  }
  if (visible.has("notes") && "notes" in values) {
    update.notes = values.notes ? String(values.notes).slice(0, 20000) : null;
  }
  if (visible.has("applicant_note") && "applicantNote" in values) {
    update.applicantNote = values.applicantNote
      ? String(values.applicantNote).slice(0, 20000)
      : null;
  }

  await db.update(cards).set(update).where(eq(cards.id, card.id));

  if (targetAssignees) {
    const { added, removed } = await setCardAssignees(card.id, targetAssignees);
    const nameOf = (id: number) =>
      members.find((m) => m.id === id)?.username ?? "?";
    const detail = assigneeActivityDetail(added.map(nameOf), removed.map(nameOf));
    if (detail) await logActivity(card.id, user.id, "assignee", detail);
  }

  if ("deadline" in update && (update.deadline ?? null) !== (card.deadline ?? null)) {
    await logActivity(
      card.id,
      user.id,
      "deadline",
      deadlineActivityDetail(card.deadline, update.deadline ?? null),
    );
  }

  revalidatePath(`/intern/card/${card.id}`);
  revalidatePath(`/intern/board/${board.id}`);
  return { ok: true };
}

export async function setCardStatusAction(
  cardId: number,
  statusId: number,
): Promise<void> {
  if (!Number.isInteger(statusId)) return;
  const { user, board, card } = await loadCard(cardId);
  const [target] = await db
    .select({ id: boardStatuses.id, name: boardStatuses.name })
    .from(boardStatuses)
    .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, board.id)))
    .limit(1);
  if (!target) return;
  const statusChanged = card.statusId !== statusId;
  // Bei Statuswechsel die Karte ans Ende der Zielspalte setzen (sonst landet
  // sie nach (position,id) an willkürlicher Stelle) — wie moveCardAction/REST.
  let newPosition = card.position;
  if (statusChanged) {
    const [posRow] = await db
      .select({ m: max(cards.position) })
      .from(cards)
      .where(
        and(
          eq(cards.boardId, board.id),
          eq(cards.statusId, statusId),
          isNull(cards.archivedAt),
        ),
      );
    newPosition = (posRow?.m ?? -1) + 1;
  }
  await db
    .update(cards)
    // Statuswechsel hebt die „Nachgereicht"-Markierung auf.
    .set({
      statusId,
      updatedAt: new Date(),
      ...(statusChanged
        ? {
            position: newPosition,
            resubmittedAt: null,
            // Eine archivierte Karte wird durch den Statuswechsel wieder aktiv
            // (sonst „Phantom"-Karte mit neuem Status, die ausgeblendet bleibt).
            archivedAt: null,
            doneSince: doneSinceForStatus(
              board.doneStatusId,
              statusId,
              card.doneSince,
            ),
          }
        : {}),
    })
    .where(eq(cards.id, card.id));
  if (statusChanged) {
    const [old] = await db
      .select({ name: boardStatuses.name })
      .from(boardStatuses)
      .where(eq(boardStatuses.id, card.statusId))
      .limit(1);
    await logActivity(
      card.id,
      user.id,
      "status",
      `${old?.name ?? "?"} → ${target.name}`,
    );
    await maybeSetTriggerDates(card.id, statusId);
    // Aufgabentracking: verknüpften Leihvorgang aus der Kartenspalte ableiten
    // (wie moveCardAction) — No-op, wenn die Karte zu keinem Vorgang gehört.
    await syncLoanFromCard(card.id, statusId);
  }
  await maybeArchive(card.id);
  revalidatePath(`/intern/card/${card.id}`);
  revalidatePath(`/intern/board/${board.id}`);
}

const SLOT_FIELD: Record<AttachmentKind, string> = {
  finance_request: "finance_request",
  annex_a: "annex_a",
  annex_b: "annex_b",
  student_card: "student_card",
  other: "other_pdfs",
};

export async function uploadAttachmentAction(
  cardId: number,
  kind: AttachmentKind,
  _prev: State,
  formData: FormData,
): Promise<State> {
  const { user, board, card } = await loadCard(cardId);
  const visible = await visibleFields(board.id);
  if (!visible.has(SLOT_FIELD[kind])) {
    return { error: "Dieses Feld ist auf dem Board nicht aktiviert." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Keine Datei ausgewählt." };
  const allowed = kind === "student_card" ? AUSWEIS_MIME : PDF_MIME;
  const err = validateUpload(file, allowed);
  if (err) return { error: err };

  const saved = await saveAntragFile(card.id, file);

  // Alte Slot-Dateien erst NACH erfolgreichem Commit von der Platte löschen:
  // Bei Rollback (z. B. paralleler Upload in denselben Slot → Unique-Verletzung)
  // bliebe sonst die DB-Zeile, aber die Datei wäre weg („Datei fehlt").
  const oldPaths: string[] = [];
  try {
    await db.transaction(async (tx) => {
      if (kind !== "other") {
        const existing = await tx
          .select()
          .from(attachments)
          .where(and(eq(attachments.cardId, card.id), eq(attachments.kind, kind)));
        for (const ex of existing) {
          oldPaths.push(ex.path);
          await tx.delete(attachments).where(eq(attachments.id, ex.id));
        }
      }
      await tx.insert(attachments).values({
        cardId: card.id,
        kind,
        filename: saved.filename,
        path: saved.relPath,
        mime: saved.mime,
        size: saved.size,
        uploadedBy: user.id,
      });
      await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
    });
  } catch (e) {
    // Transaktion gescheitert → frisch geschriebene Datei wieder entfernen.
    await deleteStoredFile(saved.relPath);
    if ((e as { code?: string }).code === "23505") {
      return {
        error: "In diesen Slot wird gerade eine Datei hochgeladen. Bitte erneut versuchen.",
      };
    }
    return { error: "Upload fehlgeschlagen. Bitte erneut versuchen." };
  }
  // Erst jetzt (nach Commit) die ersetzten Dateien von der Platte löschen.
  for (const p of oldPaths) await deleteStoredFile(p);

  const label =
    CARD_FIELD_LABELS[SLOT_FIELD[kind] as keyof typeof CARD_FIELD_LABELS];
  await logActivity(
    card.id,
    user.id,
    "attachment_added",
    `Datei hinzugefügt: ${saved.filename} (${label})`,
  );

  revalidatePath(`/intern/card/${card.id}`);
  return { success: "Datei hochgeladen." };
}

export async function deleteAttachmentAction(
  cardId: number,
  attachmentId: number,
): Promise<void> {
  if (!Number.isInteger(attachmentId)) return;
  const { user, card } = await loadCard(cardId);
  const [att] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.cardId, card.id)))
    .limit(1);
  if (!att) return;
  // Reihenfolge: erst DB-Zeile entfernen, DANN die Datei — schlägt das DB-Delete
  // fehl, bliebe sonst eine Zeile ohne Datei zurück („Datei fehlt"). Andersrum
  // bleibt im Fehlerfall höchstens eine verwaiste Datei (harmlos).
  await db.delete(attachments).where(eq(attachments.id, att.id));
  await db.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
  await deleteStoredFile(att.path);
  const label =
    CARD_FIELD_LABELS[SLOT_FIELD[att.kind] as keyof typeof CARD_FIELD_LABELS];
  await logActivity(
    card.id,
    user.id,
    "attachment_removed",
    `Datei entfernt: ${att.filename} (${label})`,
  );
  revalidatePath(`/intern/card/${card.id}`);
}

async function removeCard(cardId: number): Promise<number> {
  const { board, card } = await loadCard(cardId);
  const atts = await db.select().from(attachments).where(eq(attachments.cardId, card.id));
  // Erst die Karte löschen (CASCADE entfernt die attachments-Zeilen), DANN die
  // Dateien — so bleibt im Fehlerfall keine DB-Referenz auf eine fehlende Datei.
  await db.delete(cards).where(eq(cards.id, card.id));
  for (const a of atts) await deleteStoredFile(a.path);
  return board.id;
}

export async function deleteCardAction(cardId: number): Promise<void> {
  const boardId = await removeCard(cardId);
  redirect(`/intern/board/${boardId}`);
}

/** Wie löschen, aber ohne Redirect (für das Verwerfen im Neue-Karte-Popup). */
export async function discardCardAction(cardId: number): Promise<void> {
  const boardId = await removeCard(cardId);
  revalidatePath(`/intern/board/${boardId}`);
}

// ---------------------------------------------------------------------------
// Kommentare (rein intern)
// ---------------------------------------------------------------------------
export async function addCommentAction(
  cardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  const { user, card } = await loadCard(cardId);
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Kommentar darf nicht leer sein." };
  await db.insert(cardComments).values({
    cardId: card.id,
    userId: user.id,
    body: body.slice(0, 5000),
  });
  revalidatePath(`/intern/card/${card.id}`);
  return { success: "Kommentar hinzugefügt." };
}

/** Löschen darf der Autor selbst oder ein Board-Verwalter (Eigentümer/Admin). */
export async function deleteCommentAction(
  cardId: number,
  commentId: number,
): Promise<void> {
  const { user, board, card } = await loadCard(cardId);
  const [c] = await db
    .select()
    .from(cardComments)
    .where(and(eq(cardComments.id, commentId), eq(cardComments.cardId, card.id)))
    .limit(1);
  if (!c) return;
  if (c.userId !== user.id && !canManageBoard(user, board)) return;
  await db.delete(cardComments).where(eq(cardComments.id, c.id));
  revalidatePath(`/intern/card/${card.id}`);
}
