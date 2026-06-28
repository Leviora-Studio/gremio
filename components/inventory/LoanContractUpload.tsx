// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import type { InventoryAttachment } from "@/lib/db/schema";
import {
  deleteInventoryAttachmentAction,
  uploadLoanContractAction,
  type AttachmentState,
} from "@/app/intern/inventar/item/[itemId]/attachment-actions";

const KIND_LABEL: Record<string, string> = {
  loan_contract: "Leihvertrag",
  loan_request: "Leihantrag",
};

export function LoanContractUpload({
  loanId,
  docs,
}: {
  loanId: number;
  docs: InventoryAttachment[];
}) {
  const [state, action] = useActionState(
    uploadLoanContractAction,
    {} as AttachmentState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white/60 p-2.5">
      <p className="mb-1 text-xs font-medium text-slate-500">
        Vertrag / Antrag zum Vorgang
      </p>
      {docs.length > 0 && (
        <ul className="mb-2 space-y-1">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <a
                href={`/api/inventory/attachment/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="truncate text-brand-600 hover:underline"
              >
                {KIND_LABEL[d.kind] ?? "Datei"}: {d.filename}
              </a>
              <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                {d.uploadedBy == null ? "vom Entleiher" : "bereitgestellt"}
                <form action={deleteInventoryAttachmentAction}>
                  <input type="hidden" name="attId" value={d.id} />
                  <SubmitButton className="hover:text-red-600">
                    löschen
                  </SubmitButton>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} action={action} className="flex items-center gap-2">
        <input type="hidden" name="loanId" value={loanId} />
        <Select
          name="kind"
          defaultValue="loan_contract"
          className="w-auto"
          options={[
            { value: "loan_contract", label: "Leihvertrag" },
            { value: "loan_request", label: "Leihantrag" },
          ]}
        />
        <input
          type="file"
          name="file"
          accept=".pdf"
          required
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs hover:file:bg-slate-200"
        />
        <SubmitButton className="btn-secondary shrink-0 px-2 py-1 text-xs">
          Hochladen
        </SubmitButton>
      </form>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
