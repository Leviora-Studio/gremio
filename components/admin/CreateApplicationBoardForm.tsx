// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useActionState} from "react";
import {Select} from "@/components/Select";
import {createApplicationBoardAction} from "@/app/admin/antragsboards/actions";
const slots=[['finance_request','Finanzantrag'],['annex_a','Anlage A'],['annex_b','Anlage B'],['student_card','Studierendenausweis'],['receipts','Quittungen']];
export function CreateApplicationBoardForm({templates}:{templates:{id:number;name:string}[]}){
 const [state,action,pending]=useActionState(createApplicationBoardAction,{});
 return <form action={action} noValidate className="card max-w-3xl space-y-5 p-5">
  <h3 className="font-semibold">Antragsboard erstellen</h3>
  <label className="block text-sm">Name<input name="name" className="input mt-1" maxLength={120}/></label>
  <label className="block text-sm">Beschreibung (optional)<textarea name="description" className="input mt-1" maxLength={500} rows={2}/></label>
  <div><p className="mb-1 text-sm">Spaltenvorlage</p><Select name="templateId" defaultValue={templates[0]?String(templates[0].id):""} options={[{value:"",label:"Ohne Vorlage"},...templates.map(t=>({value:String(t.id),label:t.name}))]}/></div>
  <fieldset className="space-y-3"><legend className="mb-2 font-medium">Welche Anhangsbereiche werden benötigt?</legend><p className="text-sm text-slate-500">Die Auswahl gilt dauerhaft für dieses Board. Allgemeine Dateien kannst du später in den Kartenfeldern ein- oder ausschalten.</p><div className="grid gap-3 sm:grid-cols-2">{slots.map(([value,label])=><label key={value} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm"><input className="h-4 w-4 accent-brand-600" name="attachmentFields" type="checkbox" value={value} defaultChecked/>{label}</label>)}</div></fieldset>
  {state.error&&<p role="alert" className="text-sm text-red-700">{state.error}</p>}
  <button className="btn-primary" disabled={pending}>{pending?"Wird erstellt …":"Antragsboard erstellen"}</button>
 </form>;
}
