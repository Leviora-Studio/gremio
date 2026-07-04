// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cards, cardActivity, boardStatuses } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { createBoardFromTemplate } from "@/lib/boards";
import { generateToken, isTokenConflict } from "@/lib/token";
import { maybeArchive } from "@/lib/archive";
import { logActivity } from "@/lib/activity";
import { assignCardNumber } from "@/lib/numbering";
import { maybeSetTriggerDates } from "@/lib/instruction";
import { syncLoanFromCard } from "@/lib/inventory-loans";
import { doneSinceForStatus } from "@/lib/done-archive";

export type State = { error?: string; success?: string };

const boardSchema = z.object({
  name: z.string().min(1, "Bitte einen Board-Namen angeben.").max(120),
  description: z.string().max(500).optional(),
});

export async function createBoardAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const user = await requireUser();
  const parsed = boardSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  const templateId = Number(formData.get("templateId")) || null;
  const boardId = await createBoardFromTemplate(
    user.id,
    parsed.data.name,
    parsed.data.description ?? null,
    templateId,
  );
  redirect(`/intern/board/${boardId}`);
}

/**
 * Karte verschieben/sortieren (Drag&Drop).
 * `orderedIds` = gewünschte Reihenfolge der Karten-IDs in der Zielspalte
 * (inkl. der bewegten Karte). Fehlende Karten der Spalte werden hinten
 * angehängt, sodass durch Filter ausgeblendete Karten nicht verloren gehen.
 */
export async function moveCardAction(
  cardId: number,
  statusId: number,
  orderedIds: number[],
): Promise<void> {
  const user = await requireUser();
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) return;
  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) return;

  // Zielspalte muss zum selben Board gehören.
  const [target] = await db
    .select({ id: boardStatuses.id, name: boardStatuses.name })
    .from(boardStatuses)
    .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, card.boardId)))
    .limit(1);
  if (!target) return;

  const statusChanged = card.statusId !== statusId;

  await db.transaction(async (tx) => {
    if (statusChanged) {
      await tx
        .update(cards)
        // Statuswechsel hebt die „Nachgereicht"-Markierung auf.
        .set({
          statusId,
          updatedAt: new Date(),
          resubmittedAt: null,
          doneSince: doneSinceForStatus(board.doneStatusId, statusId, card.doneSince),
        })
        .where(eq(cards.id, cardId));
    }
    // Aktuelle (nicht archivierte) Karten der Zielspalte.
    const inCol = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(
          eq(cards.boardId, card.boardId),
          eq(cards.statusId, statusId),
          isNull(cards.archivedAt),
        ),
      )
      .orderBy(asc(cards.position), asc(cards.id));
    const colSet = new Set(inCol.map((r) => r.id));
    const ordered = orderedIds.filter((id) => colSet.has(id));
    const seen = new Set(ordered);
    for (const r of inCol) if (!seen.has(r.id)) ordered.push(r.id);
    for (let i = 0; i < ordered.length; i++) {
      await tx.update(cards).set({ position: i }).where(eq(cards.id, ordered[i]));
    }
  });

  if (statusChanged) {
    const [old] = await db
      .select({ name: boardStatuses.name })
      .from(boardStatuses)
      .where(eq(boardStatuses.id, card.statusId))
      .limit(1);
    await logActivity(
      cardId,
      user.id,
      "status",
      `${old?.name ?? "?"} → ${target.name}`,
    );
    await maybeSetTriggerDates(cardId, statusId);
    // Aufgabentracking: verknüpften Leihvorgang aus der Kartenspalte ableiten.
    await syncLoanFromCard(cardId, statusId);
    await maybeArchive(cardId);
  }
  revalidatePath(`/intern/board/${card.boardId}`);
}

/** Legt sofort eine leere Karte ("Neue Karte") in der ersten Spalte an und gibt die ID zurück. */
export async function createBlankCardAction(
  boardId: number,
): Promise<{ id?: number; error?: string }> {
  const user = await requireUser();
  const board = await getBoardById(boardId);
  if (!board || !(await canAccessBoard(user, board))) {
    return { error: "Kein Zugriff auf dieses Board." };
  }
  const [firstStatus] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId))
    .orderBy(asc(boardStatuses.position))
    .limit(1);
  if (!firstStatus) return { error: "Board hat keine Spalten." };

  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(and(eq(cards.boardId, boardId), eq(cards.statusId, firstStatus.id)));

  const position = (maxRow?.m ?? -1) + 1;
  // Karte + Aktivitätseintrag atomar anlegen; Token-Kollision wird durch
  // erneutes Würfeln abgefangen, sonst freundliche Fehlermeldung.
  let newId: number | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        newId = await db.transaction(async (tx) => {
          const [c] = await tx
            .insert(cards)
            .values({
              boardId,
              statusId: firstStatus.id,
              title: "Neue Karte",
              applicant: "",
              token: generateToken(),
              creatorUserId: user.id,
              accountId: board.defaultAccountId ?? null,
              position,
              doneSince: doneSinceForStatus(board.doneStatusId, firstStatus.id, null),
            })
            .returning({ id: cards.id });
          await tx.insert(cardActivity).values({
            cardId: c.id,
            userId: user.id,
            type: "created",
            detail: "Karte erstellt",
          });
          return c.id;
        });
        break;
      } catch (e) {
        if (isTokenConflict(e) && attempt < 5) continue;
        throw e;
      }
    }
  } catch {
    return { error: "Karte konnte nicht angelegt werden. Bitte erneut versuchen." };
  }
  revalidatePath(`/intern/board/${boardId}`);
  return { id: newId! };
}

/**
 * Wird beim Behalten einer neuen Karte aufgerufen (Fertig/Schließen, NICHT
 * beim Verwerfen). Vergibt die Antragsnummer, falls für das Board aktiviert
 * und noch keine gesetzt ist — so verbraucht Verwerfen nie eine Nummer.
 */
export async function finalizeNewCardAction(cardId: number): Promise<void> {
  const user = await requireUser();
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) return;
  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) return;
  await assignCardNumber(card.boardId, cardId);
  revalidatePath(`/intern/board/${card.boardId}`);
  revalidatePath(`/intern/card/${cardId}`);
}
