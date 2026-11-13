// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/DatePicker";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FileInput } from "@/components/FileInput";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import { useCashbookDraft } from "./DraftContext";
import { PaymentFields } from "./PaymentEditor";
import { paymentFields, type CashbookPayment } from "@/lib/cashbook-types";
import { formatCents } from "@/lib/money";
import { todayInBerlin } from "@/lib/dates";
import { markCashbookInstructionIncorrectAction, prepareSecondCashbookSignatureAction, removeBusinessReceiptAction, correctCashbookAction, signCashbookAction, transitionCashbookAction, uploadBusinessReceiptAction, type CashbookActionState } from "@/app/intern/kassenbuch/actions";
export function EntryControls({ id, revision, state, data, canDraft, canSecond, canWrite, isOffice, officeDone, firstSigned, secondSigned, hasForm, hasCert, writers, defaultSecond, files, bookingDate, secondPreparation, canFlag, canResolveFlag }: {
    id: number;
    revision: number;
    state: string;
    data: CashbookPayment;
    canDraft: boolean;
    canSecond: boolean;
    canWrite: boolean;
    canFlag: boolean;
    canResolveFlag: boolean;
    isOffice: boolean;
    officeDone: boolean;
    firstSigned: boolean;
    secondSigned: boolean;
    hasForm: boolean;
    hasCert: boolean;
    writers: {
        id: number;
        name: string;
    }[];
    defaultSecond: number | null;
    files: {
        id: string;
        filename: string;
        mime: string;
        obsolete?: boolean;
        kind?: string;
    }[];
    bookingDate: string | null;
    secondPreparation?: { place: string; date: string; userId: number };
}) {
    const { dirty } = useCashbookDraft();
    const router = useRouter();
    const [error, setError] = useState(""), [pending, setPending] = useState(false), [second, setSecond] = useState(defaultSecond ? String(defaultSecond) : ""), [comment, setComment] = useState(""), [date, setDate] = useState(todayInBerlin()), [dialog, setDialog] = useState<"submit" | "authorize" | "return" | "date" | "correction" | "flag" | "resolveFlag" | null>(null), [correcting, setCorrecting] = useState(false), [corrected, setCorrected] = useState(data), [reason, setReason] = useState(""), [review, setReview] = useState(false), [confirmation, setConfirmation] = useState("");
    const [flagConfirmation, setFlagConfirmation] = useState("");
    const [flagReason, setFlagReason] = useState("");
    const [chooseSecond, setChooseSecond] = useState(false);
    const [secondPlace, setSecondPlace] = useState(secondPreparation?.place ?? "");
    const [secondDate, setSecondDate] = useState(secondPreparation?.date ?? todayInBerlin());
    const preparedMatches = !!secondPreparation && secondPlace === secondPreparation.place && secondDate === secondPreparation.date;
    async function prepareSignature() {
        if (pending) return;
        setPending(true); setError("");
        try {
            const result = await prepareSecondCashbookSignatureAction(id, revision, { place: secondPlace, date: secondDate });
            if (result.error) setError(result.error); else router.refresh();
        } finally { setPending(false); }
    }
    const [uploadState, uploadAction, uploadPending] = useActionState(uploadBusinessReceiptAction.bind(null, id, revision), {} as CashbookActionState);
    async function action(name: "submit" | "authorize" | "return" | "office" | "bookingDate" | "resolveFlag") { if (pending)
        return; setPending(true); setError(""); try {
        const result = await transitionCashbookAction(id, revision, name, { secondSignerId: Number(second) || undefined, comment, date, done: !officeDone });
        if (result.error)
            setError(result.error);
        else {
            setDialog(null);
            router.refresh();
        }
    }
    finally {
        setPending(false);
    } }
    const changed = paymentFields.filter(f => corrected[f.key] !== data[f.key]);
    return <div className="space-y-5">{canSecond && !secondSigned && <section className="card space-y-4 p-5"><h2 className="font-semibold">Ort und Datum der zweiten Unterschrift</h2><p className="text-sm text-slate-500">Trage deine eigenen Angaben ein und übernimm sie ins Formular. Anschließend kannst du das vorbereitete Formular ansehen und unterschreiben.</p><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Ort der zweiten Unterschrift<input className="input mt-1" value={secondPlace} maxLength={200} onChange={e => setSecondPlace(e.target.value)}/></label><div><p className="mb-1 text-sm">Datum der zweiten Unterschrift</p><DatePicker ariaLabel="Datum der zweiten Unterschrift" portal value={secondDate} onChange={setSecondDate}/></div></div><button className="btn-secondary" disabled={pending || !secondPlace.trim() || !secondDate || preparedMatches} onClick={() => void prepareSignature()}>Ort und Datum ins Formular übernehmen</button>{preparedMatches && <p role="status" className="text-sm text-green-700">Ort und Datum sind im Formular eingetragen. Du kannst jetzt unterschreiben.</p>}{error && <p role="alert" className="text-red-700">{error}</p>}</section>}<section className="card space-y-4 p-5"><div className="flex flex-wrap gap-3">{(canDraft || canSecond && (preparedMatches || secondSigned)) && hasForm && !dirty && <AttachmentLink id={id} filename="Anweisungsformular.pdf" mime="application/pdf" src={`/api/cashbook/${id}/file?revision=${revision}`} editable={canDraft || canSecond && !secondSigned} signOnly hasCert={hasCert} saveAction={async (input) => { const result = await signCashbookAction(id, revision, input); if (result.ok)
        router.refresh(); return result; }} label={canSecond && secondSigned ? "Formular ansehen" : "Formular ansehen und unterschreiben"}/>}{canDraft && <button disabled={!firstSigned || pending || dirty} className="btn-primary" onClick={() => setDialog("submit")}>Zur Unterschrift vorlegen</button>}{canSecond && <><button className="btn-secondary" onClick={() => setDialog("return")}>Zur Überarbeitung zurückgeben</button><button disabled={!secondSigned || pending} className="btn-primary" onClick={() => setDialog("authorize")}>Anweisung erteilen</button></>}{state === "posted" && canWrite && !bookingDate && <button className="btn-secondary" onClick={() => setDialog("date")}>Buchungstag festlegen</button>}{state === "posted" && canWrite && <button className="btn-secondary" onClick={() => setDialog("correction")}>Korrekturbuchung anlegen</button>}{canResolveFlag && <button className="btn-secondary" disabled={pending} onClick={() => setDialog("resolveFlag")}>Rücksprache geklärt</button>}{canFlag && <button className="btn-danger" onClick={() => { setFlagConfirmation(""); setDialog("flag"); }}>Anweisung als falsch markieren</button>}{state === "posted" && isOffice && <button className="btn-primary" disabled={pending} onClick={() => void action("office")}>{officeDone ? "Wieder als offen markieren" : "Als erledigt markieren"}</button>}<a className="btn-secondary" href={`/api/cashbook/${id}/zip`}>Alle Dateien als ZIP herunterladen</a></div>{dirty && <p className="text-sm text-amber-800">Bitte geänderte Angaben zuerst speichern und das Formular neu generieren. Unterschreiben und Vorlegen verwenden ausschließlich gespeicherte Werte.</p>}<p className="text-sm text-slate-500">{state === "draft" ? "Nach Änderungen müssen Formular und Unterschriften neu erstellt werden." : state === "submitted" ? "Zur Unterschrift vorgelegt: Inhalte und Unterlagen sind bis zu einer begründeten Rückgabe gesperrt." : "Gebucht: Die Buchungswerte sind unveränderlich. Änderungen erfolgen ausschließlich als verknüpfte Korrekturbuchung."}</p>{error && <p role="alert" className="text-red-700">{error}</p>}</section>
 {canDraft && data.business && <form noValidate action={uploadAction} className="card space-y-3 p-5"><h2 className="font-semibold">Quittungen für Geschäftsbedarf</h2><FileInput name="file" required accept="application/pdf,.pdf"/><button className="btn-secondary" disabled={uploadPending || dirty}>Quittung hochladen</button>{uploadState.error && <p role="alert" className="text-red-700">{uploadState.error}</p>}{uploadState.success && <p role="status" className="text-green-700">{uploadState.success}</p>}</form>}
 <section className="card space-y-3 p-5"><h2 className="font-semibold">Unterlagen</h2>{files.map(f => <div key={f.id} className={`rounded-lg border border-slate-200 p-3 ${f.obsolete ? "bg-slate-50 text-slate-500" : ""}`}><AttachmentLink id={id} filename={f.filename} mime={f.mime} src={`/api/cashbook/${id}/file?file=${f.id}`} editable={false}/>{f.obsolete && <span className="ml-2 text-xs">Früherer Stand</span>}{canDraft && data.business && f.kind === "receipt" && !f.obsolete && <button disabled={pending || dirty} className="btn-secondary ml-3" onClick={async () => {setPending(true);const result=await removeBusinessReceiptAction(id,revision,f.id);setPending(false);if(result.error)setError(result.error);else router.refresh();}}>Aus Entwurf entfernen</button>}</div>)}</section>
 <Modal portal manageFocus open={dialog === "submit"} onClose={() => setDialog(null)} title="Zur Unterschrift vorlegen"><div className="space-y-4">{error && <p role="alert" className="text-red-700">{error}</p>}<p className="text-sm">Mit der Übergabe werden alle Angaben und Unterlagen eingefroren. Die zweite Person ergänzt ihren eigenen Ort und ihr Datum, kann unterschreiben oder den Vorgang mit Begründung zurückgeben.</p><Select ariaLabel="Zweite unterschreibende Person" searchable portal disabled={!!defaultSecond && !chooseSecond} value={second} onChange={setSecond} options={[{ value: "", label: "Zweite unterschreibende Person auswählen" }, ...writers.map(u => ({ value: String(u.id), label: u.name }))]}/>{!!defaultSecond && !chooseSecond && <button type="button" className="btn-secondary" onClick={() => { setChooseSecond(true); setSecond(""); }}>Anderer Person zuweisen</button>}<button disabled={pending || !second} className="btn-primary" onClick={() => void action("submit")}>Verbindlich vorlegen</button></div></Modal>
 <Modal portal manageFocus open={dialog === "return"} onClose={() => setDialog(null)} title="Zur Überarbeitung zurückgeben">{error && <p role="alert" className="text-red-700">{error}</p>}<label className="block text-sm">Begründung (Pflichtfeld)<textarea className="input mt-1" rows={4} value={comment} onChange={e => setComment(e.target.value)} maxLength={4000}/></label><button disabled={pending || !comment.trim()} className="btn-primary mt-4" onClick={() => void action("return")}>Begründet zurückgeben</button></Modal>
 <Modal portal manageFocus open={dialog === "date"} onClose={() => setDialog(null)} title="Buchungstag verbindlich eintragen">{error && <p role="alert" className="text-red-700">{error}</p>}<p className="mb-4 text-sm">Dieser Tag kann nach dem Eintragen nicht mehr verändert werden.</p><DatePicker portal value={date} onChange={setDate}/><button disabled={pending || !date} className="btn-primary mt-4" onClick={() => void action("bookingDate")}>Buchungstag eintragen</button></Modal>
 <Modal portal manageFocus open={dialog === "flag"} onClose={() => setDialog(null)} title="Anweisung im Notfall als falsch markieren"><div className="space-y-4"><p className="text-sm text-red-800">Nur für den absoluten Notfall: Diese offene Anweisung wird für die Bürokraft rot hervorgehoben. Vor der Bearbeitung ist Rücksprache erforderlich. Die Markierung bleibt dokumentiert; Buchungswerte und Unterlagen werden dadurch weder geändert noch storniert.</p><label className="block text-sm">Hinweis für die Bürokraft (optional)<textarea className="input mt-1" rows={3} maxLength={4000} value={flagReason} onChange={e => setFlagReason(e.target.value)}/></label><label className="block text-sm">Zur Bestätigung MARKIEREN eingeben<input className="input mt-1" value={flagConfirmation} onChange={e => setFlagConfirmation(e.target.value)}/></label>{error && <p role="alert" className="text-red-700">{error}</p>}<div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn-secondary" onClick={() => setDialog(null)}>Abbrechen</button><button className="btn-danger" disabled={pending || flagConfirmation !== "MARKIEREN"} onClick={async () => { if(pending)return;setPending(true);setError("");try{const result=await markCashbookInstructionIncorrectAction(id,revision,flagConfirmation,flagReason);if(result.error)setError(result.error);else{setDialog(null);router.refresh();}}finally{setPending(false);} }}>Verbindlich als falsch markieren</button></div></div></Modal>
 <ConfirmDialog open={dialog === "resolveFlag"} onClose={() => setDialog(null)} title="Rücksprache als geklärt markieren" message="Ist die Rücksprache abgeschlossen? Der rote Hinweis verschwindet aus den Übersichten und den Vorgangsdetails. Markierung und Klärung bleiben im Aktivitätsverlauf dokumentiert; die Buchungswerte bleiben unverändert." confirmLabel="Rücksprache geklärt" disabled={pending} onConfirm={() => void action("resolveFlag")}/>
 <ConfirmDialog open={dialog === "authorize"} onClose={() => setDialog(null)} title="Anweisung erteilen" message="Diese Anweisung jetzt verbindlich buchen? Alle Werte und Unterlagen bleiben danach unveränderlich erhalten." confirmLabel="Anweisung erteilen" disabled={pending} onConfirm={() => void action("authorize")}/>
 <ConfirmDialog open={dialog === "correction"} onClose={() => setDialog(null)} title="Korrekturbuchung anlegen" message="Die Originalbuchung bleibt unverändert erhalten. Eine Korrekturbuchung wird zusätzlich gespeichert und muss begründet werden. Möchtest du fortfahren?" confirmLabel="Korrektur vorbereiten" onConfirm={() => { setDialog(null); setCorrecting(true); }}/>
 {correcting && <section className="card space-y-5 p-5"><h2 className="text-lg font-semibold">Korrekturbuchung zu Vorgang #{id}</h2><div className="grid gap-6 xl:grid-cols-2"><div className="rounded-lg bg-slate-100 p-4"><h3 className="mb-4 font-semibold">Unveränderliche Originalwerte</h3><dl className="space-y-3">{paymentFields.map(f => <div key={f.key}><dt className="text-sm text-slate-500">{f.label}</dt><dd className="break-all">{f.key === "amount" ? formatCents(data.amount) : data[f.key] || "—"}</dd></div>)}</dl></div><div><h3 className="mb-4 font-semibold">Neue Werte</h3><PaymentFields value={corrected} onChange={setCorrected}/></div></div><label className="block text-sm">Begründung (Pflichtfeld)<textarea rows={4} className="input mt-1" value={reason} onChange={e => setReason(e.target.value)} maxLength={4000}/></label><button className="btn-primary" disabled={!reason.trim() || !changed.length} onClick={() => setReview(true)}>Korrekturbuchung prüfen</button></section>}
 <Modal portal manageFocus open={review} onClose={() => setReview(false)} title="Korrekturbuchung verbindlich bestätigen"><div className="space-y-4">{error && <p role="alert" className="text-red-700">{error}</p>}<p className="text-sm">Die folgenden Werte ändern sich. Die Originalbuchung und alle früheren Korrekturen bleiben erhalten.</p><dl className="space-y-3">{changed.map(f => <div key={f.key} className="rounded bg-slate-50 p-3"><dt className="font-semibold">{f.label}</dt><dd className="break-all text-sm">Vorher: {f.key==="amount"?formatCents(data.amount):String(data[f.key]) || "—"}<br />Nachher: {f.key==="amount"?formatCents(corrected.amount):String(corrected[f.key]) || "—"}</dd></div>)}</dl><p className="break-words text-sm">Begründung: {reason}</p><label className="block text-sm">Zur Bestätigung BESTÄTIGEN eingeben<input className="input mt-1" value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label><button className="btn-primary" disabled={pending || confirmation !== "BESTÄTIGEN"} onClick={async () => { setPending(true); const result = await correctCashbookAction(id, revision, corrected, reason, confirmation); setPending(false); if (result.error)
        setError(result.error);
    else if (result.id)
        router.push(`/intern/kassenbuch/vorgang/${result.id}`); }}>Korrekturbuchung endgültig anlegen</button></div></Modal>
 </div>;
}
