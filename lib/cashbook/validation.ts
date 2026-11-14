// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { sanitizeSingleLine } from "@/lib/text";
import { z } from "zod";
import { formatCents, MAX_AMOUNT_CENTS } from "@/lib/money";
import { purposeFields, type CashbookPayment } from "@/lib/cashbook-types";
export function validDate(value: string) { const d = new Date(value + "T12:00:00Z"); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; }
export function validIban(value: string) { const s = value.replace(/\s/g, "").toUpperCase(); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s))
    return false; const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55)); let r = 0; for (const d of digits)
    r = (r * 10 + Number(d)) % 97; return r === 1; }
const text = (max: number, required = true) => z.preprocess(sanitizeSingleLine, required ? z.string().min(1).max(max) : z.string().max(max));
export const signaturePlaceDateSchema = z.object({ place: text(200), date: z.string().refine(validDate) }).strict();
export const paymentSchema = z.object({ cardId: z.number().int().positive().nullable(), business: z.boolean(), number: z.string().max(200), receiptIds: z.array(z.number().int().positive()).max(100).refine(ids=>new Set(ids).size===ids.length), amount: z.number().int().min(0).max(MAX_AMOUNT_CENTS), budgetTitle: text(200), holder: text(200), iban: z.string().transform(s => s.replace(/\s/g, "").toUpperCase()).refine(validIban, "Bitte eine gültige IBAN eingeben."), bank: text(200), purpose: text(1000, false), place: text(200, false).default(""), date: z.string().refine(value => value === "" || validDate(value), "Bitte ein gültiges Datum auswählen.").default("") }).strict();
export function validatePayment(value: unknown): CashbookPayment {
    const result = paymentSchema.safeParse(value);
    if (!result.success) {
        const names: Record<string, string> = { budgetTitle: "Haushaltstitel", holder: "Kontoinhaber", bank: "Bank", place: "Ort", purpose: "Verwendungszweck" };
        const messages = result.error.issues.map(issue => { const key = String(issue.path[0] ?? ""); if (key === "iban")
            return "Bitte eine gültige IBAN eingeben."; if (key === "date")
            return "Bitte ein gültiges Datum auswählen."; if (key === "amount")
            return "Bitte einen gültigen Betrag zwischen 0,00 € und 20.000.000,00 € eingeben."; return names[key] ? `Bitte ${names[key]} vollständig ausfüllen und die zulässige Textlänge beachten.` : "Bitte einen gültigen Antrag und passende Quittungen auswählen."; });
        throw new Error([...new Set(messages)].join(" "));
    }
    return result.data;
}
export function renderPurpose(template: string, data: CashbookPayment, receipts: string[]) { return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => key === "receipts" ? receipts.map(name => name.replace(/\.[^.]+$/, "")).join(", ") : key === "amount" ? formatCents(data.amount) : Object.hasOwn(data, key) ? String(data[key as keyof CashbookPayment] ?? "") : "").replace(/\s+/g, " ").trim(); }
export function validPurpose(template: string) { return template.length <= 4000 && [...template.matchAll(/\{\{([^]*?)\}\}/g)].every(m => purposeFields.includes(m[1].trim() as typeof purposeFields[number])) && !/[{}]{2}/.test(template.replace(/\{\{[^]*?\}\}/g, "")); }
export const cashbookConfigSchema = z.object({ bookingNumbering:z.object({prefix:z.string().trim().min(1).max(30).refine(value=>!/[\x00-\x1f\x7f]/.test(value)),digits:z.number().int().min(1).max(12)}).strict().default({prefix:"B",digits:4}), speakerId: z.number().int().positive().nullable(), financeId: z.number().int().positive().nullable(), officeId: z.number().int().positive().nullable(), numbering: z.object({ prefix: z.string().max(40), year: z.string().max(40), code: z.string().max(40), separator: z.string().max(5), padding: z.number().int().min(0).max(12) }).strict(), sourceBoardIds: z.array(z.number().int().positive()).max(100), templatePath: z.string().max(500).nullable(), mapping: z.record(z.string().refine(key => ["amount", "holder", "iban", "bank", "purpose", "budgetTitle", "number", "speakerPlaceDate", "financePlaceDate"].includes(key)), z.string().max(500)), purposeTemplate: z.string().max(4000).refine(validPurpose) }).strict();
