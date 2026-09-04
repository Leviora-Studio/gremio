// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { requireProtocolAreaManage } from "@/lib/protocols";
import { changeProtocolLogo, type ProtocolLogoResult } from "@/lib/protocol-logos";
import { exportProtocolPdf, type ProtocolExportInput } from "@/lib/protocol-export";

export async function changeProtocolLogoAction(areaId: number, form: FormData): Promise<ProtocolLogoResult> {
  const { user } = await requireProtocolAreaManage(areaId);
  if (!(await allowRequest(`protocol-logo:${user.id}`, 60, 60_000))) return { error: "Zu viele Logo-Änderungen. Bitte kurz warten." };
  try {
    const type = form.get("type");
    if (!["upload", "default", "remove"].includes(String(type))) return { error: "Ungültige Logo-Aktion." };
    const file = form.get("file");
    if (type === "upload" && !(file instanceof File)) return { error: "Bitte ein Logo auswählen." };
    const logos = await changeProtocolLogo(user, areaId, type === "upload" ? { type, file: file as File } : { type: type as "default" | "remove", logoId: Number(form.get("logoId")) });
    revalidatePath(`/intern/protokolle/${areaId}/einstellungen`);
    revalidatePath(`/intern/protokolle/${areaId}`, "layout");
    return { logos };
  } catch { return { error: "Logo konnte nicht geändert werden. Bitte Dateiformat (PNG/JPEG/WebP/GIF), Größe (maximal 5 MB / 16 Megapixel) und Bereichsrechte prüfen." }; }
}

export async function exportProtocolPdfAction(areaId: number, sessionId: number, folderName: string, sourceName: string, input: ProtocolExportInput) {
  const user = await requireUser();
  if (!(await allowRequest(`protocol-export:${user.id}`, 5, 60_000))) return { error: "Zu viele PDF-Exporte. Bitte kurz warten." };
  const result = await exportProtocolPdf(user, areaId, sessionId, folderName, sourceName, input);
  if (result.success) revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
  return result;
}
