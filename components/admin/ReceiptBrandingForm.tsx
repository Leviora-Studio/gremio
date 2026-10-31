// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import Image from "next/image";
import {useActionState,useEffect,useState} from "react";
import {FileInput} from "@/components/FileInput";
import {SubmitButton} from "@/components/SubmitButton";
import {saveReceiptBrandingAction,saveScopedReceiptBrandingAction} from "@/app/admin/empfangsbestaetigung/actions";
import type {ReceiptScope,BrandingState} from "@/lib/receipt-branding";
export function ReceiptBrandingForm({organization,hasLogo,version,scope,enabled=false,resourceName}:{organization:string;hasLogo:boolean;version:string;scope?:ReceiptScope;enabled?:boolean;resourceName?:string}){
  const [custom,setCustom]=useState(enabled);useEffect(()=>setCustom(enabled),[enabled]);
  const [state,action]=useActionState(scope?saveScopedReceiptBrandingAction.bind(null,scope):saveReceiptBrandingAction,{} as BrandingState);
  const preview=scope?`/api/receipt-logo?kind=${scope.kind}&id=${scope.id}&v=${version}`:`/api/receipt-logo?v=${version}`;
  return <form action={action} className="space-y-5">
    {scope&&<><label className="flex items-start gap-2 text-sm font-medium"><input type="hidden" name="customBranding" value={custom?"on":""}/><input key={String(enabled)} type="checkbox" checked={custom} onChange={e=>setCustom(e.target.checked)} className="mt-1"/>Eigene Gestaltung verwenden</label><p className="text-sm text-slate-500">Ohne eigene Gestaltung gilt der instanzweite Standard. Die eigene Gestaltung verwendet ausschließlich den hier hinterlegten Gremiennamen und das eigene Logo.</p></>}
    <fieldset disabled={!!scope&&!custom} className={`min-w-0 space-y-5 ${scope&&!custom?"opacity-60":""}`}>
      <label className="label">{scope?"Gremienname":"Organisation / Absender"}<input className="input" name="organization" defaultValue={organization} key={organization} maxLength={160} placeholder={scope?resourceName||"Name deines Gremiums":"Name deines Gremiums"}/></label><p className="text-sm text-slate-500">Erscheint im Briefkopf und unter der Grußformel. {scope?"Ohne Angabe wird die Bezeichnung dieses Standorts oder dieser Umfrage verwendet.":"Ohne Angabe wird Gremio verwendet."}</p>
      {hasLogo&&<div className="rounded-lg border bg-slate-50 p-4"><Image unoptimized width={240} height={96} src={preview} alt="Aktuelles Logo für Empfangsbestätigungen" className="max-h-24 max-w-full object-contain"/><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="removeLogo"/>Logo entfernen</label></div>}
      <FileInput key={version} name="logo" accept="image/png,image/jpeg,.png,.jpg,.jpeg" label={hasLogo?"Logo ersetzen":"Logo hinterlegen"}/><p className="text-xs text-slate-500">PNG oder JPEG, höchstens 2 MB. Ein neues Logo ersetzt das bisherige. {scope?"Gilt nur für Einreichungen über diesen Standort oder diese Umfrage – sowohl beim PDF-Download als auch im E-Mail-Anhang. Ohne eigenes Logo erscheint die eigene Gestaltung ohne Logo.":"Standard für Bestätigungen ohne eigene Standort- oder Umfragegestaltung, einschließlich Inventaranfragen – sowohl beim PDF-Download als auch im E-Mail-Anhang."}</p>
    </fieldset>
    <SubmitButton className="btn-primary">Gestaltung speichern</SubmitButton>{state.error&&<p role="alert" className="text-sm text-red-700">{state.error}</p>}{state.success&&<p role="status" className="text-sm text-green-700">{state.success}</p>}
  </form>;
}
