// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { FileInput } from "@/components/FileInput";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import type { InventoryAttachment } from "@/lib/db/schema";
import {
  deleteInventoryAttachmentAction,
  uploadLoanContractAction,
  type AttachmentState,
} from "@/app/intern/inventar/item/[itemId]/attachment-actions";
import { saveInventoryPdfEditsAction } from "@/app/intern/inventar/item/[itemId]/pdf-actions";

const KIND_LABEL: Record<string, string> = {
  loan_contract: "Leihvertrag",
  loan_request: "Leihantrag",
};

export function LoanContractUpload({
  loanId,
  docs,
  hasCert = false,
}: {
  loanId: number;
  docs: InventoryAttachment[];
  hasCert?: boolean;
}) {
  const [state, action] = useActionState(
    uploadLoanContractAction,
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
              <AttachmentLink
                id={d.id}
                filename={d.filename}
                mime={d.mime}
                src={`/api/inventory/attachment/${d.id}`}
                editable
                hasCert={hasCert}
                fieldsUrl={`/api/inventory/attachment/${d.id}/fields`}
                saveAction={saveInventoryPdfEditsAction}
                label={`${KIND_LABEL[d.kind] ?? "Datei"}: ${d.filename}`}
                className="truncate text-brand-600 hover:underline"
              />
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
      <form
        ref={formRef}
        action={action}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="loanId" value={loanId} />
        <Select
          name="kind"
          defaultValue="loan_contract"
          className="w-44"
          options={[
            { value: "loan_contract", label: "Leihvertrag" },
            { value: "loan_request", label: "Leihantrag" },
          ]}
        />
        <FileInput key={resetKey} name="file" accept=".pdf" required />
        <SubmitButton className="btn-secondary shrink-0">
          Hochladen
        </SubmitButton>
      </form>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
