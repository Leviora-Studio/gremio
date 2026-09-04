// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import type { Board, BoardStatus, Card, User } from "@/lib/db/schema";
import { authenticateApiToken, type ApiContext } from "@/lib/api-token";

export type { ApiContext } from "@/lib/api-token";

/** IDs use PostgreSQL integer columns; reject malformed/out-of-range input before querying. */
export function parseApiId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

/** Einheitliche JSON-Fehlerantwort. */
export function apiError(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Authentifiziert eine API-Anfrage über den Bearer-Token. Gibt entweder den
 * Auth-Kontext oder eine fertige 401-Antwort zurück (mit `instanceof
 * NextResponse` im Route-Handler prüfen).
 */
export async function authApi(req: Request): Promise<ApiContext | NextResponse> {
  const ctx = await authenticateApiToken(req.headers.get("authorization"));
  if (!ctx) {
    return apiError(401, "Ungültiger oder fehlender API-Token.", {
      hint: "Header 'Authorization: Bearer grm_…' setzen.",
    });
  }
  return ctx;
}

/**
 * Darf der Token dieses Board überhaupt sehen? (Board-Scope, ZUSÄTZLICH zur
 * Live-Zugriffsprüfung des Nutzers via canAccessBoard.)
 */
export function tokenAllowsBoard(ctx: ApiContext, boardId: number): boolean {
  return ctx.boardIds == null || ctx.boardIds.has(boardId);
}

/** 403 zurückgeben, wenn der Token nur Lese-Rechte hat. */
export function requireWriteScope(ctx: ApiContext): NextResponse | null {
  if (ctx.scope !== "write") {
    return apiError(403, "Dieser Token hat nur Lese-Rechte (scope=read).");
  }
  return null;
}

/** Rolle des Nutzers bezogen auf ein Board. */
export function boardRole(user: User, board: Board): "admin" | "owner" | "member" {
  if (board.ownerId === user.id) return "owner";
  if (user.role === "admin") return "admin";
  return "member";
}

export function serializeBoard(board: Board, user: User) {
  const role = boardRole(user, board);
  const canManage = role === "owner" || role === "admin";
  return {
    id: board.id,
    name: board.name,
    description: board.description,
    // Die rohe Eigentümer-ID sieht im Web nur ein Verwalter (in den Einstellungen);
    // ein normales Mitglied erfährt über `role` nur, ob es selbst Eigentümer ist.
    ...(canManage ? {
      ownerId: board.ownerId,
      receiptToStatusId: board.receiptToStatusId,
      resubmitStatusId: board.resubmitStatusId,
    } : {}),
    role,
    doneStatusId: board.doneStatusId,
    createdAt: board.createdAt,
  };
}

export function serializeStatus(s: BoardStatus, canManage = false) {
  return {
    id: s.id,
    name: s.name,
    position: s.position,
    isArchiveTrigger: s.isArchiveTrigger,
    // Der Anweisungs-Trigger ist im Web nur in den (verwalter-exklusiven)
    // Board-Einstellungen sichtbar — daher nur für Verwalter ausgeben.
    ...(canManage ? {
      isInstructionTrigger: s.isInstructionTrigger,
      isTransferTrigger: s.isTransferTrigger,
      isReceiptTrigger: s.isReceiptTrigger,
    } : {}),
  };
}

/**
 * Karte → öffentliches API-JSON. Beträge als Integer-Cent.
 *
 * `visible` = die am Board AKTIVIERTEN optionalen Feld-Schlüssel. Deaktivierte
 * Felder werden NICHT ausgeliefert, damit die API nicht mehr zeigt als die
 * Web-UI (die deaktivierte Felder ausblendet). Ohne `visible` (Fallback) wird
 * alles ausgegeben. Titel/Status/Position/Zeitstempel sind immer sichtbar.
 */
export function serializeCard(
  c: Card,
  extra?: { statusName?: string; boardName?: string; assigneeUserIds?: number[] },
  visible?: Set<string>,
) {
  const show = (key: string) => visible == null || visible.has(key);
  const out: Record<string, unknown> = {
    id: c.id,
    budgetMode: c.budgetMode,
    budgetRevision: c.budgetRevision,
    boardId: c.boardId,
    statusId: c.statusId,
    ...(extra?.statusName !== undefined ? { statusName: extra.statusName } : {}),
    ...(extra?.boardName !== undefined ? { boardName: extra.boardName } : {}),
    position: c.position,
    title: c.title,
    locationId: c.locationId,
    // nextcloudLink wird bewusst NICHT ausgegeben — er ist im Web auf keiner
    // Oberfläche sichtbar (nur intern beim Archivieren gesetzt).
    archivedAt: c.archivedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
  // Optionale Felder nur, wenn am Board aktiviert (gleiche Keys wie Schreib-API).
  if (show("applicant")) out.applicant = c.applicant;
  if (show("number")) out.number = c.number;
  if (show("budget_title")) out.budgetTitle = c.budgetTitle;
  if (show("priority")) out.priorityId = c.priorityId;
  if (show("account")) out.accountId = c.accountId;
  if (show("assignee")) out.assigneeUserIds = extra?.assigneeUserIds ?? [];
  if (show("creator")) out.creatorUserId = c.creatorUserId;
  if (show("deadline")) out.deadline = c.deadline;
  if (show("meeting")) out.meeting = c.meeting;
  if (show("decision_ref")) out.decisionRef = c.decisionRef;
  if (show("instruction_date")) out.instructionDate = c.instructionDate;
  if (show("transfer_date")) out.transferDate = c.transferDate;
  if (show("requested_amount")) out.requestedAmountCents = c.requestedAmount;
  if (show("approved_amount")) out.approvedAmountCents = c.approvedAmount;
  if (show("actual_amount")) out.actualAmountCents = c.actualAmount;
  if (show("notes")) out.notes = c.notes;
  if (show("applicant_note")) out.applicantNote = c.applicantNote;
  return out;
}
