// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { mcpResource, oauthOrigin, oauthScope } from "@/lib/mcp-oauth";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({
    resource: mcpResource(),
    authorization_servers: [oauthOrigin()],
    scopes_supported: [oauthScope],
    bearer_methods_supported: ["header"],
    resource_name: "Gremio MCP",
  });
}
