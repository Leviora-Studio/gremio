// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import { FileInput } from "@/components/FileInput";
import { SubmitButton } from "@/components/SubmitButton";
import {
  removeCertificateAction,
  uploadCertificateAction,
  type CertState,
} from "@/app/intern/konto/actions";

type Cert = {
  subject: string | null;
  notAfter: string | null; // ISO
  uploadedAt: string | null; // ISO
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE");
}

export function CertificateSettings({ cert }: { cert: Cert | null }) {
  const [state, action] = useActionState<CertState, FormData>(
    uploadCertificateAction,
    {},
  );

  const notAfter = cert?.notAfter ? new Date(cert.notAfter) : null;
  const now = Date.now();
  const expired = notAfter ? notAfter.getTime() <= now : false;
  const soon =
    notAfter && !expired
      ? notAfter.getTime() - now < 30 * 24 * 60 * 60 * 1000
      : false;

  return (
    <section className="card p-6">
      <h2 className="mb-1 text-lg font-semibold">Signatur-Zertifikat (.p12)</h2>
      <p className="mb-4 text-sm text-slate-500">
        Für das digitale Signieren von PDFs im integrierten Viewer. Datei und
        Passwort werden verschlüsselt gespeichert — einmal hinzufügen genügt.
        Empfehlung: ein eigenes Signatur-Zertifikat, kein anderweitig genutztes.
      </p>

      {cert ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p>
            <span className="text-slate-500">Inhaber:</span>{" "}
            <span className="font-medium">{cert.subject ?? "—"}</span>
          </p>
          <p>
            <span className="text-slate-500">Gültig bis:</span>{" "}
            <span className={expired ? "font-medium text-red-600" : ""}>
              {fmtDate(cert.notAfter)}
            </span>
            {expired && (
              <span className="ml-2 text-red-600">— abgelaufen</span>
            )}
            {soon && (
              <span className="ml-2 text-amber-600">— läuft bald ab</span>
            )}
          </p>
          <p className="text-slate-500">
            Hinzugefügt: {fmtDate(cert.uploadedAt)}
          </p>
          <form action={removeCertificateAction} className="mt-3">
            <SubmitButton className="btn-secondary btn-sm text-red-600">
              Zertifikat entfernen
            </SubmitButton>
          </form>
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-500">
          Noch kein Zertifikat hinterlegt — ohne Zertifikat ist das Signieren
          deaktiviert.
        </p>
      )}

      <form action={action} className="space-y-3">
        <FileInput
          name="file"
          accept=".p12,.pfx,application/x-pkcs12"
          label={cert ? "Neue .p12 wählen" : ".p12 wählen"}
        />
        <div>
          <label className="label">Zertifikat-Passwort</label>
          <input
            type="password"
            name="passphrase"
            autoComplete="off"
            className="input max-w-xs"
            placeholder="Passwort der .p12 (leer lassen, falls keines)"
          />
        </div>
        <SubmitButton className="btn-primary">
          {cert ? "Zertifikat ersetzen" : "Zertifikat hinzufügen"}
        </SubmitButton>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.success && (
          <p className="text-sm text-green-600">{state.success}</p>
        )}
      </form>
    </section>
  );
}
