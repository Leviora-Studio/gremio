// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accounts,
  attachments,
  boardStatuses,
  cardActivity,
  cards,
  priorities,
  type Board,
  type Card,
  type User,
} from "@/lib/db/schema";
import {
  canAccessBoard,
  canManageBoard,
  getBoardById,
  getBoardMemberUsers,
} from "@/lib/authz";
import {
  assigneeActivityDetail,
  deadlineActivityDetail,
  logActivity,
} from "@/lib/activity";
import { setCardAssignees } from "@/lib/assignees";
import { maybeArchive } from "@/lib/archive";
import { maybeSetTriggerDates } from "@/lib/instruction";
import { syncLoanFromCard } from "@/lib/inventory-loans";
import { assignCardNumber } from "@/lib/numbering";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { API_FIELD_TO_KEY, getVisibleFieldKeys } from "@/lib/board-fields";
import { generateToken, isTokenConflict } from "@/lib/token";
import { deleteStoredFile } from "@/lib/attachments";
import { doneSinceForStatus } from "@/lib/done-archive";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
/** Echtes Kalenderdatum (nicht nur Format) — weist z. B. 2026-99-99 ab. */
function isValidApiDate(s: string): boolean {
  if (!dateRe.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const date = z
  .string()
  .refine(isValidApiDate, "Datum muss ein gültiges Datum (YYYY-MM-DD) sein")
  .nullish();

/** Schreibbare Kartenfelder über die API (POST/PATCH). */
export const cardWriteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    applicant: z.string().max(200).nullish(),
    budgetTitle: z.string().max(200).nullish(),
    number: z.string().max(100).nullish(),
    statusId: z.number().int().positive().optional(),
    position: z.number().int().min(0).optional(),
    priorityId: z.number().int().positive().nullish(),
    accountId: z.number().int().positive().nullish(),
    assigneeUserIds: z.array(z.number().int().positive()).max(50).optional(),
    creatorUserId: z.number().int().positive().nullish(),
    deadline: date,
    meeting: date,
    decisionRef: z.string().max(200).nullish(),
    instructionDate: date,
    transferDate: date,
    approvedAmountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).nullish(),
    actualAmountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).nullish(),
    notes: z.string().max(20000).nullish(),
    applicantNote: z.string().max(20000).nullish(),
    // true = archivieren (ausblenden), false = wiederherstellen.
    archived: z.boolean().optional(),
  })
  .strict();

export type CardWriteInput = z.infer<typeof cardWriteSchema>;

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ApiResult<never> => ({
  ok: false,
  status,
  error,
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CardColumns = Partial<typeof cards.$inferInsert>;

/**
 * Validiert die referenziellen Felder (Status/Priorität/Konto/Nutzer) und baut
 * ein Spalten-Objekt für die angegebenen Felder. Schreibt nichts.
 */
async function buildCardValues(
  board: Board,
  input: CardWriteInput,
  memberIds: Set<number>,
  canManage: boolean,
): Promise<ApiResult<{ value: CardColumns; assigneeUserIds?: number[] }>> {
  // Verwalter-exklusive Felder (wie in der UI): nur Board-Verwalter dürfen
  // Antragsnummer und Anweisungsdatum setzen.
  if (!canManage) {
    for (const k of ["number", "instructionDate", "transferDate"] as const) {
      if (k in input) {
        return fail(403, `Feld '${k}' darf nur ein Board-Verwalter setzen.`);
      }
    }
  }

  // Nur am Board AKTIVIERTE optionale Felder dürfen geschrieben werden — sonst
  // erlaubte die API mehr als die Web-UI (die deaktivierte Felder ausblendet
  // und serverseitig ignoriert). Titel/Status/Position sind Kern-Operationen.
  const visible = await getVisibleFieldKeys(board.id);
  for (const [inputKey, fieldKey] of Object.entries(API_FIELD_TO_KEY)) {
    if (inputKey in input && !visible.has(fieldKey)) {
      return fail(
        400,
        `Feld '${inputKey}' ist auf diesem Board nicht aktiviert.`,
      );
    }
  }

  const v: CardColumns = {};

  if ("title" in input && input.title) v.title = input.title.trim().slice(0, 200);
  if ("applicant" in input)
    v.applicant = input.applicant ? String(input.applicant).slice(0, 200) : "";
  if ("budgetTitle" in input)
    v.budgetTitle = input.budgetTitle
      ? String(input.budgetTitle).slice(0, 60) // wie Plan-haushaltstitel (Matching-Schlüssel)
      : null;
  if ("number" in input)
    v.number =
      input.number && input.number.trim() ? input.number.trim().slice(0, 100) : null;
  if ("deadline" in input) v.deadline = input.deadline ?? null;
  if ("meeting" in input) v.meeting = input.meeting ?? null;
  if ("decisionRef" in input)
    v.decisionRef = input.decisionRef ? String(input.decisionRef).slice(0, 200) : null;
  if ("instructionDate" in input) v.instructionDate = input.instructionDate ?? null;
  if ("transferDate" in input) v.transferDate = input.transferDate ?? null;
  if ("approvedAmountCents" in input)
    v.approvedAmount = input.approvedAmountCents ?? null;
  if ("actualAmountCents" in input) v.actualAmount = input.actualAmountCents ?? null;
  if ("notes" in input) v.notes = input.notes ?? null;
  if ("applicantNote" in input) v.applicantNote = input.applicantNote ?? null;
  if ("archived" in input) {
    // Das Web kennt KEIN manuelles Archivieren (nur den Done-Spalten-Scheduler).
    // Wiederherstellen (archived=false) darf im Web jedes Board-Mitglied → erlaubt.
    if (input.archived === true) {
      return fail(
        400,
        "Manuelles Archivieren ist nicht möglich (nur Wiederherstellen).",
      );
    }
    v.archivedAt = null;
    // Done-Archiv-Uhr zurücksetzen, sonst würde der Sweep eine in der
    // Done-Spalte wiederhergestellte Karte sofort wieder archivieren.
    v.doneSince = null;
  }

  if ("statusId" in input && input.statusId != null) {
    const [s] = await db
      .select({ id: boardStatuses.id })
      .from(boardStatuses)
      .where(
        and(
          eq(boardStatuses.id, input.statusId),
          eq(boardStatuses.boardId, board.id),
        ),
      )
      .limit(1);
    if (!s) return fail(400, `statusId ${input.statusId} gehört nicht zu diesem Board.`);
    v.statusId = input.statusId;
  }

  if ("priorityId" in input) {
    if (input.priorityId == null) v.priorityId = null;
    else {
      const [p] = await db
        .select({ id: priorities.id })
        .from(priorities)
        .where(eq(priorities.id, input.priorityId))
        .limit(1);
      if (!p) return fail(400, `priorityId ${input.priorityId} existiert nicht.`);
      v.priorityId = input.priorityId;
    }
  }

  if ("accountId" in input) {
    if (input.accountId == null) v.accountId = null;
    else {
      const [a] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, input.accountId))
        .limit(1);
      if (!a) return fail(400, `accountId ${input.accountId} existiert nicht.`);
      v.accountId = input.accountId;
    }
  }

  let assigneeUserIds: number[] | undefined;
  if ("assigneeUserIds" in input && input.assigneeUserIds) {
    const ids = [...new Set(input.assigneeUserIds)];
    for (const id of ids) {
      if (!memberIds.has(id))
        return fail(400, `assigneeUserId ${id} hat keinen Zugriff auf dieses Board.`);
    }
    assigneeUserIds = ids;
  }

  if ("creatorUserId" in input) {
    if (input.creatorUserId == null) v.creatorUserId = null;
    else if (!memberIds.has(input.creatorUserId))
      return fail(
        400,
        `creatorUserId ${input.creatorUserId} hat keinen Zugriff auf dieses Board.`,
      );
    else v.creatorUserId = input.creatorUserId;
  }

  return { ok: true, value: { value: v, assigneeUserIds } };
}

/**
 * Schreibt die Positionen der Zielspalte neu, sodass `cardId` an Index `index`
 * steht (oder ans Ende, wenn `index` fehlt). Spiegelt die Drag&Drop-Logik.
 */
async function repositionCard(
  tx: Tx,
  boardId: number,
  statusId: number,
  cardId: number,
  index?: number,
): Promise<void> {
  const inCol = await tx
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.boardId, boardId),
        eq(cards.statusId, statusId),
        isNull(cards.archivedAt), // archivierte Karten nicht mit-renummerieren (wie moveCardAction)
      ),
    )
    .orderBy(asc(cards.position), asc(cards.id));
  const ids = inCol.map((r) => r.id).filter((id) => id !== cardId);
  const idx = index == null ? ids.length : Math.max(0, Math.min(index, ids.length));
  ids.splice(idx, 0, cardId);
  for (let i = 0; i < ids.length; i++) {
    await tx.update(cards).set({ position: i }).where(eq(cards.id, ids[i]));
  }
}

async function freshCard(cardId: number): Promise<Card> {
  const [c] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  return c;
}

/** Karte laden + Board-Zugriff des Nutzers prüfen (404 sonst). */
export async function loadApiCard(
  user: User,
  cardId: number,
): Promise<ApiResult<{ board: Board; card: Card }>> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) return fail(404, "Karte nicht gefunden.");
  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board)))
    return fail(404, "Karte nicht gefunden.");
  return { ok: true, value: { board, card } };
}

/** Karte samt Anhängen löschen (Dateien werden mit entfernt). */
export async function deleteCardViaApi(cardId: number): Promise<void> {
  const atts = await db
    .select()
    .from(attachments)
    .where(eq(attachments.cardId, cardId));
  // Erst DB (CASCADE löscht attachments-Zeilen), dann Dateien — kein Risiko
  // einer DB-Zeile ohne zugehörige Datei bei einem Fehler.
  await db.delete(cards).where(eq(cards.id, cardId));
  for (const a of atts) await deleteStoredFile(a.path);
}

/** Neue Karte über die API anlegen. */
export async function createCardViaApi(
  user: User,
  board: Board,
  input: CardWriteInput,
): Promise<ApiResult<Card>> {
  if (!input.title || !input.title.trim())
    return fail(400, "Feld 'title' ist erforderlich.");

  const members = await getBoardMemberUsers(board);
  const built = await buildCardValues(
    board,
    input,
    new Set(members.map((m) => m.id)),
    canManageBoard(user, board),
  );
  if (!built.ok) return built;
  const { value: v, assigneeUserIds } = built.value;

  // Zielspalte: explizit oder erste Spalte des Boards.
  let statusId = v.statusId;
  if (statusId == null) {
    const [first] = await db
      .select({ id: boardStatuses.id })
      .from(boardStatuses)
      .where(eq(boardStatuses.boardId, board.id))
      .orderBy(asc(boardStatuses.position))
      .limit(1);
    if (!first) return fail(400, "Board hat keine Spalten.");
    statusId = first.id;
  }

  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(and(eq(cards.boardId, board.id), eq(cards.statusId, statusId)));
  const position = (maxRow?.m ?? -1) + 1;

  let newId: number | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      newId = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(cards)
          .values({
            ...v,
            boardId: board.id,
            statusId,
            title: v.title ?? input.title!.trim().slice(0, 200),
            applicant: v.applicant ?? "",
            token: generateToken(),
            creatorUserId: v.creatorUserId ?? user.id,
            accountId: "accountId" in v ? v.accountId : board.defaultAccountId ?? null,
            position,
            doneSince: doneSinceForStatus(board.doneStatusId, statusId, null),
          })
          .returning({ id: cards.id });
        await tx.insert(cardActivity).values({
          cardId: c.id,
          userId: user.id,
          type: "created",
          detail: "Karte erstellt (API)",
        });
        return c.id;
      });
      break;
    } catch (e) {
      if (isTokenConflict(e) && attempt < 5) continue;
      throw e;
    }
  }

  if (assigneeUserIds?.length) await setCardAssignees(newId!, assigneeUserIds);
  // Antragsnummer vergeben (falls Board-Nummerierung aktiv).
  await assignCardNumber(board.id, newId!);
  // Trigger-Spalten beim direkten Anlegen ebenfalls auslösen.
  await maybeSetTriggerDates(newId!, statusId);
  await maybeArchive(newId!);
  return { ok: true, value: await freshCard(newId!) };
}

/** Bestehende Karte über die API ändern / verschieben. */
export async function updateCardViaApi(
  user: User,
  board: Board,
  card: Card,
  input: CardWriteInput,
): Promise<ApiResult<Card>> {
  if ("title" in input && (!input.title || !input.title.trim()))
    return fail(400, "Feld 'title' darf nicht leer sein.");

  const members = await getBoardMemberUsers(board);
  const built = await buildCardValues(
    board,
    input,
    new Set(members.map((m) => m.id)),
    canManageBoard(user, board),
  );
  if (!built.ok) return built;
  const { value: builtCols, assigneeUserIds } = built.value;
  const update: CardColumns = { ...builtCols };

  // Statuswechsel erkennen (für Aktivität/Trigger).
  let moveTo: { id: number; name: string } | null = null;
  let oldStatusName = "?";
  if (update.statusId != null && update.statusId !== card.statusId) {
    const newStatusId = update.statusId; // bereits gegen das Board validiert
    const [target] = await db
      .select({ id: boardStatuses.id, name: boardStatuses.name })
      .from(boardStatuses)
      .where(eq(boardStatuses.id, newStatusId))
      .limit(1);
    moveTo = target ?? null;
    const [old] = await db
      .select({ name: boardStatuses.name })
      .from(boardStatuses)
      .where(eq(boardStatuses.id, card.statusId))
      .limit(1);
    oldStatusName = old?.name ?? "?";
    update.resubmittedAt = null; // Statuswechsel hebt „Nachgereicht" auf
    // newStatusId statt target.id: target kann (TOCTOU – Spalte zwischenzeitlich
    // gelöscht) undefined sein; newStatusId ist garantiert gesetzt.
    update.doneSince = doneSinceForStatus(
      board.doneStatusId,
      newStatusId,
      card.doneSince,
    );
  } else {
    // Gleicher Status: statusId nicht erneut schreiben.
    delete update.statusId;
  }

  const wantsReposition = moveTo != null || "position" in input;
  const targetStatusId = moveTo?.id ?? card.statusId;

  if (Object.keys(update).length === 0 && !wantsReposition) {
    return { ok: true, value: card }; // nichts zu tun
  }

  update.updatedAt = new Date();
  await db.transaction(async (tx) => {
    if (Object.keys(update).length > 0) {
      await tx.update(cards).set(update).where(eq(cards.id, card.id));
    }
    if (wantsReposition) {
      await repositionCard(tx, board.id, targetStatusId, card.id, input.position);
    }
  });

  if (moveTo) {
    await logActivity(
      card.id,
      user.id,
      "status",
      `${oldStatusName} → ${moveTo.name}`,
    );
    await maybeSetTriggerDates(card.id, moveTo.id);
    // Nur auf System-/Leihboards den verknüpften Vorgang ableiten.
    if (board.inventoryBoardId != null) {
      await syncLoanFromCard(card.id, moveTo.id);
    }
    await maybeArchive(card.id);
  }
  if (assigneeUserIds) {
    const { added, removed } = await setCardAssignees(card.id, assigneeUserIds);
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

  return { ok: true, value: await freshCard(card.id) };
}
