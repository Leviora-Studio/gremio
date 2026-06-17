// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiTokenBoards, apiTokens, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { provisionUser } from "@/lib/auth/provision";
import { getAccessibleBoards } from "@/lib/authz";
import { generateApiToken } from "@/lib/api-token";
import { fetchUserInfo } from "@/lib/oidc";
import { allowRequest } from "@/lib/rate-limit";
import { CertError, encryptCert, inspectP12 } from "@/lib/cert";
import { CERTIFICATE_EXT, MAX_CERTIFICATE_BYTES } from "@/lib/constants";

const MAX_TOKENS_PER_USER = 20;

export type CreateTokenInput = {
  name: string;
  scope: "read" | "write";
  /** Leer = alle Boards des Nutzers. */
  boardIds: number[];
};

export type CreateTokenResult =
  | { ok: true; token: string; name: string }
  | { ok: false; error: string };

/** Erstellt einen neuen API-Token; gibt den Klartext genau einmal zurück. */
export async function createApiTokenAction(
  input: CreateTokenInput,
): Promise<CreateTokenResult> {
  const user = await requireUser();
  // Defensiv: die Objektform ist nur TypeScript — ein manipuliertes RPC-Payload
  // darf nicht beim Feldzugriff werfen (500), sondern kontrolliert ablehnen.
  if (
    !input ||
    typeof input.name !== "string" ||
    (input.scope !== "read" && input.scope !== "write") ||
    !Array.isArray(input.boardIds)
  ) {
    return { ok: false, error: "Ungültige Eingabe." };
  }
  const clean = input.name.trim().slice(0, 80);
  if (!clean) return { ok: false, error: "Bitte einen Namen angeben." };

  const scope = input.scope === "read" ? "read" : "write";

  const existing = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(eq(apiTokens.userId, user.id));
  if (existing.length >= MAX_TOKENS_PER_USER) {
    return {
      ok: false,
      error: `Maximal ${MAX_TOKENS_PER_USER} Tokens. Bitte zuerst eines widerrufen.`,
    };
  }

  // Board-Beschränkung nur auf Boards zulassen, auf die der Nutzer Zugriff hat.
  const accessibleIds = new Set(
    (await getAccessibleBoards(user)).map((b) => b.id),
  );
  const boardIds = [...new Set(input.boardIds)].filter((id) =>
    accessibleIds.has(id),
  );

  const { token, hash, prefix } = generateApiToken();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apiTokens)
      .values({
        userId: user.id,
        name: clean,
        tokenHash: hash,
        prefix,
        scope,
        // Beschränkung explizit festhalten — damit ein späteres Löschen der
        // Beschränkungs-Boards das Token NICHT unbeabsichtigt auf alle Boards
        // ausweitet (es bliebe beschränkt auf eine dann leere Menge).
        restricted: boardIds.length > 0,
      })
      .returning({ id: apiTokens.id });
    if (boardIds.length) {
      await tx
        .insert(apiTokenBoards)
        .values(boardIds.map((boardId) => ({ tokenId: row.id, boardId })));
    }
  });

  revalidatePath("/intern/konto");
  return { ok: true, token, name: clean };
}

/**
 * Profil (Name, Anzeige-Mail, Avatar) aus dem SSO neu ziehen — über den
 * UserInfo-Endpoint mit dem gespeicherten access_token. Funktioniert, solange
 * das access_token gültig ist; sonst bitte neu anmelden.
 */
export async function resyncProfileAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const user = await requireUser();
  if (!(await allowRequest("resync", 5, 60_000))) {
    return { ok: false, error: "Zu viele Versuche. Bitte kurz warten." };
  }
  const session = await getSession();
  const claims = await fetchUserInfo(session.accessToken);
  if (!claims) {
    return {
      ok: false,
      error: "SSO-Sitzung abgelaufen — bitte ab- und wieder anmelden.",
    };
  }
  const res = await provisionUser(claims);
  if (!res.ok) return { ok: false, error: "Aktualisierung fehlgeschlagen." };
  revalidatePath("/intern/konto");
  return { ok: true };
}

/** Widerruft (löscht) einen eigenen API-Token. */
export async function revokeApiTokenAction(tokenId: number): Promise<void> {
  const user = await requireUser();
  await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, user.id)));
  revalidatePath("/intern/konto");
}

// --- Signatur-Zertifikat (.p12) ----------------------------------------
export type CertState = { error?: string; success?: string };

/**
 * Lädt das persönliche Signatur-Zertifikat hoch. Die .p12 wird mit der
 * Passphrase geöffnet (Validierung), Inhaber/Gültigkeit ausgelesen, und .p12
 * + Passphrase AES-verschlüsselt in der DB gespeichert. „Einmal hinzufügen".
 */
export async function uploadCertificateAction(
  _prev: CertState,
  formData: FormData,
): Promise<CertState> {
  const user = await requireUser();
  if (!(await allowRequest(`cert-upload:${user.id}`, 10, 60_000))) {
    return { error: "Zu viele Versuche. Bitte kurz warten." };
  }
  const file = formData.get("file");
  const passphrase = String(formData.get("passphrase") ?? "");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Keine Datei ausgewählt." };
  }
  if (file.size > MAX_CERTIFICATE_BYTES) {
    return {
      error: `Datei zu groß (max. ${Math.round(MAX_CERTIFICATE_BYTES / 1024 / 1024)} MB).`,
    };
  }
  const lower = file.name.toLowerCase();
  if (!CERTIFICATE_EXT.some((e) => lower.endsWith(e))) {
    return { error: "Bitte eine .p12- oder .pfx-Datei wählen." };
  }
  const buf = Buffer.from(await file.arrayBuffer());

  let info;
  try {
    info = inspectP12(buf, passphrase);
  } catch (e) {
    return {
      error:
        e instanceof CertError
          ? e.message
          : "Zertifikat konnte nicht gelesen werden.",
    };
  }
  if (info.notAfter <= new Date()) {
    return {
      error: `Zertifikat ist abgelaufen (gültig bis ${info.notAfter.toLocaleDateString("de-DE")}).`,
    };
  }

  const { p12Enc, passEnc } = encryptCert(buf, passphrase);
  await db
    .update(users)
    .set({
      certP12Enc: p12Enc,
      certPassEnc: passEnc,
      certSubject: info.subjectCN,
      certNotAfter: info.notAfter,
      certUploadedAt: new Date(),
    })
    .where(eq(users.id, user.id));
  revalidatePath("/intern/konto");
  return { success: "Zertifikat gespeichert." };
}

/** Entfernt das gespeicherte Signatur-Zertifikat. */
export async function removeCertificateAction(): Promise<void> {
  const user = await requireUser();
  await db
    .update(users)
    .set({
      certP12Enc: null,
      certPassEnc: null,
      certSubject: null,
      certNotAfter: null,
      certUploadedAt: null,
    })
    .where(eq(users.id, user.id));
  revalidatePath("/intern/konto");
}
