// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {snapshotCashbookSources,mergeSourceSnapshots,verifyCashbookFiles} from "./source-files";
import { sanitizeMultiLine, sanitizeSingleLine } from "@/lib/text";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, cards, cashbooks, cashbookAccess, cashbookEntries, cashbookActivity, users, groups, type User } from "@/lib/db/schema";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { buildCardNumber } from "@/lib/numbering";
import { defaultCashbookConfig, type CashbookConfig, type CashbookPayment, type CashbookRole } from "@/lib/cashbook-types";
import { cashbookWriters, requireCashbook, requireCashbookEntry } from "./access";
import { cashbookConfigSchema, validDate, validPurpose, validatePayment } from "./validation";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function activity(tx: Tx, user: User, bookId: number, entryId: number | null, type: string, detail: Record<string, unknown>) { await tx.insert(cashbookActivity).values({ cashbookId: bookId, entryId, userId: user.id, type, detail }); }
export async function createCashbook(user: User, name: string) { name = sanitizeSingleLine(name); if (user.role !== "admin" || !user.isActive)
    throw new Error("Nur Administrationskonten dürfen Kassenbücher erstellen."); if (!name.trim() || name.length > 120)
    throw new Error("Bitte einen Namen mit höchstens 120 Zeichen eingeben."); return db.transaction(async (tx) => { const [book] = await tx.insert(cashbooks).values({ name: name.trim(), ownerId: user.id, config: defaultCashbookConfig }).returning(); await activity(tx, user, book.id, null, "created", { name: book.name }); return book.id; }); }
export async function saveCashbookConfig(user: User, id: number, revision: number, config: CashbookConfig) { config = cashbookConfigSchema.parse(config); const mappingValues = Object.values(config.mapping).filter(Boolean); if (new Set(mappingValues).size !== mappingValues.length)
    throw new Error("Jedes PDF-Feld darf nur einmal zugeordnet werden."); const { book } = await requireCashbook(user, id, "manage"); if (config.officeId && !(await db.select({ id: users.id }).from(users).where(and(eq(users.id, config.officeId), eq(users.isActive, true)))).length)
    throw new Error("Bitte eine aktive Person als Bürokraft auswählen."); const writers = await cashbookWriters(book); if ([config.speakerId, config.financeId].some(id => id != null && !writers.some(u => u.id === id)))
    throw new Error("Rollen erfordern aktuellen Schreibzugriff."); if (config.speakerId && config.speakerId === config.financeId)
    throw new Error("Die beiden Rollen müssen unterschiedliche Personen sein."); if (!validPurpose(config.purposeTemplate))
    throw new Error("Ungültige Verwendungszweck-Vorlage."); if (config.sourceBoardIds.length > 100)
    throw new Error("Zu viele Antragsboards."); for (const boardId of config.sourceBoardIds) {
    const source = await getBoardById(boardId);
    if (!source?.isApplicationBoard || !await canAccessBoard(user, source))
        throw new Error("Bitte nur zugängliche Antragsboards auswählen.");
} await db.transaction(async (tx) => { const [current] = await tx.select().from(cashbooks).where(eq(cashbooks.id, id)).for("update"); if (current.revision !== revision)
    throw new Error("Einstellungen wurden zwischenzeitlich geändert."); await tx.update(cashbooks).set({ config, revision: revision + 1 }).where(eq(cashbooks.id, id)); await activity(tx, user, id, null, "settings", { before: current.config, after: config }); }); }
export async function saveCashbookGrant(user: User, id: number, kind: "user" | "group", subjectId: number, access: "read" | "write" | "remove") { await requireCashbook(user, id, "manage"); const [subject] = kind === "user" ? await db.select({ name: users.username }).from(users).where(eq(users.id, subjectId)) : await db.select({ name: groups.name }).from(groups).where(eq(groups.id, subjectId)); if (!subject)
    throw new Error("Die Person oder Gruppe ist nicht verfügbar."); await db.transaction(async (tx) => { await tx.select({ id: cashbooks.id }).from(cashbooks).where(eq(cashbooks.id, id)).for("update"); const field = kind === "user" ? cashbookAccess.userId : cashbookAccess.groupId; const where = and(eq(cashbookAccess.cashbookId, id), eq(field, subjectId)); const before = await tx.select().from(cashbookAccess).where(where); await tx.delete(cashbookAccess).where(where); if (access !== "remove")
    await tx.insert(cashbookAccess).values({ cashbookId: id, ...(kind === "user" ? { userId: subjectId } : { groupId: subjectId }), accessLevel: access }); await activity(tx, user, id, null, "sharing", { kind, subjectId, subjectName: subject.name, before, after: access }); }); }
async function validateSource(user: User, book: typeof cashbooks.$inferSelect, data: CashbookPayment) {
    if (data.business) {
        if (data.cardId != null || data.receiptIds.length)
            throw new Error("Geschäftsbedarf kann keinem Antrag zugeordnet werden.");
        return;
    }
    const [card] = data.cardId == null ? [] : await db.select().from(cards).where(eq(cards.id, data.cardId));
    const board = card ? await getBoardById(card.boardId) : null;
    if (!card?.lockedAt || !board || !board.isApplicationBoard || !book.config.sourceBoardIds.includes(board.id) || !await canAccessBoard(user, board))
        throw new Error("Bitte einen gesperrten Antrag eines zugeordneten Antragsboards auswählen.");
    const receipts = await db.select().from(attachments).where(and(eq(attachments.cardId, card.id), eq(attachments.uploadPurpose, "receipt")));
    if (!data.receiptIds.length || data.receiptIds.some(id => !receipts.some(r => r.id === id)))
        throw new Error("Bitte vorhandene Quittungen dieses Antrags auswählen.");
}
export async function saveCashbookDraft(user: User, bookId: number, entryId: number | null, revision: number, raw: unknown, chosenRole: CashbookRole) {
    const { book } = await requireCashbook(user, bookId, "write");
    const data = validatePayment(raw);
    await validateSource(user, book, data);
    const snapshots=await snapshotCashbookSources(user,book,data);
    return db.transaction(async (tx) => {
        const [currentBook] = await tx.select().from(cashbooks).where(eq(cashbooks.id, bookId)).for("update");
        await requireCashbook(user, bookId, "write");
        await validateSource(user, currentBook, data);
        const role = currentBook.config.speakerId === user.id ? "speaker" : currentBook.config.financeId === user.id ? "finance" : chosenRole;
        if (!["speaker", "finance"].includes(role))
            throw new Error("Bitte die eigene Rolle auswählen.");
        if (entryId != null) {
            const [entry] = await tx.select().from(cashbookEntries).where(and(eq(cashbookEntries.id, entryId), eq(cashbookEntries.cashbookId, bookId))).for("update");
            if (!entry || entry.creatorId !== user.id || entry.state !== "draft" || entry.revision !== revision)
                throw new Error("Der Entwurf ist nicht mehr bearbeitbar oder wurde geändert.");
            if (data.business !== entry.data.business || data.cardId !== entry.data.cardId) {
                if (data.business) {
                    data.number = buildCardNumber(currentBook.config.numbering, currentBook.nextNumber);
                    await tx.update(cashbooks).set({ nextNumber: currentBook.nextNumber + 1 }).where(eq(cashbooks.id, bookId));
                }
                else {
                    const [source] = await tx.select().from(cards).where(eq(cards.id, data.cardId!));
                    data.number = source.number ?? String(source.id);
                }
            }
            else
                data.number = entry.data.number;
            await tx.update(cashbookEntries).set({ data, revision: revision + 1, firstSignedAt: null, secondSignedAt: null, files: mergeSourceSnapshots(entry.files,snapshots,data.business&&entry.data.business), role }).where(eq(cashbookEntries.id, entryId));
            await activity(tx, user, bookId, entryId, "edited", { before: entry.data, after: data });
            return entryId;
        }
        if (data.business) {
            data.number = buildCardNumber(currentBook.config.numbering, currentBook.nextNumber);
            await tx.update(cashbooks).set({ nextNumber: currentBook.nextNumber + 1 }).where(eq(cashbooks.id, bookId));
        }
        else {
            const [card] = await tx.select().from(cards).where(eq(cards.id, data.cardId!));
            data.number = card.number ?? String(card.id);
        }
        const [entry] = await tx.insert(cashbookEntries).values({ cashbookId: bookId, creatorId: user.id, data, role, files:snapshots }).returning();
        await activity(tx, user, bookId, entry.id, "created", { data, role, files:snapshots.map(f=>({id:f.id,filename:f.filename,sha256:f.sha256,kind:f.kind})) });
        return entry.id;
    });
}
export async function transitionCashbook(user: User, id: number, revision: number, action: "submit" | "return" | "authorize" | "office" | "bookingDate" | "resolveFlag", options: {
    secondSignerId?: number;
    comment?: string;
    date?: string;
    done?: boolean;
}) {
    const { book, permission, entry:sourceEntry } = await requireCashbookEntry(user, id);
    if(action==="submit"||action==="authorize")await verifyCashbookFiles(sourceEntry.files);
    return db.transaction(async (tx) => {
        await tx.select({ id: cashbooks.id }).from(cashbooks).where(eq(cashbooks.id, book.id)).for(action === "authorize" ? "update" : "share");
        const liveAccess = await requireCashbook(user, book.id);
        if (liveAccess.permission !== permission || liveAccess.book.revision !== book.revision)
            throw new Error("Die Kassenbuchrechte wurden geändert. Bitte neu laden.");
        const writers = await cashbookWriters(liveAccess.book);
        const [entry] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id, id)).for("update");
        if (entry.revision !== revision)
            throw new Error("Der Vorgang wurde zwischenzeitlich geändert. Bitte neu laden.");
        const writable = ["manage", "write"].includes(permission);
        let update: Partial<typeof cashbookEntries.$inferInsert> = { revision: revision + 1 };
        if (action === "submit") {
            if (!writable || entry.creatorId !== user.id || entry.state !== "draft" || !entry.firstSignedAt)
                throw new Error("Bitte zuerst das aktuelle Formular unterschreiben.");
            const configured = entry.role === "speaker" ? book.config.financeId : book.config.speakerId;
            const second = options.secondSignerId ?? (configured && writers.some(u => u.id === configured) ? configured : undefined);
            if (!second || second === user.id || !writers.some(u => u.id === second))
                throw new Error("Bitte eine andere schreibberechtigte Person für die zweite Unterschrift auswählen.");
            update = { ...update, state: "submitted", secondSignerId: second };
        }
        else if (action === "return") {
            if (!writable || entry.state !== "submitted" || entry.secondSignerId !== user.id || !options.comment?.trim())
                throw new Error("Zurückgeben erfordert die zugewiesene zweite Person und eine Begründung.");
            update = { ...update, state: "draft", firstSignedAt: null, secondSignedAt: null, files: entry.files.map(f => ["receipt","application"].includes(f.kind) ? f : { ...f, obsolete: true }) };
        }
        else if (action === "authorize") {
            if (!writable || entry.state !== "submitted" || entry.secondSignerId !== user.id || !entry.firstSignedAt || !entry.secondSignedAt)
                throw new Error("Nur die zugewiesene zweite Person kann nach beiden Unterschriften die Anweisung erteilen.");
            update = { ...update, state: "posted", authorizedAt: new Date() };
        }
        else if (action === "office") {
            if (entry.state !== "posted" || entry.correctsId != null || book.config.officeId !== user.id || typeof options.done !== "boolean")
                throw new Error("Nur die zugewiesene Bürokraft kann Anweisungen abhaken.");
            update = { ...update, officeDone: options.done };
        }
        else if (action === "resolveFlag") {
            if ((!writable && liveAccess.book.config.officeId !== user.id) || entry.state !== "posted" || entry.correctsId != null || !entry.flaggedAt || entry.flagResolvedAt)
                throw new Error("Nur Schreibberechtigte und die zugewiesene Bürokraft können eine offene Rücksprache als geklärt markieren.");
            update = { ...update, flagResolvedAt: new Date(), flagResolvedBy: user.id };
        }
        else {
            if (!writable || entry.state !== "posted" || entry.bookingDate || !options.date || !validDate(options.date))
                throw new Error("Der Buchungstag kann nur einmal für einen gebuchten Vorgang festgelegt werden.");
            update = { ...update, bookingDate: options.date };
        }
        await tx.update(cashbookEntries).set(update).where(eq(cashbookEntries.id, id));
        await activity(tx, user, book.id, id, action, { before: { state: entry.state, bookingDate: entry.bookingDate, officeDone: entry.officeDone, secondSignerId: entry.secondSignerId }, after: update, comment: options.comment ?? null });
    });
}
export async function correctCashbookEntry(user: User, id: number, revision: number, raw: unknown, reason: string, confirmation: string) { const { entry, book } = await requireCashbookEntry(user, id); await requireCashbook(user, book.id, "write"); if (!reason.trim() || reason.length > 4000 || confirmation !== "BESTÄTIGEN")
    throw new Error("Bitte die Korrektur begründen und BESTÄTIGEN eingeben."); const data = validatePayment(raw); if (!["amount", "budgetTitle", "holder", "iban", "bank", "purpose"].some(key => data[key as keyof CashbookPayment] !== entry.data[key as keyof CashbookPayment]))
    throw new Error("Bitte mindestens einen Buchungswert ändern."); data.place = entry.data.place; data.date = entry.data.date; data.number = entry.data.number; data.cardId = entry.data.cardId; data.business = entry.data.business; data.receiptIds = entry.data.receiptIds; return db.transaction(async (tx) => { await tx.select({ id: cashbooks.id }).from(cashbooks).where(eq(cashbooks.id, book.id)).for("update"); await requireCashbook(user, book.id, "write"); const [fresh] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id, id)).for("update"); if (fresh.state !== "posted" || fresh.revision !== revision)
    throw new Error("Die Originalbuchung wurde geändert."); const [existing] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.correctsId, id)); if (existing)
    throw new Error("Bitte die jüngste Korrekturbuchung auswählen."); const [created] = await tx.insert(cashbookEntries).values({ cashbookId: book.id, creatorId: user.id, state: "posted", data, role: fresh.role, files: fresh.files, authorizedAt: new Date(), correctsId: id, correctionReason: reason.trim() }).returning(); await activity(tx, user, book.id, created.id, "correction", { originalId: id, before: fresh.data, after: data, reason }); return created.id; }); }

/** An emergency warning is organizational metadata; it never rewrites accounting values. */
export async function markCashbookInstructionIncorrect(user: User, id: number, revision: number, confirmation: string, reason = "") {
    if (confirmation !== "MARKIEREN") throw new Error("Bitte zur Bestätigung MARKIEREN eingeben.");
    if (typeof reason !== "string" || reason.length > 4000) throw new Error("Der Hinweis darf höchstens 4000 Zeichen enthalten.");
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Bitte den Vorgang neu laden.");
    const note = sanitizeMultiLine(reason).trim() || null;
    const { book } = await requireCashbookEntry(user, id);
    await requireCashbook(user, book.id, "write");
    await db.transaction(async tx => {
        await tx.select({id:cashbooks.id}).from(cashbooks).where(eq(cashbooks.id,book.id)).for("share");
        await requireCashbook(user,book.id,"write");
        const [entry] = await tx.select().from(cashbookEntries).where(eq(cashbookEntries.id,id)).for("update");
        if (!entry || entry.revision !== revision) throw new Error("Der Vorgang wurde inzwischen geändert. Bitte neu laden.");
        if (entry.state !== "posted" || entry.correctsId != null || entry.officeDone || entry.flaggedAt) throw new Error("Nur noch offene, nicht markierte Originalanweisungen können als falsch markiert werden.");
        const flaggedAt = new Date();
        await tx.update(cashbookEntries).set({ flaggedAt, flaggedBy:user.id, flagReason:note, revision:revision+1 }).where(eq(cashbookEntries.id,id));
        await activity(tx,user,book.id,id,"emergency_flag",{after:{flaggedAt:flaggedAt.toISOString(),flaggedBy:user.id},comment:note});
    });
}
