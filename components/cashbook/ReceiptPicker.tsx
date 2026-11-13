// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { useId, useState } from "react";
import { PdfViewerModal } from "@/components/pdf/PdfViewerModal";

type Receipt = { id: number; filename: string };

export function ReceiptPicker({ receipts, selectedIds, onChange, hasApplication }: {
    receipts: Receipt[];
    selectedIds: number[];
    onChange: (ids: number[]) => void;
    hasApplication: boolean;
}) {
    const id = useId();
    const [preview, setPreview] = useState<Receipt | null>(null);

    return <section aria-labelledby={`${id}-title`} data-live-refresh-block={!!preview} className="overflow-hidden rounded-lg border border-slate-200">
        <div className="space-y-1 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h2 id={`${id}-title`} className="text-sm font-medium">Quittungen auswählen</h2>
            <p aria-live="polite" className="text-sm text-slate-500">{hasApplication ? `${receipts.length} verfügbar · ${selectedIds.length} ausgewählt` : "Zuerst Antrag auswählen"}</p>
            {receipts.length > 0 && <p className="text-sm text-slate-600">Öffne die Quittungen zum Prüfen und hake die benötigten Dateien an.</p>}
        </div>
        {receipts.length > 0 ? <ul className="divide-y divide-slate-200">
            {receipts.map(receipt => <li key={receipt.id} className="flex items-center gap-3 px-4 py-3">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600" checked={selectedIds.includes(receipt.id)} onChange={event => onChange(event.target.checked ? [...selectedIds, receipt.id] : selectedIds.filter(selected => selected !== receipt.id))}/>
                    <span className="min-w-0 break-all">{receipt.filename}</span>
                </label>
                <button type="button" className="btn-secondary btn-sm shrink-0" aria-label={`${receipt.filename} ansehen`} onClick={() => setPreview(receipt)}>Ansehen</button>
            </li>)}
        </ul> : <p className="px-4 py-4 text-sm text-slate-500">{hasApplication ? "An diesem Antrag sind noch keine auswählbaren Quittungen hinterlegt. Bitte im Quittungsbereich des Antrags ergänzen." : "Bitte zuerst einen Antrag auswählen."}</p>}
        {preview && <PdfViewerModal open onClose={() => setPreview(null)} src={`/api/attachment/${preview.id}`} filename={preview.filename} mime="application/pdf" attachmentId={preview.id} editable={false} hasCert={false}/>}
    </section>;
}
