// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  mcpClients,
  mcpGrants,
  mcpGrantBoards,
  mcpCodes,
  mcpTokens,
  users,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getAccessibleBoards } from "@/lib/authz";
import type { ApiContext } from "@/lib/api-token";

export class McpGrantError extends Error {}

export const oauthScope = "gremio";
export function oauthOrigin() {
  return new URL(env.APP_BASE_URL).origin;
}
export function mcpResource() {
  return `${oauthOrigin()}/api/mcp`;
}
export function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
const secret = () => randomBytes(32).toString("base64url");
export function validRedirect(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
export const registrationSchema = z
  .object({
    client_name: z.string().trim().min(1).max(100),
    redirect_uris: z
      .array(z.string().max(2000).refine(validRedirect))
      .min(1)
      .max(10),
    token_endpoint_auth_method: z.literal("none").default("none"),
    grant_types: z
      .array(z.enum(["authorization_code", "refresh_token"]))
      .default(["authorization_code", "refresh_token"]),
    response_types: z.array(z.literal("code")).default(["code"]),
    scope: z.literal(oauthScope).optional(),
  })
  .strip();
export const authorizationSchema = z
  .object({
    response_type: z.literal("code"),
    client_id: z.string().min(1).max(200),
    redirect_uri: z.string().max(2000),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: z.literal("S256"),
    state: z.string().max(2048).optional(),
    scope: z.literal(oauthScope).default(oauthScope),
    resource: z.string().max(2000),
  })
  .strict();
export type AuthorizationRequest = z.infer<typeof authorizationSchema>;
export async function validateAuthorization(input: unknown) {
  const parsed = authorizationSchema.safeParse(input);
  if (!parsed.success || parsed.data.resource !== mcpResource()) return null;
  const [client] = await db
    .select()
    .from(mcpClients)
    .where(eq(mcpClients.id, parsed.data.client_id));
  if (!client || !client.redirectUris.includes(parsed.data.redirect_uri))
    return null;
  return { request: parsed.data, client };
}
export const grantSelectionSchema = z
  .object({
    scope: z.enum(["read", "write"]),
    allBoards: z.boolean(),
    boardIds: z.array(z.number().int().positive().max(2147483647)).max(1000),
  })
  .strict();
export type GrantSelection = z.infer<typeof grantSelectionSchema>;
export async function validateSelection(
  ctxUser: typeof users.$inferSelect,
  input: unknown,
) {
  const parsed = grantSelectionSchema.safeParse(input);
  if (!parsed.success) throw new McpGrantError("Ungültige Freigabe.");
  const p = parsed.data;
  if (p.allBoards && p.boardIds.length)
    throw new McpGrantError("Alle Boards oder einzelne Boards auswählen.");
  const allowed = new Set(
    (await getAccessibleBoards(ctxUser)).map((b) => b.id),
  );
  if (p.boardIds.some((id) => !allowed.has(id)))
    throw new McpGrantError("Mindestens ein Board ist nicht mehr zugänglich.");
  return { ...p, boardIds: [...new Set(p.boardIds)] };
}

export async function authorizeMcp(
  user: typeof users.$inferSelect,
  input: unknown,
  selection: unknown,
) {
  const auth = await validateAuthorization(input);
  if (!auth) throw new McpGrantError("Ungültige Autorisierungsanfrage.");
  const p = await validateSelection(user, selection);
  if (!p.allBoards && !p.boardIds.length)
    throw new McpGrantError("Bitte mindestens ein Board auswählen.");
  const code = secret(),
    grantId = randomUUID();
  await db.transaction(async (tx) => {
    // Serialize per-user grant creation to keep the limit reliable.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, user.id))
      .for("update");
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mcpGrants)
      .where(
        and(eq(mcpGrants.userId, user.id), sql`${mcpGrants.revokedAt} is null`),
      );
    if (count >= 50)
      throw new McpGrantError(
        "Maximal 50 Verbindungen. Bitte zuerst eine Verbindung widerrufen.",
      );
    await tx.insert(mcpGrants).values({
      id: grantId,
      userId: user.id,
      clientId: auth.client.id,
      scope: p.scope,
      restricted: !p.allBoards,
    });
    if (p.boardIds.length)
      await tx
        .insert(mcpGrantBoards)
        .values(p.boardIds.map((boardId) => ({ grantId, boardId })));
    await tx.insert(mcpCodes).values({
      hash: tokenHash(code),
      grantId,
      redirectUri: auth.request.redirect_uri,
      challenge: auth.request.code_challenge,
      resource: auth.request.resource,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
  });
  const url = new URL(auth.request.redirect_uri);
  url.searchParams.set("code", code);
  url.searchParams.set("iss", oauthOrigin());
  if (auth.request.state !== undefined)
    url.searchParams.set("state", auth.request.state);
  return url.toString();
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function issueTokens(tx: Tx, grantId: string) {
  const access = `gmcp_a_${secret()}`,
    refresh = `gmcp_r_${secret()}`;
  await tx.insert(mcpTokens).values([
    {
      hash: tokenHash(access),
      grantId,
      kind: "access",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    {
      hash: tokenHash(refresh),
      grantId,
      kind: "refresh",
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    },
  ]);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: 900,
    scope: oauthScope,
  };
}
export async function exchangeMcpToken(p: URLSearchParams) {
  if (
    p.get("resource") !== mcpResource() ||
    (p.has("scope") && p.get("scope") !== oauthScope)
  )
    return null;
  const clientId = p.get("client_id");
  if (!clientId) return null;
  const kind = p.get("grant_type");
  if (kind !== "authorization_code" && kind !== "refresh_token") return null;
  const raw = p.get(kind === "authorization_code" ? "code" : "refresh_token");
  if (!raw || raw.length > 200) return null;
  // Read immutable grant identity first; lock the grant before the token/code to
  // serialize refresh, replay detection, revocation and permission edits.
  const table = kind === "authorization_code" ? mcpCodes : mcpTokens;
  const [initial] = await db
    .select({ grantId: table.grantId })
    .from(table)
    .where(eq(table.hash, tokenHash(raw)));
  if (!initial) return null;
  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(mcpGrants)
      .where(eq(mcpGrants.id, initial.grantId))
      .for("update");
    if (!grant || grant.revokedAt || grant.clientId !== clientId) return null;
    const [user] = await tx
      .select({ active: users.isActive })
      .from(users)
      .where(eq(users.id, grant.userId));
    if (!user?.active) return null;
    if (kind === "authorization_code") {
      const [code] = await tx
        .select()
        .from(mcpCodes)
        .where(eq(mcpCodes.hash, tokenHash(raw)))
        .for("update");
      if (
        !code ||
        code.expiresAt <= new Date() ||
        code.resource !== p.get("resource") ||
        code.redirectUri !== p.get("redirect_uri")
      )
        return null;
      const verifier = p.get("code_verifier") ?? "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null;
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (!timingSafeEqual(Buffer.from(challenge), Buffer.from(code.challenge)))
        return null;
      if (code.consumedAt) {
        await tx
          .update(mcpGrants)
          .set({ revokedAt: new Date() })
          .where(eq(mcpGrants.id, grant.id));
        return null;
      }
      await tx
        .update(mcpCodes)
        .set({ consumedAt: new Date() })
        .where(eq(mcpCodes.hash, code.hash));
    } else {
      const [token] = await tx
        .select()
        .from(mcpTokens)
        .where(eq(mcpTokens.hash, tokenHash(raw)))
        .for("update");
      if (!token || token.kind !== "refresh" || token.expiresAt <= new Date())
        return null;
      if (token.usedAt) {
        await tx
          .update(mcpGrants)
          .set({ revokedAt: new Date() })
          .where(eq(mcpGrants.id, grant.id));
        return null;
      }
      await tx
        .update(mcpTokens)
        .set({ usedAt: new Date() })
        .where(eq(mcpTokens.hash, token.hash));
    }
    return issueTokens(tx, grant.id);
  });
}
export async function authenticateMcp(
  header: string | null,
): Promise<ApiContext | null> {
  const raw = /^Bearer (gmcp_a_[A-Za-z0-9_-]+)$/i.exec(header ?? "")?.[1];
  if (!raw) return null;
  // Grant, live scope and selected boards come from one SQL snapshot.
  const rows = await db
    .select({
      token: mcpTokens,
      grant: mcpGrants,
      user: users,
      boardId: mcpGrantBoards.boardId,
    })
    .from(mcpTokens)
    .innerJoin(mcpGrants, eq(mcpTokens.grantId, mcpGrants.id))
    .innerJoin(users, eq(mcpGrants.userId, users.id))
    .leftJoin(mcpGrantBoards, eq(mcpGrantBoards.grantId, mcpGrants.id))
    .where(eq(mcpTokens.hash, tokenHash(raw)));
  const first = rows[0];
  if (
    !first ||
    first.token.kind !== "access" ||
    first.token.expiresAt <= new Date() ||
    first.grant.revokedAt ||
    !first.user.isActive
  )
    return null;
  await db
    .update(mcpGrants)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpGrants.id, first.grant.id));
  return {
    user: first.user,
    scope: first.grant.scope,
    boardIds: first.grant.restricted
      ? new Set(rows.flatMap((r) => (r.boardId == null ? [] : [r.boardId])))
      : null,
  };
}
export async function editMcpGrant(
  user: typeof users.$inferSelect,
  id: string,
  selection: unknown,
) {
  const p = await validateSelection(user, selection);
  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(mcpGrants)
      .where(and(eq(mcpGrants.id, id), eq(mcpGrants.userId, user.id)))
      .for("update");
    if (!grant || grant.revokedAt)
      throw new McpGrantError("Verbindung nicht gefunden.");
    await tx
      .update(mcpGrants)
      .set({ scope: p.scope, restricted: !p.allBoards })
      .where(eq(mcpGrants.id, id));
    await tx.delete(mcpGrantBoards).where(eq(mcpGrantBoards.grantId, id));
    if (p.boardIds.length)
      await tx
        .insert(mcpGrantBoards)
        .values(p.boardIds.map((boardId) => ({ grantId: id, boardId })));
  });
}
export async function revokeMcpGrant(userId: number, id: string) {
  await db
    .update(mcpGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpGrants.id, id), eq(mcpGrants.userId, userId)));
}
export async function pruneMcpCredentials() {
  // Keep consumed refresh tokens until their original expiry for replay detection.
  await db.delete(mcpTokens).where(lt(mcpTokens.expiresAt, new Date()));
  await db
    .delete(mcpCodes)
    .where(lt(mcpCodes.expiresAt, new Date(Date.now() - 86400_000)));
}

export function startMcpCredentialSweeper() {
  const global = globalThis as unknown as { __mcpSweeper?: NodeJS.Timeout };
  if (global.__mcpSweeper) return;
  const tick = () => {
    void pruneMcpCredentials().catch(() =>
      console.error("[mcp] Credential cleanup failed"),
    );
  };
  tick();
  global.__mcpSweeper = setInterval(tick, 3600_000);
  global.__mcpSweeper.unref();
}
