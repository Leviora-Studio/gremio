// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import {
  uploadSignedContractAction,
  type PublicContractState,
} from "@/app/inventar/status/[token]/actions";

type Doc = { id: number; filename: string; kind: string };
type Signed = { id: number; filename: string };

const KIND_LABEL: Record<string, string> = {
  loan_contract: "Leihvertrag",
  loan_request: "Leihantrag",
};

export function PublicContractSection({
  token,
  provided,
  signed,
}: {
  token: string;
  provided: Doc[];
  signed: Signed[];
}) {
  const [state, action] = useActionState(
    uploadSignedContractAction.bind(null, token),
    {} as PublicContractState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <div className="card mt-6 space-y-4 p-6">
      <div>
        <h2 className="font-semibold">Leihvertrag</h2>
        <p className="text-sm text-slate-500">
          Lade den bereitgestellten Vertrag herunter, unterschreibe ihn
          handschriftlich und lade den Scan bzw. ein Foto wieder hoch.
        </p>
      </div>

      {provided.length > 0 ? (
        <div>
          <p className="label">Bereitgestellte Dokumente</p>
          <ul className="space-y-1">
            {provided.map((d) => (
              <li key={d.id}>
                <a
                  href={`/api/inventar/status/${token}/attachment/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand-600 hover:underline"
                >
                  📄 {KIND_LABEL[d.kind] ?? "Dokument"}: {d.filename}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Sobald ein Vertrag bereitgestellt wurde, erscheint er hier zum
          Herunterladen.
        </p>
      )}

      <form ref={formRef} action={action} className="space-y-2">
        <p className="label">Unterschriebenen Vertrag hochladen (PDF/Foto)</p>
        <div className="flex items-center gap-2">
          <input
            type="file"
            name="file"
            accept=".pdf,.png,.jpg,.jpeg"
            required
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
          <SubmitButton className="btn-primary shrink-0 px-3 py-1.5 text-sm">
            Hochladen
          </SubmitButton>
        </div>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state.ok && (
          <p className="text-xs text-emerald-600">Hochgeladen — danke!</p>
        )}
      </form>

      {signed.length > 0 && (
        <div>
          <p className="label">Deine hochgeladenen Verträge</p>
          <ul className="space-y-1">
            {signed.map((d) => (
              <li key={d.id}>
                <a
                  href={`/api/inventar/status/${token}/attachment/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand-600 hover:underline"
                >
                  📎 {d.filename}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
