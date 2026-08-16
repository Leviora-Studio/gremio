// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { AttachmentKind } from "@/lib/constants";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { FileInput } from "@/components/FileInput";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import {
  deleteAttachmentAction,
  uploadAttachmentAction,
  type State,
} from "@/app/intern/card/[id]/actions";

type Att = { id: number; filename: string; mime: string };

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
}: {
  cardId: number;
  att: Att;
  hasCert?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2">
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
  );
}

export function AttachmentSlot({
  cardId,
  kind,
  label,
  accept,
  current,
  hasCert,
}: {
  cardId: number;
  kind: AttachmentKind;
  label: string;
  accept: string;
  current: Att | null;
  hasCert?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      {current ? (
        <div className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2">
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
}: {
  cardId: number;
  items: Att[];
  hasCert?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">Dateien (PDF)</div>
      {items.map((a) => (
        <FileLine key={a.id} cardId={cardId} att={a} hasCert={hasCert} />
      ))}
      <UploadForm
        cardId={cardId}
        kind="other"
        accept="application/pdf,.pdf"
        label="PDF hinzufügen"
      />
    </div>
  );
}
