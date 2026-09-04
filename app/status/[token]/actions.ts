"use server";

import { revalidatePath } from "next/cache";
import { PDF_MIME } from "@/lib/constants";
import { validateUpload } from "@/lib/attachments";
import { logActivity } from "@/lib/activity";
import { maybeArchive } from "@/lib/archive";
import { maybeSetTriggerDates } from "@/lib/instruction";
import { allowFormRequest } from "@/lib/rate-limit";
import { resolveApplicationCardId } from "@/lib/public-status";
import { storePublicAttachment, submitPublicWorkflow, PublicWorkflowError } from "@/lib/public-workflow";

export type PublicUploadState = { error?: string; success?: string };

export async function addPublicFileAction(token: string, _prev: PublicUploadState, formData: FormData): Promise<PublicUploadState> {
  if (!(await allowFormRequest("public-upload"))) return { error: "Zu viele Uploads. Bitte versuche es in einer Minute erneut." };
  const cardId = await resolveApplicationCardId(token);
  if (cardId == null) return { error: "Antrag nicht gefunden." };
  const purpose = formData.get("purpose") ?? "general";
  if (purpose !== "general" && purpose !== "resubmission" && purpose !== "receipt") return { error: "Ungültige Uploadart." };
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Bitte eine PDF-Datei auswählen." };
  const error = validateUpload(file, PDF_MIME);
  if (error) return { error };
  let filename: string;
  try { filename = await storePublicAttachment(cardId, purpose, file); }
  catch (e) {
    return { error: e instanceof PublicWorkflowError ? e.message : "Datei konnte nicht zugeordnet werden. Bitte erneut versuchen." };
  }
  // Committed uploads remain successful even if ancillary activity logging fails.
  try { await logActivity(cardId, null, "attachment_added", `Datei eingereicht (öffentlich, ${purpose}): ${filename}`); } catch { /* upload remains successful */ }
  revalidatePath(`/status/${token}`);
  return { success: `Hinzugefügt: ${filename}` };
}

export async function submitPublicAction(token: string, _prev: PublicUploadState, formData: FormData): Promise<PublicUploadState> {
  if (!(await allowFormRequest("public-submit"))) return { error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut." };
  const cardId = await resolveApplicationCardId(token);
  if (cardId == null) return { error: "Antrag nicht gefunden." };
  const purpose = formData.get("purpose");
  if (purpose !== "receipt" && purpose !== "resubmission") return { error: "Bitte den Einreichungsbereich auswählen." };
  try {
    const result = await submitPublicWorkflow(cardId, purpose);
    await logActivity(cardId, null, "status", purpose === "receipt" ? "Quittung eingereicht (öffentlich)" : "Nachreichung eingereicht (öffentlich)");
    if (result.target != null) {
      await maybeSetTriggerDates(cardId, result.target);
      await maybeArchive(cardId);
    }
    revalidatePath(`/status/${token}`);
    revalidatePath(`/intern/board/${result.boardId}`);
    return { success: "Eingereicht. Vielen Dank!" };
  } catch (e) {
    return { error: e instanceof PublicWorkflowError ? e.message : "Einreichen konnte nicht abgeschlossen werden. Bitte den Status prüfen." };
  }
}
