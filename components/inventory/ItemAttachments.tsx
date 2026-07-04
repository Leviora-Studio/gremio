// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { FileInput } from "@/components/FileInput";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import type { InventoryAttachment } from "@/lib/db/schema";
import {
  INVENTORY_ATTACHMENT_LABELS,
  type InventoryAttachmentKind,
} from "@/lib/inventory-attachment-kinds";
import {
  deleteInventoryAttachmentAction,
  uploadInventoryAttachmentAction,
  type AttachmentState,
} from "@/app/intern/inventar/item/[itemId]/attachment-actions";
import { saveInventoryPdfEditsAction } from "@/app/intern/inventar/item/[itemId]/pdf-actions";

// Am Gegenstand nur die Kaufbelege — Leihanträge/-verträge leben am Vorgang.
const SHOWN_KINDS: InventoryAttachmentKind[] = ["receipt"];

function fmt(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ItemAttachments({
  itemId,
  attachments,
  hasCert = false,
}: {
  itemId: number;
  attachments: Record<InventoryAttachmentKind, InventoryAttachment[]>;
  hasCert?: boolean;
}) {
  return (
    <section className="card space-y-5 p-5">
      <h2 className="font-semibold">Kaufbelege</h2>
      {SHOWN_KINDS.map((kind) => (
        <AttachmentKindSection
          key={kind}
          itemId={itemId}
          kind={kind}
          label={INVENTORY_ATTACHMENT_LABELS[kind]}
          files={attachments[kind] ?? []}
          hasCert={hasCert}
        />
      ))}
    </section>
  );
}

function AttachmentKindSection({
  itemId,
  kind,
  label,
  files,
  hasCert,
}: {
  itemId: number;
  kind: InventoryAttachmentKind;
  label: string;
  files: InventoryAttachment[];
  hasCert: boolean;
}) {
  const [state, action] = useActionState(
    uploadInventoryAttachmentAction,
    {} as AttachmentState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setResetKey((k) => k + 1);
    }
  }, [state.ok]);

  const accept = kind === "receipt" ? ".pdf,.png,.jpg,.jpeg" : ".pdf";

  return (
    <div>
      <p className="label">{label}</p>
      {files.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-2 rounded border border-slate-100 px-3 py-1.5 text-sm"
            >
              <AttachmentLink
                id={f.id}
                filename={f.filename}
                mime={f.mime}
                src={`/api/inventory/attachment/${f.id}`}
                editable
                hasCert={hasCert}
                fieldsUrl={`/api/inventory/attachment/${f.id}/fields`}
                saveAction={saveInventoryPdfEditsAction}
                className="truncate text-brand-600 hover:underline"
              />
              <span className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
                {fmt(f.uploadedAt)}
                <form action={deleteInventoryAttachmentAction}>
                  <input type="hidden" name="attId" value={f.id} />
                  <SubmitButton className="text-slate-400 hover:text-red-600">
                    löschen
                  </SubmitButton>
                </form>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-sm text-slate-400">Noch keine Dateien.</p>
      )}

      <form
        ref={formRef}
        action={action}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="kind" value={kind} />
        <FileInput key={resetKey} name="file" accept={accept} required />
        <SubmitButton className="btn-secondary shrink-0">
          Hochladen
        </SubmitButton>
      </form>
      {state.error && (
        <p className="mt-1 text-xs text-red-600">{state.error}</p>
      )}
    </div>
  );
}
