// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { CashbookFile } from "@/lib/cashbook-types";

export type CashbookActivityContext = {
    payment?: Record<string, unknown> | null;
    files?: Pick<CashbookFile, "kind" | "filename" | "sourceAttachmentId" | "sourceCardId">[];
};

const labels: Record<string, string> = {
    amount: "Betrag", budgetTitle: "Haushaltstitel", holder: "Kontoinhaber", iban: "IBAN",
    bank: "Bank", purpose: "Verwendungszweck", place: "Ort", date: "Datum",
    number: "Antrags-/Geschäftsbedarfsnummer", state: "Bearbeitungsstand", bookingDate: "Buchungstag",
    officeDone: "Bearbeitung durch die Bürokraft", secondSignerId: "Zweite unterschreibende Person",
    flagResolvedAt: "Rücksprache geklärt am", flagResolvedBy: "Rücksprache geklärt durch",
    flaggedBy: "Notfallmarkierung durch", flaggedAt: "Notfallmarkierung am", role: "Rolle",
    business: "Geschäftsbedarf", receiptIds: "Ausgewählte Quittungen", cardId: "Verknüpfter Antrag", accessLevel: "Freigabe",
};
const states: Record<string, string> = {
    draft: "Entwurf", submitted: "Zur Unterschrift vorgelegt", posted: "Anweisung erteilt",
    speaker: "Sprecher / Sprecherin", finance: "Finanzreferent / Finanzreferentin",
    read: "Lesender Zugriff", write: "Schreibender Zugriff",
};
const isEmpty = (value: unknown) => value == null || value === "" || Array.isArray(value) && value.length === 0;
const normalized = (value: unknown) => isEmpty(value) ? null : value;
function record(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function cashbookActivityChanges(detail: Record<string, unknown>) {
    const before = record(detail.before);
    const after = record(detail.after) ?? record(detail.data);
    const rows = Object.keys(labels).flatMap(key => {
        // The event's after object is a patch: missing keys mean unchanged, never deleted.
        if (!after || !Object.hasOwn(after, key)) return [];
        const hasBefore = !!before && Object.hasOwn(before, key);
        if (JSON.stringify(normalized(before?.[key])) === JSON.stringify(normalized(after[key]))) return [];
        return [{ key, label: labels[key], before: before?.[key], after: after[key], hasBefore }];
    });
    return { rows, comparison: rows.some(row => row.hasBefore), hasComparison: before != null && after != null };
}

export function formatCashbookActivityValue(key: string, value: unknown, people: Record<string, string>, context: CashbookActivityContext = {}): string {
    if (isEmpty(value)) {
        if (key === "bookingDate") return "Noch nicht eingetragen";
        if (key === "secondSignerId") return "Noch nicht zugewiesen";
        return "Nicht angegeben";
    }
    if (key === "cardId") {
        const number = context.payment?.cardId === value ? context.payment?.number : null;
        return typeof number === "string" && number.trim() ? number : "Antrag (Nummer nicht protokolliert)";
    }
    if (key === "receiptIds" && Array.isArray(value)) {
        return value.map(id => context.files?.find(file => file.kind === "receipt" && file.sourceAttachmentId === id
            && (context.payment?.cardId == null || file.sourceCardId === context.payment.cardId))?.filename
            ?? "Quittung (Dateiname nicht mehr verfügbar)").join("\n");
    }
    if (key === "officeDone" && typeof value === "boolean") return value ? "Erledigt" : "Noch zu erledigen";
    if (key === "amount" && typeof value === "number") return formatCents(value);
    if (["secondSignerId", "flaggedBy", "flagResolvedBy"].includes(key)) return people[String(value)] ?? `Person #${value}`;
    if (["flagResolvedAt", "flaggedAt"].includes(key) && typeof value === "string") return formatDateTime(value);
    if (["bookingDate", "date"].includes(key) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
        return new Date(`${value}T12:00:00Z`).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
    if (typeof value === "boolean") return value ? "Ja" : "Nein";
    if (Array.isArray(value)) return value.map(v => `#${v}`).join(", ");
    if (["state", "role", "accessLevel"].includes(key)) return states[String(value)] ?? String(value);
    return String(value);
}
