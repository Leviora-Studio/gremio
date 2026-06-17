// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import { FileInput } from "@/components/FileInput";
import { SubmitButton } from "@/components/SubmitButton";
import {
  removeSignatureAction,
  uploadSignatureAction,
  type SignatureState,
} from "@/app/intern/konto/actions";

export function SignatureSettings({
  hasSignature,
  version,
}: {
  hasSignature: boolean;
  version: string;
}) {
  const [state, action] = useActionState<SignatureState, FormData>(
    uploadSignatureAction,
    {},
  );

  return (
    <section className="card p-6">
      <h2 className="mb-1 text-lg font-semibold">Unterschriftsbild (optional)</h2>
      <p className="mb-4 text-sm text-slate-500">
        Wird beim Signieren <strong>zusätzlich zum Namen</strong> in der
        Signatur-Box angezeigt — rein optisch, damit es wie eine Unterschrift
        aussieht. Für die rechtliche Gültigkeit zählt allein die kryptografische
        Signatur. Tipp: PNG mit transparentem Hintergrund.
      </p>

      {hasSignature && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/signature?v=${encodeURIComponent(version)}`}
            alt="Unterschrift"
            className="max-h-24 max-w-full bg-white"
          />
          <form action={removeSignatureAction} className="mt-3">
            <SubmitButton className="btn-secondary btn-sm text-red-600">
              Unterschriftsbild entfernen
            </SubmitButton>
          </form>
        </div>
      )}

      <form action={action} className="space-y-3">
        <FileInput
          name="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          label={hasSignature ? "Neues Bild wählen" : "Bild wählen"}
        />
        <SubmitButton className="btn-primary">
          {hasSignature ? "Unterschriftsbild ersetzen" : "Unterschriftsbild hinzufügen"}
        </SubmitButton>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.success && (
          <p className="text-sm text-green-600">{state.success}</p>
        )}
      </form>
    </section>
  );
}
