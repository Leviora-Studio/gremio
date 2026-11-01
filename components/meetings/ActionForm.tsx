// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState, startTransition, useEffect, useRef } from "react";
import type { MeetingActionState } from "@/app/intern/sitzungen/actions";
export function MeetingActionForm({ action, children, submit = "Speichern", compact = false, preserveValues = false }: { action: (previous: MeetingActionState, form: FormData) => Promise<MeetingActionState>; children: React.ReactNode; submit?: string; compact?: boolean; preserveValues?:boolean }) {
  const formRef=useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState(action, {} as MeetingActionState);
  useEffect(()=>{if(preserveValues&&state.success)formRef.current?.dispatchEvent(new Event("reset",{bubbles:true,cancelable:true}));},[state,preserveValues]);
  return <form ref={formRef} onSubmit={preserveValues?event=>{event.preventDefault();const data=new FormData(event.currentTarget);startTransition(()=>dispatch(data));}:undefined} onReset={preserveValues?event=>event.preventDefault():undefined} action={preserveValues?undefined:dispatch} className={compact?"min-w-0 max-w-full flex flex-wrap items-end gap-2":"min-w-0 space-y-4"}>
    <fieldset disabled={pending} className={compact?"flex min-w-0 flex-1 flex-wrap items-end gap-2":"min-w-0 space-y-4"}>{children}</fieldset>
    <button className={compact?"btn-secondary max-w-full h-auto min-h-10 whitespace-normal py-2":"btn-primary max-w-full h-auto min-h-10 whitespace-normal py-2"} disabled={pending}>{pending ? "Wird gespeichert …" : submit}</button>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    {state.success && <p role="status" className="text-sm text-green-700">{state.success}</p>}
  </form>;
}
