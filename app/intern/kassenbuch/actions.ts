// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cashbooks, cashbookEntries } from "@/lib/db/schema";
import { absPath, deleteStoredFile, saveNamedBuffer, validateUpload, receiptFileName } from "@/lib/attachments";
import { PDF_MIME } from "@/lib/constants";
import { readPdfFields } from "@/lib/pdf-edit";
import type { CashbookConfig, CashbookRole } from "@/lib/cashbook-types";
import { requireCashbook, requireCashbookEntry } from "@/lib/cashbook/access";
import { createCashbook, saveCashbookConfig, saveCashbookDraft, saveCashbookGrant, transitionCashbook, correctCashbookEntry, markCashbookInstructionIncorrect, activity } from "@/lib/cashbook/service";
import { generateCashbookPdf, signCashbookPdf, prepareSecondCashbookSignature, storeCashbookFile } from "@/lib/cashbook/files";
import type { SavePdfInput, SavePdfResult } from "@/app/intern/card/[id]/pdf-actions";
export type CashbookActionState = {
    error?: string;
    success?: string;
    id?: number;
    fields?: string[];
};
function refresh() { revalidatePath("/intern/kassenbuch", "layout"); }
async function run(action: () => Promise<number | void>): Promise<CashbookActionState> { try {
    const id = await action();
    refresh();
    return { success: "Gespeichert.", ...(id ? { id } : {}) };
}
catch (error) {
    return { error: error instanceof z.ZodError ? "Bitte alle Einstellungen prüfen: Eine Eingabe ist ungültig oder zu lang." : error instanceof Error && !("cause" in error) ? error.message : "Speichern fehlgeschlagen. Bitte aktualisieren und erneut versuchen." };
} }
export async function createCashbookAction(_previous: CashbookActionState, data: FormData) { const user = await requireUser(); return run(() => createCashbook(user, String(data.get("name") ?? ""))); }
export async function configCashbookAction(id: number, revision: number, config: CashbookConfig) { const user = await requireUser(); const { book } = await requireCashbook(user, id, "manage"); return run(() => saveCashbookConfig(user, id, revision, { ...config, templatePath: book.config.templatePath })); }
export async function grantCashbookAction(id: number, kind: "user" | "group", subjectId: number, access: "read" | "write" | "remove") { const user = await requireUser(); if (!["user", "group"].includes(kind) || !["read", "write", "remove"].includes(access) || !Number.isSafeInteger(subjectId) || subjectId < 1)
    return { error: "Ungültige Freigabe." }; return run(() => saveCashbookGrant(user, id, kind, subjectId, access)); }
export async function draftCashbookAction(bookId: number, id: number | null, revision: number, data: unknown, role: CashbookRole) { const user = await requireUser(); return run(() => saveCashbookDraft(user, bookId, id, revision, data, role)); }
export async function transitionCashbookAction(id: number, revision: number, action: "submit" | "return" | "authorize" | "office" | "bookingDate" | "resolveFlag", options: {
    secondSignerId?: number;
    comment?: string;
    date?: string;
    done?: boolean;
}) { const user = await requireUser(); if (!["submit", "return", "authorize", "office", "bookingDate", "resolveFlag"].includes(action))
    return { error: "Ungültige Aktion." }; return run(() => transitionCashbook(user, id, revision, action, options)); }
export async function correctCashbookAction(id: number, revision: number, data: unknown, reason: string, confirmation: string) { const user = await requireUser(); return run(() => correctCashbookEntry(user, id, revision, data, reason, confirmation)); }
export async function generateCashbookAction(id: number, revision: number) { const user = await requireUser(); return run(() => generateCashbookPdf(user, id, revision)); }
export async function prepareSecondCashbookSignatureAction(id: number, revision: number, details: unknown) {
  const user = await requireUser();
  return run(() => prepareSecondCashbookSignature(user, id, revision, details));
}
export async function signCashbookAction(id: number, revision: number, input: SavePdfInput): Promise<SavePdfResult> { const user = await requireUser(); if (!input.signature || input.edits?.fields?.length || input.edits?.texts?.length)
    return { ok: false, error: "Dieses Formular darf ausschließlich unterschrieben werden." }; try {
    await signCashbookPdf(user, id, revision, input.signature.placement);
    refresh();
    return { ok: true, attachmentId: id, signed: true };
}
catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unterschrift fehlgeschlagen." };
} }
export async function uploadCashbookTemplateAction(id: number, revision: number, _previous: CashbookActionState, data: FormData): Promise<CashbookActionState> { const user = await requireUser(); const { book } = await requireCashbook(user, id, "manage"); const file = data.get("file"); if (!(file instanceof File))
    return { error: "Bitte ein PDF auswählen." }; const invalid = validateUpload(file, PDF_MIME); if (invalid)
    return { error: invalid }; const bytes = Buffer.from(await file.arrayBuffer()); try {
    await PDFDocument.load(bytes);
}
catch {
    return { error: "Die PDF-Vorlage ist nicht lesbar." };
} const saved = await saveNamedBuffer(`cashbooks/${id}/templates`, "Anweisungsvorlage.pdf", bytes, "application/pdf"); const result = await run(() => saveCashbookConfig(user, id, revision, { ...book.config, templatePath: saved.relPath, mapping: {} })); if (result.error)
    await deleteStoredFile(saved.relPath); return result; }
export async function cashbookTemplateFieldsAction(id: number) { const { book } = await requireCashbook(await requireUser(), id, "manage"); return book.config.templatePath ? (await readPdfFields(await readFile(absPath(book.config.templatePath)))).filter(f => f.type === "text").map(f => f.name) : []; }
export async function uploadBusinessReceiptAction(id: number, revision: number, _previous: CashbookActionState, data: FormData) { const user = await requireUser(); const { entry, book } = await requireCashbookEntry(user, id); await requireCashbook(user, book.id, "write"); if (entry.creatorId !== user.id || entry.state !== "draft" || !entry.data.business || entry.revision !== revision)
    return { error: "Der Geschäftsbedarfsentwurf ist nicht bearbeitbar." }; const file = data.get("file"); if (!(file instanceof File))
    return { error: "Bitte eine Quittung auswählen." }; const invalid = validateUpload(file, PDF_MIME); if (invalid)
    return { error: invalid }; const stored = await storeCashbookFile(book.id, id, Buffer.from(await file.arrayBuffer()), receiptFileName(entry.data.number, entry.files.filter(f => f.kind === "receipt").length + 1, file.name), "receipt"); const result = await run(async () => { await db.transaction(async (tx) => { await tx.select({id:cashbooks.id}).from(cashbooks).where(eq(cashbooks.id,book.id)).for("share");await requireCashbook(user,book.id,"write");const [fresh] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id, id)).for("update"); if (fresh.state !== "draft" || fresh.revision !== revision)
    throw new Error("Der Vorgang wurde geändert."); await tx.update(cashbookEntries).set({ files: [...fresh.files.map(f => f.kind === "receipt" ? f : { ...f, obsolete: true }), stored], firstSignedAt: null, secondSignedAt: null, revision: revision + 1 }).where(eq(cashbookEntries.id, id)); await activity(tx, user, book.id, id, "receipt_uploaded", { filename: stored.filename, sha256: stored.sha256 }); }); }); if (result.error)
    await deleteStoredFile(stored.path); return result; }

export async function removeBusinessReceiptAction(id: number, revision: number, fileId: string) {
  const user = await requireUser();
  const { entry, book } = await requireCashbookEntry(user, id);
  await requireCashbook(user, book.id, "write");
  if (entry.creatorId !== user.id || !entry.data.business) return { error: "Dieser Quittungsentwurf ist nicht bearbeitbar." };
  return run(async () => {
    await db.transaction(async tx => {
      await tx.select({id:cashbooks.id}).from(cashbooks).where(eq(cashbooks.id,book.id)).for("share");
      await requireCashbook(user,book.id,"write");
      const [current] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id, id)).for("update");
      if (current.state !== "draft" || current.revision !== revision) throw new Error("Der Vorgang wurde geändert oder bereits vorgelegt.");
      const receipt = current.files.find(file => file.id === fileId && file.kind === "receipt" && !file.obsolete);
      if (!receipt) throw new Error("Die Quittung ist nicht mehr verfügbar.");
      await tx.update(cashbookEntries).set({ files: current.files.map(file => file.id === fileId || file.kind !== "receipt" ? { ...file, obsolete: true } : file), firstSignedAt: null, secondSignedAt: null, revision: revision + 1 }).where(eq(cashbookEntries.id, id));
      await activity(tx, user, book.id, id, "receipt_removed", { filename: receipt.filename, fileId });
    });
  });
}

export async function markCashbookInstructionIncorrectAction(id: number, revision: number, confirmation: string, reason: string) {
  const user = await requireUser();
  return run(() => markCashbookInstructionIncorrect(user,id,revision,confirmation,reason));
}
