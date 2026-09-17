// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcp, mcpResource, oauthOrigin } from "@/lib/mcp-oauth";
import { createMcpServer } from "@/lib/mcp-tools";
import { readLimitedBody } from "@/lib/public-api";
import { oauthRate } from "@/lib/mcp-http";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function unauthorized() {
  return Response.json(
    { error: "invalid_token" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer resource_metadata="${oauthOrigin()}/.well-known/oauth-protected-resource/api/mcp", scope="gremio"`,
      },
    },
  );
}
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  // Remote agents omit Origin. Browser integrations require the canonical origin;
  // no wildcard CORS and no ambient session-cookie authentication.
  if (origin && origin !== oauthOrigin())
    return Response.json({ error: "Invalid Origin" }, { status: 403 });
  if (
    (req.headers.get("host") ?? new URL(req.url).host) !==
    new URL(mcpResource()).host
  )
    return Response.json({ error: "Invalid Host" }, { status: 403 });
  if (!oauthRate(req, "requests", 300))
    return Response.json({ error: "Too many requests" }, { status: 429 });
  const header = req.headers.get("authorization");
  if (!(await authenticateMcp(header))) return unauthorized();
  const body = await readLimitedBody(
    req,
    Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 65536,
  );
  if (!body.ok)
    return Response.json(
      { error: "Request too large or unreadable" },
      { status: 413 },
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body.body));
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const server = createMcpServer(() => authenticateMcp(header));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(req, { parsedBody: parsed });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await server.close();
  }
}
export async function GET(req: Request) {
  if (!(await authenticateMcp(req.headers.get("authorization"))))
    return unauthorized();
  return new Response(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}
export async function DELETE(req: Request) {
  return GET(req);
}
