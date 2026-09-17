// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAccessibleBoards } from "@/lib/authz";
import { validateAuthorization } from "@/lib/mcp-oauth";
import { consentAction } from "./actions";
import { McpConsent } from "@/components/McpConsent";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Anwendung verbinden — Gremio",
  referrer: "no-referrer" as const,
};
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const auth = await validateAuthorization(input);
  if (!auth)
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-bold">Ungültige Verbindungsanfrage</h1>
        <p className="mt-3">
          Bitte starte die Verbindung erneut aus deiner Anwendung.
        </p>
      </main>
    );
  const user = await getCurrentUser();
  if (!user) {
    const query = new URLSearchParams(Object.entries(auth.request));
    redirect(
      `/api/auth/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`,
    );
  }
  const boards = (await getAccessibleBoards(user)).map((b) => ({
    id: b.id,
    name: b.name,
  }));
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="card space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Mit Gremio verbinden</h1>
          <p className="mt-3 break-words">
            <strong>{auth.client.name}</strong> möchte auf dein Gremio
            zugreifen.
          </p>
          <p className="mt-1 break-all text-sm text-slate-500">
            Ziel: {new URL(auth.request.redirect_uri).origin}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Angemeldet als {user.name ?? user.username}. Der Anwendungsname wird
            vom Anbieter angegeben.
          </p>
        </div>
        <McpConsent
          boards={boards}
          action={consentAction.bind(
            null,
            user.id,
            Date.now() + 10 * 60_000,
            auth.request,
          )}
        />
      </div>
    </main>
  );
}
