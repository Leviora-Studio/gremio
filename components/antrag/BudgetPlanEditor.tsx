// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { saveBudgetPlanAction } from "@/app/intern/card/[id]/budget-plan-actions";
import { MAX_BUDGET_POSITIONS } from "@/lib/card-budget";
import { type BudgetPlanAllocation, type BudgetPlanDraft, budgetPlanMotionValues } from "@/lib/card-budget-plan";
import { centsToInput } from "@/lib/money";

const draftRows = (rows: BudgetPlanAllocation[]) => rows.map(row => ({ amount: centsToInput(row.amount), budgetTitle: row.budgetTitle }));
export function BudgetPlanEditor({ cardId, initial, revision, readOnly }: {
  cardId: number; initial: BudgetPlanAllocation[]; revision: number; readOnly: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BudgetPlanDraft[]>(() => draftRows(initial));
  const [savedRevision, setRevision] = useState(revision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (dirty || saving || revision < savedRevision) return;
    setRows(draftRows(initial)); setRevision(revision);
  }, [initial, revision, dirty, saving, savedRevision]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function change(next: BudgetPlanDraft[]) { setRows(next); setDirty(true); setMessage(""); }
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true; setSaving(true); setError(false); setMessage("");
    try {
      const result = await saveBudgetPlanAction(cardId, savedRevision, rows);
      if (result.error) { setError(true); setMessage(result.error); return; }
      if (result.revision != null) { setRevision(result.revision); setDirty(false); setMessage("Gespeichert."); router.refresh(); }
    } catch { setError(true); setMessage("Speichern fehlgeschlagen. Dein Entwurf bleibt erhalten."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <section className="card space-y-4 p-5" data-live-refresh-managed data-live-refresh-dirty={dirty} data-live-refresh-block={dirty || saving}>
    <h2 className="text-lg font-semibold">Haushaltstitel einplanen</h2>
    {initial.length > 0 && <p className="break-words text-sm">{budgetPlanMotionValues(initial).planned_budget}</p>}
    {!open && !readOnly && <button type="button" className="btn-secondary" onClick={() => { setOpen(true); if (!rows.length) change([{ amount: "", budgetTitle: "" }]); }}>Haushaltstitel einplanen</button>}
    {readOnly && !initial.length && <p className="text-sm text-slate-500">Noch keine Haushaltstitel eingeplant.</p>}
    {open && !readOnly && <>
      <p className="text-sm text-slate-500">Beträge und Titel für den Beschlussvorschlag. Mit „Einplanung speichern“ werden alle Zeilen gemeinsam gespeichert.</p>
      <fieldset disabled={saving} className="min-w-0 space-y-3">
        {rows.map((row, index) => <div key={index} className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_2fr_auto]">
          <label className="min-w-0 text-sm">Betrag (€)<input className="input mt-1" inputMode="decimal" value={row.amount} onChange={event => change(rows.map((r, i) => i === index ? { ...r, amount: event.target.value } : r))} /></label>
          <label className="min-w-0 text-sm">Haushaltstitel<input className="input mt-1" maxLength={200} value={row.budgetTitle} onChange={event => change(rows.map((r, i) => i === index ? { ...r, budgetTitle: event.target.value } : r))} /></label>
          <button type="button" className="btn-secondary self-end" aria-label={`Haushaltstitel ${index + 1} entfernen`} onClick={() => { if (row.amount || row.budgetTitle) setRemoveIndex(index); else change(rows.filter((_, i) => i !== index)); }}>Entfernen</button>
        </div>)}
        <button type="button" className="btn-secondary" disabled={rows.length >= MAX_BUDGET_POSITIONS} onClick={() => change([...rows, { amount: "", budgetTitle: "" }])}>Weiteren Titel hinzufügen</button>
        {rows.length >= MAX_BUDGET_POSITIONS && <p className="text-sm text-slate-500">Höchstens {MAX_BUDGET_POSITIONS} Titel je Karte.</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={saving || !dirty} className="btn-primary" onClick={() => void save()}>{saving ? "Speichert …" : "Einplanung speichern"}</button><span role="status" className={`text-sm ${error ? "text-red-600" : "text-slate-500"}`}>{message || (dirty ? "Noch nicht gespeichert" : "")}</span></div>
      <ConfirmDialog open={removeIndex != null} title="Einplanung entfernen" message="Diese Zeile aus der Einplanung entfernen? Die Änderung wird erst beim Speichern übernommen." confirmLabel="Entfernen" onClose={() => setRemoveIndex(null)} onConfirm={() => { change(rows.filter((_, i) => i !== removeIndex)); setRemoveIndex(null); }} />
    </>}
  </section>;
}
