// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { attachments, boards, cards, cardActivity } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canEditBoard } from "@/lib/authz";
import { deleteStoredFile, nextReceiptIndex, receiptFileName, saveAntragFile, validateUpload } from "@/lib/attachments";
import { lockApplicationCard } from "@/lib/card-lock";
import { PDF_MIME } from "@/lib/constants";
export async function lockCardAction(cardId: number, expectedStatusId: number) {
    const user = await requireUser();
    await lockApplicationCard(user, cardId, expectedStatusId);
    revalidatePath(`/intern/card/${cardId}`);
    revalidatePath("/intern/board", "layout");
}
export async function uploadReceiptAction(cardId: number, _prev: {
    error?: string;
    success?: string;
}, data: FormData) {
    const user = await requireUser();
    const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
    const [board] = card ? await db.select().from(boards).where(eq(boards.id, card.boardId)) : [];
    if (!card || !board || !await canEditBoard(user, board))
        return { error: "Kein Schreibzugriff." };
    if (board.attachmentFields != null && !board.attachmentFields.includes("receipts")) return {error:"Dieses Board hat keinen Quittungsbereich."};
    const file = data.get("file");
    if (!(file instanceof File))
        return { error: "Bitte eine Quittung auswählen." };
    const error = validateUpload(file, PDF_MIME);
    if (error)
        return { error };
    const saved = await saveAntragFile(card.id, file);
    try {
        await db.transaction(async (tx) => {
            const [fresh] = await tx.select().from(cards).where(eq(cards.id, card.id)).for("update");
            if (!fresh)
                throw new Error("Karte nicht verfügbar.");
            const existing = await tx.select({ filename: attachments.filename }).from(attachments).where(eq(attachments.cardId, card.id));
            const filename = receiptFileName(fresh.number, nextReceiptIndex(fresh.number, existing.map(a => a.filename)), saved.filename);
            await tx.insert(attachments).values({ cardId: card.id, kind: "other", uploadPurpose: "receipt", filename, path: saved.relPath, mime: saved.mime, size: saved.size, uploadedBy: user.id });
            await tx.insert(cardActivity).values({ cardId: card.id, userId: user.id, type: "attachment_added", detail: `Quittung hinzugefügt: ${filename}` });
            await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
        });
    }
    catch {
        await deleteStoredFile(saved.relPath);
        return { error: "Die Quittung konnte nicht gespeichert werden." };
    }
    revalidatePath(`/intern/card/${cardId}`);
    return { success: "Quittung hinzugefügt." };
}
