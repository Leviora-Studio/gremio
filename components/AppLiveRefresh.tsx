// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useEffect,useRef,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {LiveRefreshGuard} from "@/lib/live-refresh-guard";
import {registerRefreshCoordinator} from "@/lib/live-refresh-client";
/** One protected subscription per tab. All refreshes share the same draft guard. */
export function AppLiveRefresh(){
 const pathname=usePathname(),router=useRouter(),[waiting,setWaiting]=useState(false);const request=useRef<(announce?:boolean)=>void>(()=>{}),guard=useRef<LiveRefreshGuard|null>(null);
 const protectedPage=/^\/(intern|admin|finanzen|vorlagen)(\/|$)/.test(pathname);
 useEffect(()=>{guard.current=new LiveRefreshGuard();let pending=false,announceChange=false,draftSince=0,timer:ReturnType<typeof setTimeout>|undefined,resetTimer:ReturnType<typeof setTimeout>|undefined,lastRefresh=0,lastInput=0;
  const flush=()=>{timer=undefined;if(!pending)return;if(document.visibilityState!=='visible'||!navigator.onLine){setWaiting(false);return;}const blocked=guard.current!.blocked();if(blocked||Date.now()-lastInput<1000){const draft=guard.current!.hasDraft();if(draft&&!draftSince)draftSince=Date.now();if(!draft)draftSince=0;setWaiting(announceChange&&draft&&Date.now()-draftSince>=1500);timer=setTimeout(flush,750);return;}const remaining=1500-(Date.now()-lastRefresh);if(remaining>0){timer=setTimeout(flush,remaining);return;}pending=false;announceChange=false;draftSince=0;setWaiting(false);lastRefresh=Date.now();guard.current!.clear();router.refresh();};
  const queue=(announce=false)=>{pending=true;announceChange ||= announce;if(!timer)timer=setTimeout(flush,350);};request.current=queue;
  const unregister=registerRefreshCoordinator(()=>queue(true));
  const capture=(e:Event)=>guard.current!.capture(e.target),change=(e:Event)=>{lastInput=Date.now();guard.current!.change(e.target);},down=(e:Event)=>{guard.current!.pointerDown=true;capture(e);},up=()=>{guard.current!.pointerDown=false;lastInput=Date.now();},reset=(e:Event)=>{if(e.target instanceof HTMLFormElement){const form=e.target;if(resetTimer)clearTimeout(resetTimer);resetTimer=setTimeout(()=>guard.current!.reset(form),0);}},visible=()=>{if(document.visibilityState==='visible')queue();};
  document.addEventListener('focusin',capture,true);document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);document.addEventListener('input',change,true);document.addEventListener('change',change,true);document.addEventListener('reset',reset,true);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);window.addEventListener('blur',up);window.addEventListener('online',visible);
  return()=>{unregister();if(timer)clearTimeout(timer);if(resetTimer)clearTimeout(resetTimer);document.removeEventListener('focusin',capture,true);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);document.removeEventListener('input',change,true);document.removeEventListener('change',change,true);document.removeEventListener('reset',reset,true);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);window.removeEventListener('blur',up);window.removeEventListener('online',visible);};
 },[router]);
 useEffect(()=>{guard.current?.clear();setWaiting(false);},[pathname]);
 useEffect(()=>{
  if(!protectedPage)return;let stream:EventSource|null=null,closed=false,retry:ReturnType<typeof setTimeout>|undefined;
  const connect=()=>{if(closed)return;stream=new EventSource('/api/app/stream');stream.onmessage=()=>request.current(true);stream.onopen=()=>request.current();stream.onerror=()=>{if(stream?.readyState===EventSource.CLOSED)request.current();if(stream?.readyState===EventSource.CLOSED&&!retry)retry=setTimeout(()=>{retry=undefined;connect();},30000);};};connect();
  return()=>{closed=true;stream?.close();if(retry)clearTimeout(retry);};
 },[protectedPage]);
 return waiting?<div role="status" className="fixed bottom-24 right-4 z-30 max-w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-brand-200 bg-white p-4 text-sm shadow-lg md:bottom-6"><p className="font-semibold text-slate-900">Neue Änderungen verfügbar</p><p className="mt-1 text-slate-500">Deine Eingaben bleiben erhalten. Nach dem Speichern oder Verwerfen wird automatisch aktualisiert.</p></div>:null;
}
