// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  apiTokenBoards,
  apiTokens,
  users,
  type ApiTokenScope,
  type User,
} from "@/lib/db/schema";

/** Auth-Kontext einer API-Anfrage: Nutzer + Rechtestufe + Board-Beschränkung. */
export type ApiContext = {
  user: User;
  scope: ApiTokenScope;
  /** null = alle Boards des Nutzers; sonst nur diese Board-IDs. */
  boardIds: Set<number> | null;
};

// Token-Format: "grm_" + 48 zufällige Zeichen (URL-sicheres Alphabet, ~280 bit).
const ALPHABET =
  "0123456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const nano = customAlphabet(ALPHABET, 48);
export const API_TOKEN_PREFIX = "grm_";

/** SHA-256-Hash (hex) eines Tokens. Tokens haben hohe Entropie → SHA-256 genügt. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Erzeugt ein neues Token (Klartext nur hier verfügbar) + Hash + Anzeige-Präfix. */
export function generateApiToken(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const token = API_TOKEN_PREFIX + nano();
  return { token, hash: hashToken(token), prefix: token.slice(0, 11) };
}

/**
 * Liest den Bearer-Token aus dem Authorization-Header und gibt den Auth-Kontext
 * zurück (Nutzer + Rechtestufe + Board-Beschränkung) oder null. Aktualisiert
 * nebenbei last_used_at.
 */
export async function authenticateApiToken(
  authHeader: string | null,
): Promise<ApiContext | null> {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = (m ? m[1] : authHeader).trim();
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;

  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      scope: apiTokens.scope,
      restricted: apiTokens.restricted,
    })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!user || !user.isActive) return null;

  const boardRows = await db
    .select({ boardId: apiTokenBoards.boardId })
    .from(apiTokenBoards)
    .where(eq(apiTokenBoards.tokenId, row.id));
  // Beschränkung kommt aus dem expliziten `restricted`-Flag, NICHT aus der
  // Zeilenanzahl: Sind die Beschränkungs-Boards (CASCADE) gelöscht, bleibt das
  // Token beschränkt (leere Menge → 404 überall), statt auf alle Boards des
  // Nutzers aufzumachen. Ohne Beschränkung → null = alle Boards des Nutzers.
  const boardIds = row.restricted
    ? new Set(boardRows.map((b) => b.boardId))
    : null;

  // last_used_at aktualisieren (fire-and-forget, blockiert die Anfrage nicht).
  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .catch(() => {});

  return { user, scope: row.scope, boardIds };
}
