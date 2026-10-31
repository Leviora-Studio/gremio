// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useActionState,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {Modal} from "@/components/Modal";
import {Select} from "@/components/Select";
import {SubmitButton} from "@/components/SubmitButton";
import {transferTopicInlineAction,proposePersonalTopicAction,type MeetingActionState} from "@/app/intern/sitzungen/actions";
export function TopicTransferControl({id,targets,personal=false,scheduled=false}:{id:number;targets:{value:string;label:string}[];personal?:boolean;scheduled?:boolean}){
 const [open,setOpen]=useState(false),[state,action]=useActionState((personal?proposePersonalTopicAction:transferTopicInlineAction).bind(null,id),{} as MeetingActionState);const router=useRouter();
 useEffect(()=>{if(state.success){setOpen(false);router.refresh();}},[state,router]);
 if(!targets.length)return null;
 return <><button type="button" className="btn-secondary max-w-full h-auto min-h-10 py-2 whitespace-normal" onClick={()=>setOpen(true)}>{personal?"Zur Sitzung vorschlagen":"In andere Sitzung übernehmen"}</button><Modal open={open} onClose={()=>setOpen(false)} title={personal?"Thema zur Sitzung vorschlagen":"TOP in andere Sitzung übernehmen"} manageFocus portal><form action={action} className="space-y-4"><p className="text-sm text-slate-500">{personal?"Dein Thema bleibt im Themenspeicher. Dort siehst du anschließend, für welche Sitzung es vorgeschlagen oder eingeplant ist.":scheduled?"Dieser eingeplante TOP verschwindet aus der bisherigen Sitzungsübersicht. In der neuen Sitzung wird er zunächst vorgeschlagen.":"Dieser TOP bleibt mit seinem bisherigen Status in der aktuellen Sitzung sichtbar. In der neuen Sitzung wird er zunächst vorgeschlagen."} Unter-TOPs behalten in der bisherigen Sitzung jeweils ihren eigenen Verlauf.</p><div><label className="label">Zielsitzung</label><Select portal name="meetingId" ariaLabel="Zielsitzung" options={targets} placeholder="Sitzung auswählen …"/></div><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmDisclosure" required className="mt-1"/>Ich gebe die Inhalte und Sitzungsunterlagen für den Teilnehmerkreis der Zielsitzung frei. Karten behalten ihre Board-Rechte.</label><SubmitButton className="btn-primary max-w-full h-auto min-h-10 py-2 whitespace-normal">Vorschlagen</SubmitButton>{state.error&&<p role="alert" className="text-sm text-red-700">{state.error}</p>}</form></Modal></>;
}
