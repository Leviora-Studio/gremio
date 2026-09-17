// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { deriveKey } from "@/lib/crypto";
import { authorizedApiRequest } from "@/lib/api-context";
import { resolveApiAttachment, attachmentsApi } from "@/lib/api-card-extras";
import {
  authenticateMcpTokenHash,
  mcpResource,
  type McpContext,
} from "@/lib/mcp-oauth";
import { oauthRate } from "@/lib/mcp-http";

const ticketSchema = z
  .object({
    cardId: z.number().int().positive().max(2147483647),
    attachmentId: z.number().int().positive().max(2147483647),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int().positive().safe(),
  })
  .strict();

function signature(payload: string) {
  return createHmac("sha256", deriveKey("mcp-attachment-download"))
    .update(`${mcpResource()}\0${payload}`)
    .digest();
}

export async function createMcpDownload(
  ctx: McpContext,
  cardId: number,
  attachmentId: number,
) {
  const resolved = await resolveApiAttachment(
    authorizedApiRequest(ctx, mcpResource()),
    String(cardId),
    String(attachmentId),
  );
  if (resolved instanceof NextResponse) return resolved;
  const expiresAt = Math.min(
    Date.now() + 5 * 60_000,
    ctx.accessTokenExpiresAt.getTime(),
  );
  const payload = Buffer.from(
    JSON.stringify({
      cardId,
      attachmentId,
      tokenHash: ctx.accessTokenHash,
      expiresAt,
    }),
  ).toString("base64url");
  const url = new URL(`${mcpResource()}/attachments/${cardId}/${attachmentId}`);
  url.searchParams.set(
    "ticket",
    `${payload}.${signature(payload).toString("base64url")}`,
  );
  return {
    url: url.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
    filename: resolved.attachment.filename,
    mimeType: resolved.attachment.mime,
    size: resolved.attachment.size,
  };
}

export async function downloadMcpAttachment(
  req: Request,
  cardId: string,
  attachmentId: string,
) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  const denied = () =>
    Response.json(
      {
        error:
          "Download-Link ungültig, abgelaufen oder nicht mehr freigegeben.",
      },
      { status: 404, headers },
    );
  if (!oauthRate(req, "attachment-download", 120))
    return Response.json(
      { error: "Zu viele Downloads." },
      { status: 429, headers },
    );
  const params = new URL(req.url).searchParams;
  if (params.getAll("ticket").length !== 1) return denied();
  const raw = params.get("ticket") ?? "";
  if (raw.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw))
    return denied();
  const [payload, encodedSignature] = raw.split(".");
  const supplied = Buffer.from(encodedSignature, "base64url");
  if (supplied.length !== 32 || !timingSafeEqual(signature(payload), supplied))
    return denied();
  let parsed;
  try {
    parsed = ticketSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    return denied();
  }
  if (!parsed.success) return denied();
  const ticket = parsed.data;
  if (
    ticket.expiresAt <= Date.now() ||
    String(ticket.cardId) !== cardId ||
    String(ticket.attachmentId) !== attachmentId
  )
    return denied();
  // A ticket grants access to one file only. It never replaces live OAuth,
  // membership and field-visibility checks, and contains no OAuth token.
  const ctx = await authenticateMcpTokenHash(ticket.tokenHash);
  if (!ctx) return denied();
  const response = await attachmentsApi(
    authorizedApiRequest(ctx, req.url),
    cardId,
    attachmentId,
  );
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}
