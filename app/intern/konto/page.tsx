// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { apiTokenBoards, apiTokens, boards } from "@/lib/db/schema";
import { getAccessibleBoards } from "@/lib/authz";
import { Avatar } from "@/components/Avatar";
import { ApiTokens } from "@/components/ApiTokens";
import { ResyncProfileButton } from "@/components/ResyncProfileButton";
import { CertificateSettings } from "@/components/CertificateSettings";
import { SignatureSettings } from "@/components/SignatureSettings";

export const metadata = { title: "Mein Konto — Gremio" };

export default async function KontoPage() {
  const user = await requireUser();
  const avatarSrc = user.avatarPath
    ? `/api/avatar/${user.id}?v=${encodeURIComponent(user.avatarPath)}`
    : null;
  const ssoAccountUrl = `${env.OIDC_ISSUER.replace(/\/$/, "")}/konto`;

  const boardOptions = (await getAccessibleBoards(user)).map((b) => ({
    id: b.id,
    name: b.name,
  }));

  const tokenRows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scope: apiTokens.scope,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, user.id))
    .orderBy(desc(apiTokens.createdAt));

  // Board-Beschränkungen je Token (Namen).
  const tokenIds = tokenRows.map((t) => t.id);
  const restrictionRows = tokenIds.length
    ? await db
        .select({ tokenId: apiTokenBoards.tokenId, boardName: boards.name })
        .from(apiTokenBoards)
        .innerJoin(boards, eq(boards.id, apiTokenBoards.boardId))
        .where(inArray(apiTokenBoards.tokenId, tokenIds))
    : [];
  const boardsByToken = new Map<number, string[]>();
  for (const r of restrictionRows) {
    const arr = boardsByToken.get(r.tokenId) ?? [];
    arr.push(r.boardName);
    boardsByToken.set(r.tokenId, arr);
  }

  const tokens = tokenRows.map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scope: t.scope,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    boards: boardsByToken.get(t.id) ?? [],
  }));
  const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");
  const roleLabel =
    user.role === "admin"
      ? "Admin"
      : user.role === "template_manager"
        ? "Template-Verwalter"
        : "Nutzer";

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Mein Konto</h1>
        <div className="mt-4 flex items-center gap-3">
          <Avatar username={user.name ?? user.username} src={avatarSrc} size={56} />
          <div>
            <p className="font-medium">{user.name ?? user.username}</p>
            <p className="text-sm text-slate-500">
              Benutzername: {user.username} · Rolle: {roleLabel}
            </p>
            {user.email && (
              <p className="text-sm text-slate-500">E-Mail: {user.email}</p>
            )}
          </div>
        </div>
      </div>

      <section className="card p-6">
        <h2 className="mb-1 text-lg font-semibold">Profil & Passwort</h2>
        <p className="mb-4 text-sm text-slate-500">
          Anzeigename, Profilbild und Passwort werden zentral über dein
          Gremien-Konto verwaltet. Änderungen werden beim nächsten Login
          übernommen.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={ssoAccountUrl}
            target="_blank"
            rel="noopener"
            className="btn-secondary"
          >
            Gremien-Konto öffnen
          </a>
          <ResyncProfileButton />
        </div>
      </section>

      <CertificateSettings
        cert={
          user.certP12Enc
            ? {
                subject: user.certSubject,
                notAfter: user.certNotAfter
                  ? user.certNotAfter.toISOString()
                  : null,
                uploadedAt: user.certUploadedAt
                  ? user.certUploadedAt.toISOString()
                  : null,
              }
            : null
        }
      />

      <SignatureSettings
        hasSignature={!!user.signaturePath}
        version={user.signaturePath ?? ""}
      />

      <ApiTokens tokens={tokens} boards={boardOptions} baseUrl={baseUrl} />
    </div>
  );
}
