// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState } from "react";
import { saveBoardEmailRuleAction } from "@/app/intern/board/[id]/einstellungen/email-actions";
export function BoardEmailRuleForm({ boardId, status, enabled, recipients }: { boardId:number;status:{id:number;name:string};enabled:boolean;recipients:string[] }) {
  const [state, action, pending] = useActionState(saveBoardEmailRuleAction.bind(null,boardId,status.id),{} as {error?:string;success?:string});
  return <form action={action} className="space-y-3 rounded border border-slate-200 p-3">
    <h3 className="font-semibold">{status.name}</h3>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={enabled} disabled={pending} />E-Mail beim Erreichen dieser Spalte versenden</label>
    <label className="block text-sm">Empfangsadressen<textarea name="recipients" className="input mt-1" rows={2} defaultValue={recipients.join("\n")} placeholder="person@example.org" /></label>
    <p className="text-xs text-slate-500">Eine Adresse pro Zeile oder mit Komma/Semikolon trennen (max. 50). Versendet werden Kartentitel, Spalte und ein interner Karten-Link. Jede Adresse erhält eine eigene Nachricht.</p>
    <button className="btn-secondary btn-sm" disabled={pending}>{pending?"Wird gespeichert …":"E-Mail-Regel speichern"}</button>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}{state.success && <p role="status" className="text-sm text-green-700">{state.success}</p>}
  </form>;
}
