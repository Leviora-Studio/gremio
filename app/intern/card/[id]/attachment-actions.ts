// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { attachmentFolders, attachments, boards, cards, cardActivity } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";
import { organizationName } from "@/lib/attachment-organization";
import type { State } from "./actions";

function validId(id: unknown): id is number {
  return Number.isSafeInteger(id) && Number(id) > 0 && Number(id) <= 2_147_483_647;
}

async function access(cardId: number) {
  const user = await requireUser();
  if (!validId(cardId)) notFound();
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) notFound();
  const [board] = await db.select().from(boards).where(eq(boards.id, card.boardId));
  if (!board || !await canAccessBoard(user, board)) notFound();
  return { user, card, visible: await getVisibleFieldKeys(board.id) };
}

export async function createAttachmentFolderAction(cardId: number, _prev: State, data: FormData): Promise<State> {
  const { user, card } = await access(cardId);
  const name = organizationName(data.get("name"));
  if (!name) return { error: "Bitte einen gültigen Ordnernamen eingeben (max. 120 Zeichen, keine Pfad- oder Sonderzeichen)." };
  const result = await db.transaction(async (tx): Promise<State> => {
    const [current] = await tx.select().from(cards).where(eq(cards.id, card.id)).for("update");
    if (!current) return { error: "Das Ticket wurde gelöscht." };
    const folders = await tx.select().from(attachmentFolders).where(eq(attachmentFolders.cardId, card.id));
    if (folders.some((f) => f.name.toLocaleLowerCase("de-DE") === name.toLocaleLowerCase("de-DE"))) {
      return { error: "Ein Ordner mit diesem Namen existiert bereits." };
    }
    await tx.insert(attachmentFolders).values({ cardId: card.id, name });
    await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
    await tx.insert(cardActivity).values({ cardId: card.id, userId: user.id, type: "attachment_folder_created", detail: `Ordner erstellt: ${name}` });
    return { success: "Ordner erstellt." };
  });
  revalidatePath(`/intern/card/${card.id}`);
  return result;
}

export async function organizeAttachmentAction(cardId: number, attachmentId: number, _prev: State, data: FormData): Promise<State> {
  const { user, card, visible } = await access(cardId);
  if (!validId(attachmentId)) notFound();
  const rawName = data.get("filename");
  const requestedName = organizationName(rawName);
  const rawFolder = data.get("folderId");
  const folderId = rawFolder === "" ? null : typeof rawFolder === "string" && /^\d+$/.test(rawFolder) ? Number(rawFolder) : NaN;
  if (typeof rawName !== "string") return { error: "Bitte einen Dateinamen eingeben." };
  if (folderId !== null && !validId(folderId)) return { error: "Bitte einen gültigen Zielordner auswählen." };
  const result = await db.transaction(async (tx): Promise<State> => {
    const [currentCard] = await tx.select().from(cards).where(eq(cards.id, card.id)).for("update");
    if (!currentCard) return { error: "Das Ticket wurde gelöscht." };
    const [att] = await tx.select().from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.cardId, card.id))).for("update");
    if (!att || !isCardAttachmentVisible(att, visible)) return { error: "Diese Datei ist nicht verfügbar." };
    // Moving a legacy upload must not require renaming its existing filename.
    const name = rawName === att.filename ? att.filename : requestedName;
    if (!name) return { error: "Bitte einen gültigen Dateinamen eingeben (max. 120 Zeichen, keine Pfad- oder Sonderzeichen)." };
    if ((data.has("originalFilename") && data.get("originalFilename") !== att.filename) ||
        (data.has("originalFolderId") && data.get("originalFolderId") !== String(att.folderId ?? ""))) {
      return { error: "Die Datei wurde inzwischen umbenannt oder verschoben. Bitte das Ticket neu laden." };
    }
    const extension = (filename: string) => filename.match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";
    if (extension(name) !== extension(att.filename)) return { error: "Die Dateiendung muss erhalten bleiben." };
    const [folder] = folderId == null ? [] : await tx.select().from(attachmentFolders).where(and(eq(attachmentFolders.id, folderId), eq(attachmentFolders.cardId, card.id)));
    if (folderId != null && !folder) return { error: "Der Zielordner gehört nicht zu diesem Ticket." };
    if (att.filename === name && att.folderId === folderId) return { success: "Keine Änderung erforderlich." };
    await tx.update(attachments).set({ filename: name, folderId }).where(eq(attachments.id, att.id));
    await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
    await tx.insert(cardActivity).values({ cardId: card.id, userId: user.id, type: "attachment_organized", detail: `Datei organisiert: ${att.filename} → ${folder ? `${folder.name}/` : ""}${name}` });
    return { success: "Datei gespeichert." };
  });
  revalidatePath(`/intern/card/${card.id}`);
  return result;
}
