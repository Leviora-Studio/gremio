// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { FileInput } from "@/components/FileInput";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import {
  submitContractAction,
  uploadSignedContractAction,
  type PublicContractState,
} from "@/app/inventar/status/[token]/actions";

type Doc = { id: number; filename: string; kind: string; mime: string };
type Signed = { id: number; filename: string; mime: string };

const KIND_LABEL: Record<string, string> = {
  loan_contract: "Leihvertrag",
  loan_request: "Leihantrag",
};

export function PublicContractSection({
  token,
  status,
  provided,
  signed,
}: {
  token: string;
  status: string;
  provided: Doc[];
  signed: Signed[];
}) {
  const [state, action] = useActionState(
    uploadSignedContractAction.bind(null, token),
    {} as PublicContractState,
  );
  const [submitState, submitAction] = useActionState(
    submitContractAction.bind(null, token),
    {} as PublicContractState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setResetKey((k) => k + 1);
    }
  }, [state.ok]);
  // Phasen: hochladen/einsenden nur solange die Ausleihe noch nicht läuft; danach
  // („in Ausleihe"/„zurückgegeben") bleibt der Bereich nur zum Ansehen sichtbar.
  const canSubmit = status === "requested" || status === "contract_provided";
  const submitted = status === "contract_signed";
  const isPast = status === "active" || status === "returned";

  return (
    <div className="card mt-6 space-y-4 p-6">
      <div>
        <h2 className="font-semibold">Leihvertrag</h2>
        <p className="text-sm text-slate-500">
          {isPast
            ? "Hier findest du weiterhin die Vertragsunterlagen zu diesem Vorgang."
            : "Lade den bereitgestellten Vertrag herunter, unterschreibe ihn handschriftlich und lade den Scan bzw. ein Foto wieder hoch."}
        </p>
      </div>

      {provided.length > 0
        ? (
          <div>
            <p className="label">Bereitgestellte Dokumente</p>
            <ul className="space-y-1">
              {provided.map((d) => (
                <li key={d.id}>
                  <AttachmentLink
                    id={d.id}
                    filename={d.filename}
                    mime={d.mime}
                    src={`/api/inventar/status/${token}/attachment/${d.id}`}
                    label={`${KIND_LABEL[d.kind] ?? "Dokument"}: ${d.filename}`}
                    className="text-sm text-brand-600 hover:underline"
                  />
                </li>
              ))}
            </ul>
          </div>
        )
        : !isPast && (
            <p className="text-sm text-slate-500">
              Sobald ein Vertrag bereitgestellt wurde, erscheint er hier zum
              Herunterladen.
            </p>
          )}

      {/* Hochladen nur während der Vertragsphase. */}
      {!isPast && (
        <form ref={formRef} action={action} className="space-y-2">
          <p className="label">Unterschriebenen Vertrag hochladen (PDF/Foto)</p>
          <div className="flex flex-wrap items-center gap-2">
            <FileInput
              key={resetKey}
              name="file"
              accept=".pdf,.png,.jpg,.jpeg"
              required
            />
            <SubmitButton className="btn-primary shrink-0">
              Hochladen
            </SubmitButton>
          </div>
          {state.error && <p className="text-xs text-red-600">{state.error}</p>}
          {state.ok && (
            <p className="text-xs text-emerald-600">Hochgeladen — danke!</p>
          )}
        </form>
      )}

      {signed.length > 0 && (
        <div>
          <p className="label">Deine hochgeladenen Verträge</p>
          <ul className="space-y-1">
            {signed.map((d) => (
              <li key={d.id}>
                <AttachmentLink
                  id={d.id}
                  filename={d.filename}
                  mime={d.mime}
                  src={`/api/inventar/status/${token}/attachment/${d.id}`}
                  label={`📎 ${d.filename}`}
                  className="text-sm text-brand-600 hover:underline"
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* „Vertrag einsenden" bestätigt die Abgabe → Status „Vertrag unterschrieben". */}
      {canSubmit && (
        <form
          action={submitAction}
          className="space-y-2 border-t border-slate-100 pt-4"
        >
          <p className="text-sm text-slate-600">
            Wenn du alle vorgeschriebenen Dokumente angefügt hast, sende den
            Vertrag ein.
          </p>
          <SubmitButton className="btn-success" disabled={signed.length === 0}>
            ✓ Vertrag einsenden
          </SubmitButton>
          {signed.length === 0 && (
            <p className="text-xs text-slate-500">
              Lade zuerst mindestens ein unterschriebenes Dokument hoch.
            </p>
          )}
          {submitState.error && (
            <p className="text-xs text-red-600">{submitState.error}</p>
          )}
        </form>
      )}

      {submitted && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          ✓ Vertrag eingesendet — vielen Dank! Deine Unterlagen werden geprüft.
        </div>
      )}
    </div>
  );
}
