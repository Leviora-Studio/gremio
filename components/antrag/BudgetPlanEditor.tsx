// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { saveBudgetPlanAction } from "@/app/intern/card/[id]/budget-plan-actions";
import { MAX_BUDGET_POSITIONS } from "@/lib/card-budget";
import { type BudgetPlanAllocation, type BudgetPlanDraft, parseBudgetPlan } from "@/lib/card-budget-plan";
import { centsToInput, formatCents } from "@/lib/money";
import type { AccountOption } from "@/lib/accounts";

export function BudgetPlanEditor({ cardId, initial, revision, readOnly, locked, accounts, defaultAccountId }: {
  cardId:number; initial:BudgetPlanAllocation[]; revision:number; readOnly:boolean; locked:boolean;
  accounts:AccountOption[]; defaultAccountId:number|null;
}) {
  const router=useRouter();
  const draftRows=(items:BudgetPlanAllocation[])=>items.map(row=>({amount:centsToInput(row.amount),budgetTitle:row.budgetTitle,accountId:row.accountId ?? defaultAccountId}));
  const [open,setOpen]=useState(false),[rows,setRows]=useState<BudgetPlanDraft[]>(()=>draftRows(initial));
  const [savedRevision,setRevision]=useState(revision),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false);
  const [message,setMessage]=useState(""),[error,setError]=useState(false),[removeIndex,setRemoveIndex]=useState<number|null>(null);
  const [accountChange,setAccountChange]=useState<{index:number;accountId:number|null}|null>(null);
  const [startCorrection,setStartCorrection]=useState(false),[review,setReview]=useState(false),[reason,setReason]=useState(""),[confirmation,setConfirmation]=useState("");
  const [changes,setChanges]=useState<{label:string;before:string;after:string}[]>([]);
  const inFlight=useRef(false);
  useEffect(()=>{if(!dirty&&!saving&&revision>=savedRevision){setRows(initial.map(row=>({amount:centsToInput(row.amount),budgetTitle:row.budgetTitle,accountId:row.accountId??defaultAccountId})));setRevision(revision);}},[initial,revision,dirty,saving,savedRevision,defaultAccountId]);
  useEffect(()=>{const handler=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);},[dirty]);
  const accountName=(id:number|null|undefined)=>accounts.find(a=>a.id===id)?.name??"Nicht angegeben";
  function change(next:BudgetPlanDraft[]){setRows(next);setDirty(true);setMessage("");}
  const addRow=()=>change([...rows,{amount:"",budgetTitle:"",accountId:defaultAccountId}]);
  function begin(){setOpen(true);setMessage("");if(!rows.length)addRow();}
  function preview(){
    try{
      if(!reason.trim())throw new Error("Bitte die Korrektur begründen.");
      const next=parseBudgetPlan(rows);
      if(next.some(row=>!row.accountId))throw new Error("Bitte für jede Zeile ein Konto auswählen.");
      const differences:{label:string;before:string;after:string}[]=[];
      for(let index=0;index<Math.max(initial.length,next.length);index++){
        const before=initial[index],after=next[index];
        for(const key of ["amount","accountId","budgetTitle"] as const){
          const old=before?.[key],value=after?.[key];
          if(old===value)continue;
          const display=(item:BudgetPlanAllocation|undefined)=>!item?"Keine Zeile":key==="amount"?formatCents(item.amount):key==="accountId"?accountName(item.accountId):item.budgetTitle;
          differences.push({label:`Zeile ${index+1} · ${key==="amount"?"Betrag":key==="accountId"?"Konto":"Haushaltstitel"}`,before:display(before),after:display(after)});
        }
      }
      if(!differences.length)throw new Error("Bitte mindestens einen Betrag, ein Konto oder einen Haushaltstitel ändern.");
      setChanges(differences);setConfirmation("");setReview(true);setMessage("");setError(false);
    }catch(problem){setError(true);setMessage(problem instanceof Error?problem.message:"Bitte die Eingaben prüfen.");}
  }
  async function save(){
    if(inFlight.current)return;
    inFlight.current=true;setSaving(true);setError(false);setMessage("");
    try{
      const result=await saveBudgetPlanAction(cardId,savedRevision,rows,{confirmAccountChange:true,...(locked?{correction:{reason,confirmation}}:{})});
      if(result.error){setError(true);setMessage(result.error);return;}
      if(result.revision!=null){setRevision(result.revision);setDirty(false);setReview(false);setOpen(false);setReason("");setMessage(locked?"Korrektureintrag gespeichert.":"Einplanung gespeichert.");router.refresh();}
    }catch{setError(true);setMessage("Speichern fehlgeschlagen. Dein Entwurf bleibt erhalten.");}
    finally{inFlight.current=false;setSaving(false);}
  }
  function cancel() {
    if (saving) return;
    setRows(draftRows(initial));setOpen(false);setReview(false);setDirty(false);
    setReason("");setConfirmation("");setMessage("");
  }
  const total = initial.reduce((sum, row) => sum + row.amount, 0);
  function summary(items:BudgetPlanAllocation[], muted=false) {
    return items.length ? <ol className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {items.map((row,index)=><li key={index} className={`space-y-2 p-4 ${muted?"bg-slate-50":""}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-slate-600">Haushaltstitel {row.budgetTitle}</span>
          <span className="font-semibold tabular-nums text-slate-900">{formatCents(row.amount)}</span>
        </div>
        <p className="break-words text-sm text-slate-500">Konto: {accountName(row.accountId)}</p>
      </li>)}
    </ol> : <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">Noch keine Haushaltstitel eingeplant.</p>;
  }
  const editor = <fieldset disabled={saving} className="min-w-0 space-y-4">
    {rows.map((row,index)=><div key={index} className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">Position {index+1}</h4>
        <button type="button" className="text-sm text-slate-500 hover:text-red-700" aria-label={`Haushaltstitel ${index+1} entfernen`} onClick={()=>setRemoveIndex(index)}>Entfernen</button>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm">Betrag (€)<input aria-label={`Betrag Zeile ${index+1}`} className="input mt-1 tabular-nums" inputMode="decimal" value={row.amount} onChange={event=>change(rows.map((r,i)=>i===index?{...r,amount:event.target.value}:r))}/></label>
        <label className="min-w-0 text-sm">Haushaltstitel<input aria-label={`Haushaltstitel Zeile ${index+1}`} className="input mt-1" maxLength={200} value={row.budgetTitle} onChange={event=>change(rows.map((r,i)=>i===index?{...r,budgetTitle:event.target.value}:r))}/></label>
      </div>
      <div className="min-w-0"><p className="mb-1 text-sm">Konto</p><Select portal searchable ariaLabel={`Konto Zeile ${index+1}`} value={row.accountId?String(row.accountId):""} options={[{value:"",label:"Bitte Konto auswählen"},...accounts.map(account=>({value:String(account.id),label:account.name}))]} onChange={value=>{const id=value?Number(value):null;if(id!==row.accountId)setAccountChange({index,accountId:id});}}/></div>
    </div>)}
    <button type="button" className="btn-secondary w-full border-dashed" disabled={rows.length>=MAX_BUDGET_POSITIONS} onClick={addRow}>Weiteren Titel hinzufügen</button>
  </fieldset>;
  const actions = <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
    <button type="button" disabled={saving} className="btn-secondary" onClick={cancel}>Abbrechen</button>
    <button type="button" disabled={saving||!dirty} className="btn-primary" onClick={()=>locked?preview():void save()}>{saving?"Wird gespeichert …":locked?"Korrektureintrag prüfen":"Einplanung speichern"}</button>
  </div>;
  return <section className="card space-y-4 p-5" data-live-refresh-managed data-live-refresh-dirty={dirty} data-live-refresh-block={dirty||saving||open}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold">Haushaltstitel einplanen</h2>
      {!!initial.length&&<span className="text-sm text-slate-600">Gesamt: <strong className="font-semibold tabular-nums text-slate-900">{formatCents(total)}</strong></span>}
    </div>
    {summary(initial)}
    {(!open||locked)&&!readOnly&&<button type="button" className="btn-secondary" onClick={()=>locked?setStartCorrection(true):begin()}>{locked?"Korrektureintrag anlegen":"Haushaltstitel einplanen"}</button>}
    {open&&!readOnly&&!locked&&<div className="space-y-4">{editor}{actions}</div>}
    {message&&!open&&<p role={error?"alert":"status"} className={`whitespace-pre-wrap text-sm ${error?"text-red-700":"text-slate-600"}`}>{message}</p>}
    {open&&!locked&&message&&<p role={error?"alert":"status"} className="text-sm text-red-700">{message}</p>}
    <ConfirmDialog open={startCorrection} title="Korrektureintrag anlegen" message="Die Karte bleibt gesperrt. Du kannst ausschließlich die eingeplanten Beträge, Konten und Haushaltstitel korrigieren. Die bisherigen Werte bleiben mit Begründung und Person nachvollziehbar erhalten." confirmLabel="Korrektur vorbereiten" onClose={()=>setStartCorrection(false)} onConfirm={()=>{setStartCorrection(false);begin();}}/>
    <Modal portal manageFocus open={open&&locked&&!readOnly&&!review} onClose={()=>{if(!saving)setOpen(false);}} title="Einplanung korrigieren" maxWidth="max-w-6xl">
      <div className="space-y-6">
        <p className="text-sm leading-relaxed text-slate-600">Vergleiche die bisherige Einplanung mit deinen neuen Angaben. Die gesperrte Karte und der bisherige Stand bleiben erhalten. Anschließend prüfst und bestätigst du die Änderungen.</p>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[2fr_3fr]">
          <div className="min-w-0 space-y-3"><div><h3 className="font-semibold">Bisherige Einplanung</h3><p className="mt-1 text-sm text-slate-500">Unveränderlicher Ausgangsstand · {formatCents(total)}</p></div>{summary(initial,true)}</div>
          <div className="min-w-0 space-y-3"><div><h3 className="font-semibold">Neue Einplanung</h3><p className="mt-1 text-sm text-slate-500">Beträge, Konten und Titel hier korrigieren.</p></div>{editor}</div>
        </div>
        <label className="block text-sm font-medium">Begründung (Pflichtfeld)<textarea disabled={saving} rows={3} maxLength={4000} className="input mt-2 font-normal" placeholder="Was wird korrigiert und warum?" value={reason} onChange={event=>{setReason(event.target.value);setDirty(true);}}/></label>
        {message&&<p role="alert" className="text-sm text-red-700">{message}</p>}
        {actions}
      </div>
    </Modal>
    <ConfirmDialog open={accountChange!=null} title="Konto ändern" message={`Konto für diese Zeile wirklich von „${accountName(accountChange==null?null:rows[accountChange.index]?.accountId)}“ zu „${accountName(accountChange?.accountId)}“ ändern?`} confirmLabel="Konto wechseln" onClose={()=>setAccountChange(null)} onConfirm={()=>{if(accountChange)change(rows.map((row,index)=>index===accountChange.index?{...row,accountId:accountChange.accountId}:row));setAccountChange(null);}}/>
    <ConfirmDialog open={removeIndex!=null} title="Einplanung entfernen" message="Diese Zeile entfernen? Die Änderung wird erst beim Speichern übernommen." confirmLabel="Entfernen" onClose={()=>setRemoveIndex(null)} onConfirm={()=>{change(rows.filter((_,index)=>index!==removeIndex));setRemoveIndex(null);}}/>
    <Modal portal manageFocus open={review} onClose={()=>{if(!saving)setReview(false);}} title="Korrektureintrag verbindlich bestätigen" maxWidth="max-w-4xl">
      <div className="space-y-5">
        <p className="text-sm text-slate-600">Nur die folgenden Angaben ändern sich. Der bisherige Stand bleibt vollständig im Verlauf erhalten.</p>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="hidden grid-cols-3 gap-4 bg-slate-50 px-4 py-3 text-sm font-semibold sm:grid"><span>Geänderte Angabe</span><span>Vorher</span><span>Nachher</span></div>
          <dl className="divide-y divide-slate-200">{changes.map((item,index)=><div key={index} className="grid gap-3 p-4 text-sm sm:grid-cols-3 sm:gap-4"><dt className="font-medium">{item.label}</dt><dd className="min-w-0 break-words text-slate-500"><span className="mb-1 block text-xs font-medium sm:hidden">Vorher</span>{item.before}</dd><dd className="min-w-0 break-words font-medium text-slate-900"><span className="mb-1 block text-xs text-slate-500 sm:hidden">Nachher</span>{item.after}</dd></div>)}</dl>
        </div>
        <div className="rounded-lg bg-slate-50 p-4"><h3 className="text-sm font-semibold">Begründung</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{reason}</p></div>
        <label className="block text-sm">Zur Bestätigung BESTÄTIGEN eingeben<input disabled={saving} autoComplete="off" className="input mt-2" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>
        {error&&message&&<p role="alert" className="text-sm text-red-700">{message}</p>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4"><button type="button" className="btn-secondary" disabled={saving} onClick={()=>setReview(false)}>Zurück zur Bearbeitung</button><button className="btn-primary" disabled={saving||confirmation!=="BESTÄTIGEN"} onClick={()=>void save()}>{saving?"Wird gespeichert …":"Korrektureintrag anlegen"}</button></div>
      </div>
    </Modal>
  </section>;
}
