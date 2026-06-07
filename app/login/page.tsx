// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Login — Gremio" };

const ERROR_MESSAGES: Record<string, string> = {
  inactive: "Dein Konto ist deaktiviert. Bitte wende dich an einen Administrator.",
  state: "Die Anmeldung ist abgelaufen. Bitte versuche es erneut.",
  callback: "Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
  access_denied: "Die Anmeldung wurde abgebrochen.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/intern");

  const { error, next } = await searchParams;
  const msg = error ? (ERROR_MESSAGES[error] ?? "Anmeldung fehlgeschlagen.") : null;
  const loginHref = `/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Gremio Logo"
          className="mx-auto mb-3 h-14 w-auto"
        />
        <h1 className="mb-1 text-2xl font-bold">Gremio</h1>
        <p className="mb-6 text-sm text-slate-500">
          Interner Bereich — bitte anmelden
        </p>

        {msg && (
          <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{msg}</p>
        )}

        <a href={loginHref} className="btn-primary w-full">
          Mit Gremien-Konto anmelden
        </a>
        <p className="mt-4 text-xs text-slate-400">
          Du wirst zur zentralen Anmeldung weitergeleitet.
        </p>
      </div>
    </main>
  );
}
