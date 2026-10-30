// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState } from "react";
import { Select } from "@/components/Select";
import { saveSmtpAction, verifySmtpAction, type EmailState } from "@/app/admin/email/actions";
export type SmtpFormValues = { enabled: boolean; host: string; port: number; security: string; username: string | null; fromEmail: string; fromName: string; replyTo: string | null; hasPassword: boolean };
export function SmtpSettingsForm({ initial }: { initial: SmtpFormValues }) {
  const [state, action, pending] = useActionState(saveSmtpAction, {} as EmailState);
  const [test, testAction, testing] = useActionState(verifySmtpAction, {} as EmailState);
  return <div className="space-y-4">
    <form action={action} className="space-y-4" autoComplete="off">
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="enabled" defaultChecked={initial.enabled} disabled={pending} />E-Mail-Versand für diese Instanz aktivieren</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">SMTP-Host<input name="host" className="input" defaultValue={initial.host} required maxLength={253} /></label>
        <label className="label">Port<input name="port" type="number" min={1} max={65535} className="input" defaultValue={initial.port} required /></label>
        <div><label className="label">Verschlüsselung</label><Select ariaLabel="SMTP-Verschlüsselung" name="security" defaultValue={initial.security} options={[{value:"starttls",label:"STARTTLS (z. B. Port 587)"},{value:"tls",label:"TLS (z. B. Port 465)"},{value:"none",label:"Ohne TLS (nur lokales/internes Relay)"}]} /></div>
        <label className="label">Benutzername (optional)<input name="username" className="input" defaultValue={initial.username ?? ""} maxLength={254} /></label>
        <label className="label">SMTP-Passwort<input name="password" type="password" className="input" autoComplete="new-password" placeholder={initial.hasPassword ? "Gespeichert – leer lassen zum Beibehalten" : "Passwort"} maxLength={2000} /></label>
        <label className="label">Absendername<input name="fromName" className="input" defaultValue={initial.fromName} maxLength={100} /></label>
        <label className="label">Absenderadresse<input name="fromEmail" type="email" className="input" defaultValue={initial.fromEmail} required maxLength={254} /></label>
        <label className="label">Antwortadresse (optional)<input name="replyTo" type="email" className="input" defaultValue={initial.replyTo ?? ""} maxLength={254} /></label>
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Wird gespeichert …" : "SMTP speichern"}</button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}{state.success && <p role="status" className="text-sm text-green-700">{state.success}</p>}
    </form>
    <form action={testAction}><button className="btn-secondary" disabled={testing || pending}>{testing ? "Wird geprüft …" : "Gespeicherte SMTP-Verbindung prüfen"}</button>
      {test.error && <p role="alert" className="mt-2 text-sm text-red-700">{test.error}</p>}{test.success && <p role="status" className="mt-2 text-sm text-green-700">{test.success}</p>}
    </form>
  </div>;
}
