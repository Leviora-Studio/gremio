// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { AttachmentKind } from "@/lib/constants";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { FileInput } from "@/components/FileInput";
import { UploadQueue } from "@/components/UploadQueue";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import {
  deleteAttachmentAction,
  uploadAttachmentAction,
  type State,
} from "@/app/intern/card/[id]/actions";

import { createAttachmentFolderAction, organizeAttachmentAction } from "@/app/intern/card/[id]/attachment-actions";
import type { AttachmentFolder } from "@/lib/attachment-organization";

type Att = { id: number; filename: string; mime: string; folderId?: number | null };

export function AttachmentFolders({ cardId, folders }: { cardId: number; folders: AttachmentFolder[] }) {
  const [state, action, pending] = useActionState(createAttachmentFolderAction.bind(null, cardId), {} as State);
  return (
    <div className="space-y-2 rounded border border-slate-200 p-3">
      <div className="text-sm font-medium text-slate-700">Ordner</div>
      {folders.length > 0 && <div className="flex flex-wrap gap-2">{folders.map((folder) => (
        <span key={folder.id} className="max-w-full break-words rounded bg-slate-100 px-2 py-1 text-sm">📁 {folder.name}</span>
      ))}</div>}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input aria-label="Neuer Ordnername" name="name" required maxLength={120} placeholder="Neuer Ordnername" className="input min-w-0 flex-1" disabled={pending} />
        <button className="btn-secondary btn-sm" disabled={pending}>{pending ? "Wird erstellt …" : "Ordner erstellen"}</button>
      </form>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-green-700">{state.success}</p>}
    </div>
  );
}

function FileOrganization({ cardId, att, folders }: { cardId: number; att: Att; folders: AttachmentFolder[] }) {
  const [state, action, pending] = useActionState(organizeAttachmentAction.bind(null, cardId, att.id), {} as State);
  const folder = folders.find((f) => f.id === att.folderId);
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer break-words text-brand-600">Umbenennen / verschieben{folder ? ` · ${folder.name}` : ""}</summary>
      <form key={`${att.filename}-${att.folderId}`} action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="originalFilename" value={att.filename} />
        <input type="hidden" name="originalFolderId" value={att.folderId ?? ""} />
        <label className="min-w-[8rem] flex-1">Dateiname
          <input name="filename" defaultValue={att.filename} required maxLength={120} disabled={pending} className="input mt-1 w-full" />
        </label>
        <label className="min-w-[8rem] flex-1">Zielordner
          <select name="folderId" defaultValue={att.folderId ?? ""} disabled={pending} className="input mt-1 w-full">
            <option value="">Ticket-Hauptordner</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <button className="btn-secondary btn-sm" disabled={pending}>{pending ? "Speichert …" : "Speichern"}</button>
      </form>
      {state.error && <p role="alert" className="mt-1 text-red-600">{state.error}</p>}
      {state.success && <p role="status" className="mt-1 text-green-700">{state.success}</p>}
    </details>
  );
}

function UploadForm({
  cardId,
  kind,
  accept,
  label,
  hideStatus,
  triggerClassName,
}: {
  cardId: number;
  kind: AttachmentKind;
  accept: string;
  label: string;
  hideStatus?: boolean;
  triggerClassName?: string;
}) {
  const [state, action, pending] = useActionState(
    uploadAttachmentAction.bind(null, cardId, kind),
    {} as State,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);

  // Nach erfolgreichem Upload das Feld zurücksetzen (für other Uploads).
  useEffect(() => {
    if (state.success) setResetKey((k) => k + 1);
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      noValidate
      className="flex flex-wrap items-center gap-2"
    >
      <FileInput
        key={resetKey}
        name="file"
        accept={accept}
        label={label}
        disabled={pending}
        hideStatus={hideStatus}
        triggerClassName={triggerClassName}
        onSelect={() => formRef.current?.requestSubmit()}
      />
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}

function FileLine({
  cardId,
  att,
  hasCert = false,
  folders,
}: {
  cardId: number;
  att: Att;
  folders: AttachmentFolder[];
  hasCert?: boolean;
}) {
  return (
    <div className="rounded border border-slate-200 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <AttachmentLink
          id={att.id}
          filename={att.filename}
          mime={att.mime}
          src={`/api/attachment/${att.id}`}
          editable
          hasCert={hasCert}
          className="min-w-0 truncate text-sm text-brand-600 hover:underline"
        />
        <DeleteConfirm
          action={deleteAttachmentAction.bind(null, cardId, att.id)}
          requireWord={false}
          compact
          buttonLabel="löschen"
          buttonClassName="text-xs text-red-600 hover:underline"
          title={`Datei „${att.filename}" löschen`}
          message="Die Datei wird vom Antrag entfernt."
        />
      </div>
      <FileOrganization cardId={cardId} att={att} folders={folders} />
    </div>
  );
}

export function AttachmentSlot({
  cardId,
  kind,
  label,
  accept,
  current,
  hasCert,
  folders = [],
}: {
  cardId: number;
  kind: AttachmentKind;
  label: string;
  accept: string;
  current: Att | null;
  folders?: AttachmentFolder[];
  hasCert?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      {current ? (
        <div className="rounded border border-slate-200 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <AttachmentLink
              id={current.id}
              filename={current.filename}
              mime={current.mime}
              src={`/api/attachment/${current.id}`}
              editable
              hasCert={hasCert}
              className="min-w-0 truncate text-sm text-brand-600 hover:underline"
            />
            <div className="flex shrink-0 items-center gap-3 leading-none">
              <UploadForm
                cardId={cardId}
                kind={kind}
                accept={accept}
                label="ersetzen"
                hideStatus
                triggerClassName="text-xs leading-none text-brand-600 hover:underline"
              />
              <DeleteConfirm
                action={deleteAttachmentAction.bind(null, cardId, current.id)}
                requireWord={false}
                compact
                buttonLabel="löschen"
                buttonClassName="text-xs leading-none text-red-600 hover:underline"
                title={`Datei „${current.filename}" löschen`}
                message="Die Datei wird vom Antrag entfernt."
              />
            </div>
          </div>
          <FileOrganization cardId={cardId} att={current} folders={folders} />
        </div>
      ) : (
        <UploadForm
          cardId={cardId}
          kind={kind}
          accept={accept}
          label="Datei auswählen"
        />
      )}
    </div>
  );
}

export function WeitereAttachments({
  cardId,
  items,
  hasCert = false,
  allowUpload = true,
  folders = [],
}: {
  cardId: number;
  items: Att[];
  hasCert?: boolean;
  allowUpload?: boolean;
  folders?: AttachmentFolder[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">Dateien (PDF)</div>
      {items.filter((a) => a.folderId == null).map((a) => (
        <FileLine key={a.id} cardId={cardId} att={a} hasCert={hasCert} folders={folders} />
      ))}
      {folders.map((folder) => (
        <details key={folder.id} open className="rounded border border-slate-200 p-3">
          <summary className="cursor-pointer break-words font-medium text-slate-700">📁 {folder.name}</summary>
          <div className="mt-2 space-y-2">
            {items.filter((a) => a.folderId === folder.id).map((a) => (
              <FileLine key={a.id} cardId={cardId} att={a} hasCert={hasCert} folders={folders} />
            ))}
            {!items.some((a) => a.folderId === folder.id) && <p className="text-sm text-slate-500">Keine weiteren PDFs in diesem Ordner.</p>}
          </div>
        </details>
      ))}
      {allowUpload && (
        <UploadQueue upload={(file) => { const data = new FormData(); data.set("file", file); return uploadAttachmentAction(cardId, "other", {}, data); }} />
      )}
    </div>
  );
}
