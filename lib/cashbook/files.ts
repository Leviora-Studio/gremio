// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@/lib/db";
import { cashbooks, cashbookEntries, type User } from "@/lib/db/schema";
import { absPath, deleteStoredFile, saveNamedBuffer } from "@/lib/attachments";
import { decryptUserCert, inspectP12 } from "@/lib/cert";
import { signPdf, signPdfIncremental, appendPdfTextIncremental, type SignPlacement } from "@/lib/sign";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { readPdfFields, sanitizeWinAnsi } from "@/lib/pdf-edit";
import type { CashbookFile } from "@/lib/cashbook-types";
import { requireCashbook, requireCashbookEntry } from "./access";
import { renderPurpose, validatePayment, signaturePlaceDateSchema } from "./validation";
import {verifyCashbookFiles} from "./source-files";
import { activity } from "./service";
export async function storeCashbookFile(bookId: number, entryId: number, bytes: Buffer, filename: string, kind: CashbookFile["kind"]): Promise<CashbookFile> { const saved = await saveNamedBuffer(`cashbooks/${bookId}/${entryId}`, filename, bytes, "application/pdf"); return { id: randomUUID(), filename, path: saved.relPath, mime: saved.mime, sha256: createHash("sha256").update(bytes).digest("hex"), kind }; }
export async function generateCashbookPdf(user: User, id: number, revision: number) {
    const { entry, book } = await requireCashbookEntry(user, id);
    await requireCashbook(user, book.id, "write");
    if (entry.creatorId !== user.id || entry.state !== "draft" || entry.revision !== revision)
        throw new Error("Der Entwurf wurde geändert oder ist gesperrt.");
    const data = validatePayment(entry.data);
    await verifyCashbookFiles(entry.files.filter(f=>f.kind==="application"||f.kind==="receipt"));
    if (!book.config.templatePath)
        throw new Error("Bitte zuerst ein Anweisungsformular in den Kassenbucheinstellungen hinterlegen.");
    const template = await readFile(absPath(book.config.templatePath));
    const requiredMapping = ["amount", "holder", "iban", "bank", "purpose", "speakerPlaceDate", "financePlaceDate"];
    if (requiredMapping.some(key => !book.config.mapping[key]))
        throw new Error("Bitte alle Pflichtfelder der PDF-Vorlage zuordnen, einschließlich beider Ort-/Datumsfelder.");
    if (data.business && !entry.files.some(f => f.kind === "receipt" && !f.obsolete))
        throw new Error("Bitte mindestens eine Quittung für den Geschäftsbedarf hochladen.");
    const templateFields = await readPdfFields(template);
    const secondField = templateFields.find(f => f.name === book.config.mapping[entry.role === "speaker" ? "financePlaceDate" : "speakerPlaceDate"]);
    if (!secondField?.rect || secondField.page == null)
        throw new Error("Das zweite Ort-/Datumsfeld muss auf einer PDF-Seite positioniert sein.");
    const secondPlaceDate = secondField.widgets?.length ? secondField.widgets.map(w => ({ page: w.page, ...w.rect })) : [{ page: secondField.page, ...secondField.rect }];
    const document = await PDFDocument.load(template);
    const form = document.getForm();
    const receipts = entry.files.filter(f=>f.kind==="receipt"&&!f.obsolete);
    if(!data.business&&(!entry.files.some(f=>f.kind==="application"&&!f.obsolete)||data.receiptIds.some(id=>!receipts.some(f=>f.sourceAttachmentId===id))))throw new Error("Bitte den Entwurf erneut speichern, damit Antrags-PDF und Quittungen ins Kassenbuch kopiert werden.");
    const values: Record<string, string> = { [entry.role === "speaker" ? "financePlaceDate" : "speakerPlaceDate"]: "", amount: formatCents(data.amount), holder: data.holder, iban: data.iban, bank: data.bank, purpose: renderPurpose(book.config.purposeTemplate, data, receipts.map(r => r.filename)), budgetTitle: data.budgetTitle, number: data.number, [entry.role === "speaker" ? "speakerPlaceDate" : "financePlaceDate"]: `${data.place}, ${data.date.split("-").reverse().join(".")}` };
    for (const [key, field] of Object.entries(book.config.mapping)) {
        if (field && key in values)
            form.getTextField(field).setText(sanitizeWinAnsi(values[key]));
    }
    const font = await document.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
    form.flatten();
    const newFiles: CashbookFile[] = [];
    try {
        const generated = await storeCashbookFile(book.id, id, Buffer.from(await document.save({ useObjectStreams: false })), `${data.number}_Anweisung.pdf`, "form");
        generated.secondPlaceDate = secondPlaceDate;
        newFiles.push(generated);
        await db.transaction(async (tx) => { const [liveBook] = await tx.select().from(cashbooks).where(eq(cashbooks.id, book.id)).for("share"); if (liveBook.revision !== book.revision)
            throw new Error("Die Kassenbucheinstellungen wurden geändert. Bitte erneut versuchen."); await requireCashbook(user, book.id, "write"); const [current] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id, id)).for("update"); if (current.revision !== revision || current.state !== "draft")
            throw new Error("Der Entwurf wurde während der Erstellung geändert."); await tx.update(cashbookEntries).set({ files: [...current.files.map(f => ["application","receipt"].includes(f.kind) ? f : { ...f, obsolete: true }), ...newFiles], firstSignedAt: null, secondSignedAt: null, revision: revision + 1 }).where(eq(cashbookEntries.id, id)); await activity(tx, user, book.id, id, "generated", { files: newFiles.map(f => ({ id: f.id, filename: f.filename, sha256: f.sha256 })) }); });
    }
    catch (error) {
        for (const file of newFiles)
            await deleteStoredFile(file.path);
        throw error;
    }
}
/** Only signature-specific details may be added to a submitted, frozen payment. */
export async function prepareSecondCashbookSignature(user: User, id: number, revision: number, raw: unknown) {
    const { entry, book } = await requireCashbookEntry(user, id);
    await requireCashbook(user, book.id, "write");
    if (entry.state !== "submitted" || entry.secondSignerId !== user.id || !entry.firstSignedAt || entry.secondSignedAt || entry.revision !== revision)
        throw new Error("Die zweite Unterschrift ist nicht zur Vorbereitung freigegeben.");
    const parsed = signaturePlaceDateSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Bitte Ort und ein gültiges Datum für die eigene Unterschrift eingeben.");
    const source = entry.files.filter(f => f.kind === "signed" && f.role === entry.role && !f.obsolete).at(-1);
    const positions = entry.files.find(f => f.kind === "form" && !f.obsolete)?.secondPlaceDate;
    if (!source || !positions?.length) throw new Error("Das Ort-/Datumsfeld ist nicht verfügbar. Bitte zur Überarbeitung zurückgeben und das Formular neu erstellen lassen.");
    const bytes = await readFile(absPath(source.path));
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error("Die gespeicherte Datei wurde verändert.");
    const details = { ...parsed.data, userId: user.id };
    const prepared = await appendPdfTextIncremental(bytes, positions.map(placement => ({ placement, text: `${details.place}, ${details.date.split("-").reverse().join(".")}` })));
    const file = await storeCashbookFile(book.id, id, prepared, `${entry.data.number}_Anweisung_2_vorbereitet.pdf`, "prepared");
    file.signatureDetails = details;
    try {
        await db.transaction(async tx => {
            const [liveBook] = await tx.select().from(cashbooks).where(eq(cashbooks.id, book.id)).for("share");
            if (liveBook.revision !== book.revision) throw new Error("Die Kassenbucheinstellungen wurden geändert. Bitte neu laden.");
            await requireCashbook(user, book.id, "write");
            const [current] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id, id)).for("update");
            if (current.state !== "submitted" || current.secondSignerId !== user.id || current.secondSignedAt || current.revision !== revision) throw new Error("Der Vorgang wurde inzwischen geändert.");
            await tx.update(cashbookEntries).set({ files: [...current.files.map(f => f.kind === "prepared" ? { ...f, obsolete: true } : f), file], revision: revision + 1 }).where(eq(cashbookEntries.id, id));
            await activity(tx, user, book.id, id, "signature_prepared", { after: parsed.data, fileId: file.id, sha256: file.sha256 });
        });
    } catch (error) {
        await deleteStoredFile(file.path);
        throw error;
    }
}

export async function signCashbookPdf(user: User, id: number, revision: number, placement: SignPlacement) {
    const { entry, book } = await requireCashbookEntry(user, id);
    await requireCashbook(user, book.id, "write");
    const first = entry.state === "draft" && entry.creatorId === user.id, second = entry.state === "submitted" && entry.secondSignerId === user.id;
    if (!first && !second || entry.revision !== revision || second && (!entry.firstSignedAt || !!entry.secondSignedAt))
        throw new Error("Diese Unterschrift ist nicht freigegeben.");
    const source = second ? entry.files.filter(f => f.kind === "prepared" && !f.obsolete && f.signatureDetails?.userId === user.id).at(-1) : entry.files.find(f => f.kind === "form" && !f.obsolete);
    if (!source)
        throw new Error(second ? "Bitte zuerst den eigenen Ort und das Datum ins Formular übernehmen." : "Bitte zuerst das Formular erstellen.");
    const cert = decryptUserCert(user);
    if (!cert)
        throw new Error("Bitte ein Signaturzertifikat im Konto hinterlegen.");
    const info = inspectP12(cert.p12, cert.passphrase);
    const now = new Date();
    if (now < info.notBefore || now > info.notAfter)
        throw new Error("Das Signaturzertifikat ist zeitlich nicht gültig.");
    if (!placement || !Number.isInteger(placement.page) || placement.page < 0 || [placement.xRatio, placement.yRatio, placement.wRatio, placement.hRatio].some(v => !Number.isFinite(v) || v < 0 || v > 1))
        throw new Error("Ungültiger Signaturbereich.");
    const bytes = await readFile(absPath(source.path));
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
        throw new Error("Die gespeicherte Datei stimmt nicht mit dem dokumentierten Stand überein.");
    const opts = { ...cert, signerName: user.certSubject?.trim() || user.name || user.username, dateLabel: formatDateTime(now), placement };
    const signed = await (second ? signPdfIncremental : signPdf)(bytes, opts);
    const file = await storeCashbookFile(book.id, id, signed, `${entry.data.number}_Anweisung_${second ? "2" : "1"}_signiert.pdf`, "signed");
    if (second) file.signatureDetails = source.signatureDetails;
    file.role = first ? entry.role : entry.role === "speaker" ? "finance" : "speaker";
    try {
        await db.transaction(async (tx) => { const [liveBook] = await tx.select().from(cashbooks).where(eq(cashbooks.id, book.id)).for("share"); if (liveBook.revision !== book.revision)
            throw new Error("Die Kassenbucheinstellungen wurden geändert. Bitte erneut versuchen."); await requireCashbook(user, book.id, "write"); const [current] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id, id)).for("update"); if (current.revision !== revision || current.state !== entry.state || second && (current.secondSignerId !== user.id || !!current.secondSignedAt))
            throw new Error("Der Vorgang wurde während der Unterschrift geändert."); await tx.update(cashbookEntries).set({ files: [...current.files, file], ...(first ? { firstSignedAt: now } : { secondSignedAt: now }), revision: revision + 1 }).where(eq(cashbookEntries.id, id)); await activity(tx, user, book.id, id, "signed", { role: file.role, fileId: file.id, sha256: file.sha256, ...(file.signatureDetails ? { after: { place: file.signatureDetails.place, date: file.signatureDetails.date } } : {}) }); });
    }
    catch (error) {
        await deleteStoredFile(file.path);
        throw error;
    }
}
