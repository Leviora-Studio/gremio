// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import type {TopicHistoryEntry} from "@/lib/meetings/history";
import {formatDateTime} from "@/lib/dates";
import {topicStates} from "@/lib/meetings/validation";
const labels={...topicStates,resolved:"Erledigt"};
export function TopicTrail({entries,personal=false}:{entries:TopicHistoryEntry[];personal?:boolean}){
 if(!entries.length)return null;
 return <ol className="min-w-0 space-y-2 break-words text-sm">{entries.map(entry=><li key={entry.eventId??entry.id} className="rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-600">{personal&&entry.baseline?"Bisheriger Stand: ":""}{personal?(entry.state==="proposed"?"Vorgeschlagen für Sitzung":entry.state==="scheduled"?"Eingeplant für Sitzung":entry.state==="resolved"?"Als erledigt markiert nach Sitzung":`${labels[entry.state]} in Sitzung`):"Weitergegeben an Sitzung"}: </span><Link className="font-medium text-brand-700 hover:underline" href={`/intern/sitzungen/top/${entry.id}`}>{entry.meetingTitle}</Link>{!personal&&<span className="text-slate-500"> · {labels[entry.state]}</span>}{!personal&&entry.transferred&&<span className="ml-2 text-xs text-slate-500">weitergegeben</span>}{personal&&entry.occurredAt&&!entry.baseline&&<time dateTime={entry.occurredAt} className="mt-1 block text-xs text-slate-500">{formatDateTime(entry.occurredAt,"short")}</time>}{personal&&entry.baseline&&<p className="mt-1 text-xs text-slate-500">Zeitpunkt der früheren Statusänderung nicht bekannt</p>}</li>)}</ol>;
}
