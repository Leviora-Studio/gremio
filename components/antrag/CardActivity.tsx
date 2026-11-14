// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { Avatar } from "@/components/Avatar";
import { cardActivityDisplay } from "@/lib/card-activity-display";
import { visibleActivityDetail } from "@/lib/card-field-projection";
import { formatDateTime } from "@/lib/dates";

type Activity = { id: number; type: string; detail: string | null; createdAt: Date; userId: number | null; username: string | null; avatarPath: string | null };

function PlanningSnapshot({ lines, label }: { lines: string[]; label: string }) {
  return <div className="min-w-0 space-y-2">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h4>
    {lines.length ? <ol className="space-y-2">{lines.map((line,index)=><li key={index} className="break-words rounded-lg border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700">{line.split(" · ").map((part,i)=><span key={i} className={`block ${i===0?"font-medium text-slate-900":"text-slate-500"}`}>{part}</span>)}</li>)}</ol> : <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">Keine Einplanung</p>}
  </div>;
}

export function CardActivity({ activity, visibleFields, applicationBoard }: { activity: Activity[]; visibleFields: ReadonlySet<string>; applicationBoard: boolean }) {
  return <section className="card space-y-5 p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Aktivitätsverlauf</h2><p className="text-xs text-slate-500">Neueste Änderungen zuerst</p></div>
    {!activity.length ? <p className="text-sm text-slate-500">Noch keine Aktivität.</p> : <ol className="divide-y divide-slate-200">
      {activity.map(event=>{
        // Apply the same field/privacy projection as the API before presentation.
        const display = cardActivityDisplay(event.type, visibleActivityDetail(event, visibleFields, applicationBoard));
        return <li key={event.id} className="py-5 first:pt-0 last:pb-0">
          <div className="flex items-start gap-3">
            <Avatar username={event.username??"System"} src={event.userId&&event.avatarPath?`/api/avatar/${event.userId}`:null} size={28} className="mt-0.5 shrink-0"/>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 className="text-sm font-semibold text-slate-900">{display.title}</h3><time dateTime={event.createdAt.toISOString()} className="shrink-0 text-xs text-slate-500">{formatDateTime(event.createdAt,"medium")}</time></div>
              <p className="text-xs text-slate-500">{event.username??"System"}</p>
              {display.detail&&<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{display.detail}</p>}
              {display.planning&&<>
                {display.planning.reason&&<div className="rounded-lg border-l-2 border-brand-300 bg-slate-50 px-4 py-3"><p className="text-xs font-semibold text-slate-500">Begründung der Korrektur</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{display.planning.reason}</p></div>}
                <details className="group rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Einplanung vergleichen <span className="ml-2 font-normal text-slate-500">{display.planning.before.length} → {display.planning.after.length} Positionen</span></summary>
                  <div className="grid gap-5 border-t border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"><PlanningSnapshot label="Vorher" lines={display.planning.before}/><PlanningSnapshot label="Nachher" lines={display.planning.after}/></div>
                </details>
              </>}
            </div>
          </div>
        </li>;
      })}
    </ol>}
  </section>;
}
