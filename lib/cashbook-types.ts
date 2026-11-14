// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import type { NumberingConfig } from "./numbering";
export type CashbookRole = "speaker" | "finance";
export type CashbookConfig = {
    speakerId: number | null;
    financeId: number | null;
    officeId: number | null;
    numbering: NumberingConfig;
    bookingNumbering: {prefix:string;digits:number};
    sourceBoardIds: number[];
    templatePath: string | null;
    mapping: Record<string, string>;
    purposeTemplate: string;
};
export const defaultCashbookConfig: CashbookConfig = { speakerId: null, financeId: null, officeId: null, bookingNumbering:{prefix:"B",digits:4}, numbering: { prefix: "G", year: "", code: "", separator: "_", padding: 3 }, sourceBoardIds: [], templatePath: null, mapping: {}, purposeTemplate: "{{purpose}} {{number}} HT{{budgetTitle}}" };
export type CashbookPayment = {
    cardId: number | null;
    business: boolean;
    number: string;
    receiptIds: number[];
    amount: number;
    budgetTitle: string;
    holder: string;
    iban: string;
    bank: string;
    purpose: string;
    place: string;
    date: string;
};
export const paymentFields = [{ key: "amount", label: "Betrag" }, { key: "budgetTitle", label: "Haushaltstitel" }, { key: "holder", label: "Kontoinhaber" }, { key: "iban", label: "IBAN" }, { key: "bank", label: "Bank" }, { key: "purpose", label: "Verwendungszweck (optional)" }] as const;
export type CashbookFile = {
    id: string;
    filename: string;
    path: string;
    mime: string;
    sha256: string;
    kind: "application" | "receipt" | "form" | "prepared" | "signed";
    signatureDetails?: { place: string; date: string; userId: number };
    sourceCardId?:number;
    sourceAttachmentId?:number;
    secondPlaceDate?: {
        page: number;
        xRatio: number;
        yRatio: number;
        wRatio: number;
        hRatio: number;
    }[];
    obsolete?: boolean;
    role?: CashbookRole;
};
export const purposeFields = ["purpose", "number", "receipts", "amount", "budgetTitle", "holder", "iban", "bank", "place", "date"] as const;

/** A resolved warning remains in the audit history, but is no longer actionable. */
export function hasOpenCashbookFlag(entry: { flaggedAt: Date | string | null; flagResolvedAt: Date | string | null }): boolean {
    return !!entry.flaggedAt && !entry.flagResolvedAt;
}
