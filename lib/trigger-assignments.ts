// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boards,
  boardStatuses,
  boardTriggerAssignees,
  boardTriggerAssignments,
  cardActivity,
  cardAssignees,
  cards,
  users,
} from "@/lib/db/schema";
import { getBoardById, getBoardMemberUsers } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { assigneeActivityDetail } from "@/lib/activity";
import { TRIGGER_KINDS, TRIGGER_LABELS, type TriggerKind } from "@/lib/constants";

export type TriggerAssignmentConfig = { clearAssignees: boolean; userIds: number[] };

export function isTriggerKind(value: unknown): value is TriggerKind {
  return TRIGGER_KINDS.includes(value as TriggerKind);
}

/**
 * Ergebnis einer Trigger-Aktion: optional alle Zuweisungen entfernen, danach
 * die hinterlegten Nutzer zusätzlich zuweisen. Nutzer ohne (aktuellen)
 * Board-Zugriff werden übersprungen.
 */
export function planTriggerAssignment(
  current: number[],
  config: TriggerAssignmentConfig,
  memberIds: ReadonlySet<number>,
): { added: number[]; removed: number[] } {
  const base = config.clearAssignees ? [] : current;
  const target = new Set([...base, ...config.userIds.filter((id) => memberIds.has(id))]);
  const cur = new Set(current);
  return {
    added: [...target].filter((id) => !cur.has(id)),
    removed: current.filter((id) => !target.has(id)),
  };
}

/** Zuweisungs-Aktionen aller Trigger eines Boards. Fehlender Eintrag = keine Aktion. */
export async function getTriggerAssignmentConfigs(
  boardId: number,
): Promise<Map<TriggerKind, TriggerAssignmentConfig>> {
  const rows = await db
    .select()
    .from(boardTriggerAssignments)
    .where(eq(boardTriggerAssignments.boardId, boardId));
  const assignees = await db
    .select({ trigger: boardTriggerAssignees.trigger, userId: boardTriggerAssignees.userId })
    .from(boardTriggerAssignees)
    .where(eq(boardTriggerAssignees.boardId, boardId));
  const map = new Map<TriggerKind, TriggerAssignmentConfig>();
  for (const r of rows) {
    if (!isTriggerKind(r.trigger)) continue;
    map.set(r.trigger, {
      clearAssignees: r.clearAssignees,
      userIds: assignees.filter((a) => a.trigger === r.trigger).map((a) => a.userId),
    });
  }
  return map;
}

/**
 * Caller must require board management. Ersetzt die Aktion eines Triggers
 * atomar; zusätzlich zuzuweisende Nutzer müssen Board-Zugriff haben.
 */
export async function setTriggerAssignmentConfig(
  boardId: number,
  trigger: TriggerKind,
  clearAssignees: boolean,
  input: unknown[],
): Promise<{ error?: string; success?: string }> {
  const userIds = [...new Set(input.map(Number))];
  const board = await getBoardById(boardId);
  if (!board) return { error: "Board nicht gefunden." };
  const memberIds = new Set((await getBoardMemberUsers(board)).map((m) => m.id));
  if (userIds.some((id) => !Number.isInteger(id) || !memberIds.has(id))) {
    return { error: "Bitte ausschließlich Nutzer mit Zugriff auf dieses Board auswählen." };
  }
  await db.transaction(async (tx) => {
    // Löscht per FK-Cascade auch die bisher hinterlegten Nutzer.
    await tx
      .delete(boardTriggerAssignments)
      .where(
        and(
          eq(boardTriggerAssignments.boardId, boardId),
          eq(boardTriggerAssignments.trigger, trigger),
        ),
      );
    if (!clearAssignees && !userIds.length) return;
    await tx.insert(boardTriggerAssignments).values({ boardId, trigger, clearAssignees });
    if (userIds.length) {
      await tx
        .insert(boardTriggerAssignees)
        .values(userIds.map((userId) => ({ boardId, trigger, userId })));
    }
  });
  return { success: "Zuweisungen gespeichert." };
}

/** Trigger, die beim Erreichen einer Spalte auslösen. */
export async function statusTriggerKinds(statusId: number): Promise<TriggerKind[]> {
  const [st] = await db
    .select({
      id: boardStatuses.id,
      instruction: boardStatuses.isInstructionTrigger,
      transfer: boardStatuses.isTransferTrigger,
      archive: boardStatuses.isArchiveTrigger,
      doneStatusId: boards.doneStatusId,
    })
    .from(boardStatuses)
    .innerJoin(boards, eq(boards.id, boardStatuses.boardId))
    .where(eq(boardStatuses.id, statusId))
    .limit(1);
  if (!st) return [];
  const kinds: TriggerKind[] = [];
  if (st.instruction) kinds.push("instruction");
  if (st.transfer) kinds.push("transfer");
  if (st.archive) kinds.push("archive");
  if (st.doneStatusId === st.id) kinds.push("done");
  return kinds;
}

/**
 * Führt die Zuweisungs-Aktionen der ausgelösten Trigger nacheinander aus (in
 * TRIGGER_KINDS-Reihenfolge) und protokolliert jede tatsächliche Änderung im
 * Aktivitätsfeed. Ist „Zugewiesen zu" am Board ausgeblendet, passiert nichts.
 */
export async function applyTriggerAssignments(
  cardId: number,
  kinds: TriggerKind[],
): Promise<void> {
  if (!kinds.length) return;
  const [card] = await db
    .select({ boardId: cards.boardId })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card) return;
  const configs = await getTriggerAssignmentConfigs(card.boardId);
  const active = TRIGGER_KINDS.filter((k) => {
    const c = configs.get(k);
    return kinds.includes(k) && c && (c.clearAssignees || c.userIds.length > 0);
  });
  if (!active.length) return;
  if (!(await getVisibleFieldKeys(card.boardId)).has("assignee")) return;
  const board = await getBoardById(card.boardId);
  if (!board) return;
  const memberIds = new Set((await getBoardMemberUsers(board)).map((m) => m.id));

  for (const kind of active) {
    await db.transaction(async (tx) => {
      // Kartensperre serialisiert gleichzeitige Trigger derselben Karte.
      const [locked] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.id, cardId))
        .for("update");
      if (!locked) return;
      const current = (
        await tx
          .select({ userId: cardAssignees.userId })
          .from(cardAssignees)
          .where(eq(cardAssignees.cardId, cardId))
      ).map((r) => r.userId);
      const { added, removed } = planTriggerAssignment(current, configs.get(kind)!, memberIds);
      if (!added.length && !removed.length) return;
      if (removed.length) {
        await tx
          .delete(cardAssignees)
          .where(and(eq(cardAssignees.cardId, cardId), inArray(cardAssignees.userId, removed)));
      }
      if (added.length) {
        await tx
          .insert(cardAssignees)
          .values(added.map((userId) => ({ cardId, userId })))
          .onConflictDoNothing();
      }
      // Löst den cards-NOTIFY aus → Boards zeigen die neuen Zuweisungen live.
      await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, cardId));
      const names = await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, [...added, ...removed]));
      const nameOf = (id: number) => names.find((n) => n.id === id)?.username ?? "?";
      const detail = assigneeActivityDetail(added.map(nameOf), removed.map(nameOf));
      await tx.insert(cardActivity).values({
        cardId,
        userId: null,
        type: "assignee",
        detail: `Automatisch (Trigger „${TRIGGER_LABELS[kind]}"): ${detail}`,
      });
    });
  }
}

/** Trigger der erreichten Spalte (plus auslösende Ereignisse) anwenden. */
export async function applyStatusTriggerAssignments(
  cardId: number,
  statusId: number,
  events: TriggerKind[] = [],
): Promise<void> {
  await applyTriggerAssignments(cardId, [...events, ...(await statusTriggerKinds(statusId))]);
}
