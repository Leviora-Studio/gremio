// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { formDocuments } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { FORM_DOC_EXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { deleteStoredFile, formDocMime, saveNamedFile } from "@/lib/attachments";

export type State = { error?: string; success?: string };

export async function uploadFormDocumentAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Keine Datei ausgewählt." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `Datei zu groß (max. ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`,
    };
  }
  const lower = file.name.toLowerCase();
  if (!FORM_DOC_EXT.some((e) => lower.endsWith(e))) {
    return {
      error: `Dateityp nicht erlaubt. Zulässig: ${FORM_DOC_EXT.join(", ")}`,
    };
  }

  const saved = await saveNamedFile("form-documents", file);
  const [row] = await db.select({ m: max(formDocuments.position) }).from(formDocuments);
  await db.insert(formDocuments).values({
    filename: saved.filename,
    path: saved.relPath,
    // MIME aus der (whitelisted) Endung — NICHT dem Browser-Typ vertrauen.
    mime: formDocMime(saved.filename),
    size: saved.size,
    position: (row?.m ?? -1) + 1,
  });
  revalidatePath("/admin/formular");
  revalidatePath("/");
  return { success: `„${saved.filename}" hinzugefügt.` };
}

export async function deleteFormDocumentAction(id: number): Promise<void> {
  await requireAdmin();
  const [doc] = await db
    .select()
    .from(formDocuments)
    .where(eq(formDocuments.id, id))
    .limit(1);
  if (!doc) return;
  await db.delete(formDocuments).where(eq(formDocuments.id, id));
  await deleteStoredFile(doc.path);
  revalidatePath("/admin/formular");
  revalidatePath("/");
}
