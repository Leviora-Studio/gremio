// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { lockCardAction } from "@/app/intern/card/[id]/lock-actions";
export function CardLockControls({ cardId, statusId, locked, pending, canEdit }: {
    cardId: number;
    statusId: number;
    locked: boolean;
    pending: boolean;
    canEdit: boolean;
}) {
    const [open, setOpen] = useState(false), [error, setError] = useState("");
    const router = useRouter();
    if (locked)
        return <section className="card border-emerald-300 bg-emerald-50 p-4 text-sm">Dauerhaft gesperrt: Karteninhalte und bestehende Dateien sind eingefroren. Spaltenwechsel und neue Quittungen bleiben möglich.</section>;
    if (!pending)
        return null;
    return <section className="card space-y-3 border-red-400 bg-red-50 p-4"><p className="font-semibold text-red-800">Sperrbestätigung ausstehend</p><p className="text-sm">Der öffentliche Status bleibt bis zur Bestätigung unverändert. Die Sperre ist endgültig und kann nicht aufgehoben werden.</p>{canEdit && <button className="btn-primary" onClick={() => setOpen(true)}>Karte endgültig sperren</button>}{error && <p role="alert" className="text-red-700">{error}</p>}<ConfirmDialog open={open} title="Karte endgültig sperren" message="Alle Karteninhalte und bestehenden Dateien werden dauerhaft eingefroren. Diese Entscheidung ist nicht umkehrbar. Nur Spaltenwechsel und neue Quittungen bleiben möglich. Jetzt verbindlich sperren und den öffentlichen Status übernehmen?" confirmLabel="Endgültig sperren" onClose={() => setOpen(false)} onConfirm={async () => { try {
        await lockCardAction(cardId, statusId);
        setOpen(false);
        router.refresh();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Sperren fehlgeschlagen.");
        setOpen(false);
    } }}/></section>;
}
