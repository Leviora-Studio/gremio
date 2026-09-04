// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { uploadProtocolFile, saveProtocolPdf, type ProtocolUploadState } from "@/lib/protocol-file-writes";
import type { SavePdfInput, SavePdfResult } from "@/app/intern/card/[id]/pdf-actions";

export async function uploadProtocolFileAction(areaId: number, sessionId: number, folderName: string, _state: ProtocolUploadState, formData: FormData): Promise<ProtocolUploadState> {
  const user = await requireUser();
  if (!(await allowRequest(`protocol-upload:${user.id}`, 30, 60_000))) return { error: "Zu viele Uploads. Bitte kurz warten." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Bitte eine Datei auswählen." };
  const result = await uploadProtocolFile(user, areaId, sessionId, folderName, file);
  if (result.success) revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
  return result;
}

export async function saveProtocolPdfEditsAction(areaId: number, sessionId: number, folderName: string, filename: string, fileId: string | null, input: SavePdfInput): Promise<SavePdfResult> {
  const user = await requireUser();
  if (!(await allowRequest(`pdf-save:${user.id}`, 30, 60_000))) return { ok: false, error: "Zu viele Anfragen. Bitte kurz warten." };
  const result = await saveProtocolPdf(user, areaId, sessionId, folderName, filename, fileId, input);
  if (result.ok) revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
  return result;
}
