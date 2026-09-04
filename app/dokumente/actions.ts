// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";

import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { allowRequest } from "@/lib/rate-limit";
import { MarkdownDocumentError, readMarkdownDocument, resolveMarkdownDocument, saveMarkdownDocument, type MarkdownTarget } from "@/lib/markdown-documents";
import { saveProtocolAction } from "@/app/intern/protokolle/actions";
import { getProtocolMembers } from "@/lib/protocol-members";
import { getProtocolGuests } from "@/lib/protocol-guests";
import { uploadMarkdownImage } from "@/lib/markdown-image-upload";

export async function uploadDocumentImageAction(target: MarkdownTarget, data: FormData) {
  const user = await requireUser();
  if (!(await allowRequest(`document-image:${user.id}`, 30, 60_000))) return { error: "Zu viele Uploads. Bitte kurz warten." };
  const file = data.get("file");
  if (!(file instanceof File)) return { error: "Bitte ein Bild auswählen." };
  const result = await uploadMarkdownImage(user, target, file);
  if (result.reference) revalidatePath(`/intern/protokolle/${target.areaId}/sitzung/${target.sessionId}`);
  return result;
}

export async function saveDocumentAction(target: MarkdownTarget, content: string, replannedCardIds: number[] = []) {
  const user = await requireUser();
  if (!(await allowRequest(`document-save:${user.id}`, 60, 60_000))) return { error: "Zu viele Speicheranfragen. Bitte kurz warten." };
  try {
    const context = await resolveMarkdownDocument(user, target);
    const result = context.isProtocol
      ? await saveProtocolAction(target.areaId, target.sessionId, content, replannedCardIds, { path: context.path, fileId: context.file.fileId })
      : await saveMarkdownDocument(user, target, content);
    revalidatePath(`/intern/protokolle/${target.areaId}/sitzung/${target.sessionId}`);
    return result;
  } catch (error) { return { error: error instanceof MarkdownDocumentError ? error.message : "Die Datei konnte nicht gespeichert werden. Bitte Verbindung und Dateiliste prüfen." }; }
}

export async function reloadDocumentAction(target: MarkdownTarget) {
  const user = await requireUser();
  try {
    const document = await readMarkdownDocument(user, target);
    return { content: document.content, ...(document.isProtocol ? { members: await getProtocolMembers(target.areaId, target.sessionId), guests: await getProtocolGuests(target.areaId, target.sessionId) } : {}) };
  } catch (error) { return { error: error instanceof MarkdownDocumentError ? error.message : "Die Datei konnte nicht geladen werden. Bitte Verbindung und Dateiliste prüfen." }; }
}
