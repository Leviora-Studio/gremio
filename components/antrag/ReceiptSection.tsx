// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState } from "react";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { deleteAttachmentAction } from "@/app/intern/card/[id]/actions";
import { FileInput } from "@/components/FileInput";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import { uploadReceiptAction } from "@/app/intern/card/[id]/lock-actions";
export function ReceiptSection({ cardId, canUpload, canEdit=false, items }: {
    cardId: number;
    canUpload: boolean;
    canEdit?: boolean;
    items: {
        id: number;
        filename: string;
        mime: string;
    }[];
}) {
    const [state, action, pending] = useActionState(uploadReceiptAction.bind(null, cardId), {} as {
        error?: string;
        success?: string;
    });
    return <section className="card space-y-4 p-5"><h2 className="text-lg font-semibold">Quittungen</h2>{items.map(a => <div key={a.id} className="rounded border border-slate-200 p-3"><AttachmentLink id={a.id} filename={a.filename} mime={a.mime} src={`/api/attachment/${a.id}`} editable={false}/>{canEdit && <div className="mt-2"><DeleteConfirm action={deleteAttachmentAction.bind(null,cardId,a.id)} requireWord={false} buttonLabel="Quittung entfernen" title="Quittung entfernen" message="Diese Quittung für 30 Tage in den Papierkorb des Boards verschieben? Du kannst sie dort wiederherstellen."/></div>}</div>)}{!items.length && <p className="text-sm text-slate-500">Noch keine Quittungen vorhanden.</p>}{canUpload && <form noValidate action={action} className="space-y-3"><FileInput name="file" accept="application/pdf,.pdf" required/><button disabled={pending} className="btn-secondary">{pending ? "Wird hochgeladen …" : "Neue Quittung hinzufügen"}</button></form>}{state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}{state.success && <p role="status" className="text-sm text-green-700">{state.success}</p>}</section>;
}
