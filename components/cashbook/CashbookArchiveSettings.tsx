// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CashbookArchiveSettings as Settings } from "@/lib/cashbook/archive";
import { saveCashbookArchiveAction, testCashbookArchiveAction } from "@/app/intern/kassenbuch/archive-actions";
export function CashbookArchiveSettings({bookId,initial,bookingExample}:{bookId:number;initial:Settings;bookingExample:string}) {
 const [enabled,setEnabled]=useState(initial.enabled),[ncUrl,setUrl]=useState(initial.ncUrl),[ncUsername,setUsername]=useState(initial.ncUsername),[ncPassword,setPassword]=useState(""),[targetFolder,setFolder]=useState(initial.targetFolder);
 const [pending,start]=useTransition(),[message,setMessage]=useState<{error?:string;success?:string}>({});const router=useRouter();
 const dirty=enabled!==initial.enabled||ncUrl!==initial.ncUrl||ncUsername!==initial.ncUsername||!!ncPassword||targetFolder!==initial.targetFolder;
 return <section data-live-refresh-dirty={dirty} data-live-refresh-block={dirty||pending} className="card space-y-4 p-5">
  <h2 className="text-lg font-semibold">Nextcloud-Archivierung</h2>
  <p className="text-sm leading-relaxed text-slate-600">Beim Erteilen der Anweisung werden alle Dateien der Buchung automatisch archiviert, einschließlich gespeicherter älterer Formularstände. Der Auftrag bleibt bei Fehlern oder einem Serverabbruch erhalten und wird erneut versucht. Bestehende Buchungen und Korrekturbuchungen werden nicht nachträglich archiviert.</p>
  <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={pending}/>Archivierung für dieses Kassenbuch aktiv</label>
  <div className="grid gap-4 sm:grid-cols-2">
   <label className="text-sm sm:col-span-2">WebDAV-URL<input className="input mt-1" aria-label="Kassenbuch WebDAV-URL" type="text" maxLength={2048} placeholder="https://cloud.example.org/remote.php/dav/files/USER/" value={ncUrl} onChange={e=>setUrl(e.target.value)} disabled={pending}/></label>
   <label className="text-sm">Benutzername<input className="input mt-1" aria-label="Kassenbuch Nextcloud-Benutzername" maxLength={500} value={ncUsername} onChange={e=>setUsername(e.target.value)} disabled={pending} autoComplete="off"/></label>
   <label className="text-sm">Passwort{initial.hasPassword&&<span className="block text-xs text-slate-500">Bereits gesetzt – leer lassen zum Behalten</span>}<input className="input mt-1" aria-label="Kassenbuch Nextcloud-Passwort" type="password" maxLength={4000} value={ncPassword} onChange={e=>setPassword(e.target.value)} disabled={pending} autoComplete="new-password"/></label>
   <label className="text-sm sm:col-span-2">Stammordner<input className="input mt-1" aria-label="Kassenbuch Nextcloud-Stammordner" maxLength={2000} placeholder="/Kassenbuch" value={targetFolder} onChange={e=>setFolder(e.target.value)} disabled={pending}/></label>
  </div>
  <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-500">Ordnername: Buchungsnummer Antrags-/Geschäftsbedarfsnummer</p><p className="mt-1 break-words font-medium">{targetFolder.replace(/\/$/,"")||"/Kassenbuch"}/{bookingExample} AN-2026-0042</p></div>
  <p className="text-xs text-slate-500">Zugangsdaten werden verschlüsselt gespeichert. Empfohlen wird ein Nextcloud-App-Passwort. Ausgeschaltete Archivierung pausiert noch offene Aufträge.</p>
  <div className="flex flex-wrap gap-3"><button className="btn-primary" disabled={pending} onClick={()=>start(async()=>{const result=await saveCashbookArchiveAction(bookId,initial.revision,{enabled,ncUrl,ncUsername,ncPassword,targetFolder});setMessage(result);if(!result.error){setPassword("");router.refresh();}})}>Archiv-Einstellungen speichern</button><button className="btn-secondary" disabled={pending||dirty||!initial.hasPassword||!initial.ncUrl||!initial.targetFolder} onClick={()=>start(async()=>{setMessage(await testCashbookArchiveAction(bookId));})}>Verbindung testen</button></div>
  {message.error&&<p role="alert" className="text-sm text-red-700">{message.error}</p>}{message.success&&<p role="status" className="text-sm text-green-700">{message.success}</p>}
 </section>;
}
