// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useEffect,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {Select} from "@/components/Select";
import {topicStates} from "@/lib/meetings/validation";
import {setTopicStatusAction} from "@/app/intern/sitzungen/actions";
export function TopicStatusControl({id,title,state,revision,section="public"}:{id:number;title:string;state:keyof typeof topicStates;revision:number;section?:"public"|"non_public"}){
 const current=state==="scheduled"?`scheduled:${section}`:state;
 const [value,setValue]=useState<string>(current),[error,setError]=useState(""),[pending,start]=useTransition();const router=useRouter();useEffect(()=>setValue(current),[current]);
 return <div data-live-refresh-block={pending} className="w-full max-w-56"><Select portal ariaLabel={`Status für ${title}`} value={value} disabled={pending} options={Object.entries(topicStates).flatMap(([value,label])=>value==="scheduled"?[{value:"scheduled:public",label:"Einplanen: öffentlich"},{value:"scheduled:non_public",label:"Einplanen: nicht öffentlich"}]:[{value,label}])} onChange={next=>{if(next===value)return;setValue(next);setError("");start(async()=>{try{const result=await setTopicStatusAction(id,next.split(":")[0],revision,next.startsWith("scheduled:")?next.split(":")[1] as "public"|"non_public":undefined);if(result.error){setValue(current);setError(result.error);}router.refresh();}catch{setValue(current);setError("Der Status konnte nicht gespeichert werden.");}});}}/>{pending&&<p role="status" className="mt-1 text-xs text-slate-500">Wird gespeichert …</p>}{error&&<p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}</div>;
}
