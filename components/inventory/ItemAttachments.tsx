// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/SubmitButton";
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

// In dieser Reihenfolge angezeigt; „other" bleibt vorerst außen vor.
const SHOWN_KINDS: InventoryAttachmentKind[] = [
  "receipt",
  "loan_request",
  "loan_contract",
];

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
}: {
  itemId: number;
  attachments: Record<InventoryAttachmentKind, InventoryAttachment[]>;
}) {
  return (
    <section className="card space-y-5 p-5">
      <h2 className="font-semibold">Dateien</h2>
      {SHOWN_KINDS.map((kind) => (
        <AttachmentKindSection
          key={kind}
          itemId={itemId}
          kind={kind}
          label={INVENTORY_ATTACHMENT_LABELS[kind]}
          files={attachments[kind] ?? []}
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
}: {
  itemId: number;
  kind: InventoryAttachmentKind;
  label: string;
  files: InventoryAttachment[];
}) {
  const [state, action] = useActionState(
    uploadInventoryAttachmentAction,
    {} as AttachmentState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
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
              <a
                href={`/api/inventory/attachment/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="truncate text-brand-600 hover:underline"
              >
                {f.filename}
              </a>
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

      <form ref={formRef} action={action} className="flex items-center gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="kind" value={kind} />
        <input
          type="file"
          name="file"
          accept={accept}
          required
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
        <SubmitButton className="btn-secondary shrink-0 px-3 py-1.5 text-sm">
          Hochladen
        </SubmitButton>
      </form>
      {state.error && (
        <p className="mt-1 text-xs text-red-600">{state.error}</p>
      )}
    </div>
  );
}
