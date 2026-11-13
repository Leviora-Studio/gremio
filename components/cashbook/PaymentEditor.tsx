// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCashbookDraft } from "./DraftContext";
import { ReceiptPicker } from "./ReceiptPicker";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";
import { centsToInput, parseEuroToCents } from "@/lib/money";
import { paymentFields, type CashbookPayment, type CashbookRole } from "@/lib/cashbook-types";
import { draftCashbookAction, generateCashbookAction } from "@/app/intern/kassenbuch/actions";
export type Candidate = {
    id: number;
    label: string;
    number: string;
    receipts: {
        id: number;
        filename: string;
    }[];
};
export function PaymentFields({ value, onChange, disabled = false }: {
    value: CashbookPayment;
    onChange: (value: CashbookPayment) => void;
    disabled?: boolean;
}) { const [amount, setAmount] = useState(centsToInput(value.amount)); useEffect(() => { if (value.amount >= 0 && parseEuroToCents(amount) !== value.amount)
    setAmount(centsToInput(value.amount)); }, [value.amount, amount]); return <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">{paymentFields.map(field => <label key={field.key} className="min-w-0 text-sm">{field.label}{field.key === "date" ? <DatePicker value={value.date} onChange={date => onChange({ ...value, date })} portal/> : field.key === "amount" ? <input className="input mt-1" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); onChange({ ...value, amount: parseEuroToCents(e.target.value) ?? -1 }); }}/> : <input className="input mt-1" maxLength={field.key === "purpose" ? 1000 : 200} value={value[field.key]} onChange={e => onChange({ ...value, [field.key]: e.target.value })}/>}</label>)}</fieldset>; }
export function PaymentEditor({ bookId, entryId, revision, initial, role: initialRole, candidates, previewNumber, hasForm = false }: {
    hasForm?: boolean;
    bookId: number;
    entryId: number | null;
    revision: number;
    initial: CashbookPayment;
    role: CashbookRole | null;
    candidates: Candidate[];
    previewNumber: string;
}) {
    const draftState = useCashbookDraft();
    const [value, setRawValue] = useState(initial), [role, setRole] = useState<CashbookRole | "">(initialRole ?? ""), [error, setError] = useState(""), [pending, setPending] = useState(false);
    const router = useRouter();
    const candidate = candidates.find(c => c.id === value.cardId);
    function setValue(next: CashbookPayment) { setRawValue(next); draftState.setDirty(true); }
    useEffect(() => { if (!draftState.dirty)
        setRawValue(initial); }, [initial, draftState.dirty]);
    async function save(generate: boolean) { if (pending)
        return; if (!role) {
        setError("Bitte zuerst die eigene Rolle auswählen.");
        return;
    } setPending(true); setError(""); try {
        const result = await draftCashbookAction(bookId, entryId, revision, value, role);
        if (result.error) {
            setError(result.error);
            return;
        }
        if (result.id)
            draftState.setDirty(false);
        if (result.id && generate) {
            const created = await generateCashbookAction(result.id, entryId ? revision + 1 : 0);
            if (created.error) {
                setError(created.error);
                router.push(`/intern/kassenbuch/vorgang/${result.id}`);
                return;
            }
        }
        if (result.id) {
            router.push(`/intern/kassenbuch/vorgang/${result.id}`);
            router.refresh();
        }
    }
    catch {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    }
    finally {
        setPending(false);
    } }
    return <section data-live-refresh-managed data-live-refresh-dirty={draftState.dirty} data-live-refresh-block={draftState.dirty || pending} className="card space-y-5 p-5"><fieldset disabled={pending} className="space-y-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.business} onChange={e => setValue({ ...value, business: e.target.checked, cardId: null, receiptIds: [], number: e.target.checked ? previewNumber : "" })}/>Geschäftsbedarf</label><div><label className="label">Antrag auswählen</label><Select portal searchable disabled={value.business} value={value.cardId ? String(value.cardId) : ""} onChange={id => { const c = candidates.find(c => c.id === Number(id)); setValue({ ...value, cardId: c?.id ?? null, receiptIds: [], number: c?.number ?? "" }); }} options={[{ value: "", label: "Bitte Antrag auswählen" }, ...candidates.map(c => ({ value: String(c.id), label: c.label }))]}/></div>{value.business ? <p className="rounded-lg bg-slate-50 p-3 text-sm">Geschäftsbedarfsnummer: <strong>{entryId ? value.number : previewNumber}</strong>{!entryId && <span className="block text-xs text-slate-500">Vorschau – die Nummer wird beim Speichern verbindlich vergeben.</span>}</p> : <ReceiptPicker receipts={candidate?.receipts ?? []} selectedIds={value.receiptIds} onChange={receiptIds => setValue({ ...value, receiptIds })} hasApplication={!!candidate}/>}{!initialRole && <div><label className="label">In welcher Rolle bearbeitest du den Vorgang?</label><Select value={role} onChange={role => { setRole(role as CashbookRole); draftState.setDirty(true); }} options={[{ value: "", label: "Bitte eigene Rolle auswählen" }, { value: "speaker", label: "Sprecher / Sprecherin" }, { value: "finance", label: "Finanzreferent / Finanzreferentin" }]}/></div>}<PaymentFields value={value} onChange={setValue}/></fieldset><div className="flex flex-wrap gap-3"><button disabled={pending} className="btn-secondary" onClick={() => void save(false)}>Entwurf speichern</button><button disabled={pending} className="btn-primary" onClick={() => void save(true)}>{hasForm ? "Formular neu generieren" : "Anweisungsformular erstellen"}</button></div>{value.business && !entryId && <p className="text-sm text-slate-500">Speichere zunächst den Entwurf, um die Quittungen für den Geschäftsbedarf hochzuladen.</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</section>;
}
