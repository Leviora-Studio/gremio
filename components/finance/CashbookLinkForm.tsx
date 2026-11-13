// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState } from "react";
import { Select } from "@/components/Select";
import { linkFinanceCashbookAction, financeSourceAccountAction } from "@/app/finanzen/cashbook-actions";
export function CashbookLinkForm({ id, bookId, books }: {
    id: number;
    bookId: number | null;
    books: {
        id: number;
        name: string;
    }[];
}) { const [state, action, pending] = useActionState(linkFinanceCashbookAction.bind(null, id), {} as {
    error?: string;
    success?: string;
}); return <form action={action} onReset={e => e.preventDefault()} className="space-y-3"><p className="text-sm text-slate-500">Tatsächliche Ausgaben stammen aus diesem Kassenbuch. Vor Zahlungsabschluss werden in der Live-Ansicht die eingeplanten Beträge je Haushaltstitel berücksichtigt, danach die Buchungen.</p><Select portal searchable name="cashbookId" defaultValue={bookId ? String(bookId) : ""} options={[{ value: "", label: "Kein Kassenbuch (bisherige Berechnung)" }, ...books.map(b => ({ value: String(b.id), label: b.name }))]}/><button disabled={pending} className="btn-primary">Speichern</button><p role="status" className="text-sm">{state.error ?? state.success}</p></form>; }
export function SourceAccountForm({ id, boardId, accountId, accounts }: {
    id: number;
    boardId: number;
    accountId: number | null;
    accounts: {
        id: number;
        name: string;
    }[];
}) { const [state, action, pending] = useActionState(financeSourceAccountAction.bind(null, id, boardId), {} as {
    error?: string;
    success?: string;
}); return <form action={action} onReset={e => e.preventDefault()} className="mt-3 space-y-2"><label className="label">Konto für dieses Antragsboard</label><Select portal name="accountId" defaultValue={accountId ? String(accountId) : ""} options={[{ value: "", label: "Bisherige betroffene Konten verwenden" }, ...accounts.map(a => ({ value: String(a.id), label: a.name }))]}/><button className="btn-secondary" disabled={pending}>Konto speichern</button><p role="status" className="text-sm">{state.error ?? state.success}</p></form>; }
