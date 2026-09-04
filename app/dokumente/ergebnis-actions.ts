// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";

import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { MarkdownDocumentError, type MarkdownTarget } from "@/lib/markdown-documents";
import { reloadResultProtocol, saveResultProtocol } from "@/lib/result-protocol-files";
import { revalidatePath } from "next/cache";

export async function saveResultProtocolAction(source: MarkdownTarget, resultFilename: string, expectedFileId: string | null | undefined, content: string) {
  const user = await requireUser();
  if (!(await allowRequest(`result-protocol-save:${user.id}`, 60, 60_000))) return { error: "Zu viele Speicheranfragen. Bitte kurz warten." };
  try {
    const result = await saveResultProtocol(user, source, resultFilename, expectedFileId, content);
    revalidatePath(`/intern/protokolle/${source.areaId}/sitzung/${source.sessionId}`);
    return result;
  } catch (error) {
    return { error: error instanceof MarkdownDocumentError ? error.message : "Das Ergebnisprotokoll konnte nicht gespeichert werden. Bitte Verbindung und Dateiliste prüfen." };
  }
}

export async function reloadResultProtocolAction(source: MarkdownTarget, resultFilename: string, expectedFileId: string | null) {
  const user = await requireUser();
  try { return await reloadResultProtocol(user, source, resultFilename, expectedFileId); }
  catch (error) { return { error: error instanceof MarkdownDocumentError ? error.message : "Das Ergebnisprotokoll konnte nicht geladen werden. Bitte Verbindung und Dateiliste prüfen." }; }
}
