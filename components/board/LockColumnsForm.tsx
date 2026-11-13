// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState, useState } from "react";
import { Select } from "@/components/Select";
import { saveLockColumnsAction } from "@/app/intern/board/[id]/einstellungen/lock-actions";
export function LockColumnsForm({ boardId, statuses, completedStatusId }: {
    boardId: number;
    statuses: {
        id: number;
        name: string;
        isLockColumn: boolean;
    }[];
    completedStatusId: number | null;
}) {
    const [state, action, pending] = useActionState(saveLockColumnsAction.bind(null, boardId), {} as {
        error?: string;
        success?: string;
    });
    const [selected, setSelected] = useState(statuses.filter(s => s.isLockColumn).map(s => s.id));
    const [completed, setCompleted] = useState(completedStatusId ? String(completedStatusId) : "");
    return <form noValidate action={action} onReset={event => event.preventDefault()} className="space-y-4"><p className="text-sm text-slate-600">Karten in Sperrspalten müssen ausdrücklich endgültig gesperrt werden. Erst dann wird der neue Status öffentlich. Bereits gesperrte Karten bleiben beim Verschieben dauerhaft gesperrt.</p><fieldset disabled={pending}><legend className="label">Sperrspalten</legend><div className="grid gap-2 sm:grid-cols-2">{statuses.map(s => <label key={s.id} className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm"><input type="checkbox" name="statusId" value={s.id} checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))}/>{s.name}</label>)}</div></fieldset><div><label className="label">Zahlungen abgeschlossen</label><Select name="completedStatusId" value={completed} onChange={setCompleted} options={[{ value: "", label: "Keine Abschlussspalte" }, ...statuses.map(s => ({ value: String(s.id), label: s.name }))]}/><p className="mt-1 text-sm text-slate-500">In dieser Spalte sind alle Zahlungen des Antrags abgeschlossen.</p></div><button disabled={pending} className="btn-primary">Speichern</button>{state.error && <p role="alert" className="text-red-700">{state.error}</p>}{state.success && <p role="status" className="text-green-700">{state.success}</p>}</form>;
}
