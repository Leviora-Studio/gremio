// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { ApiContext } from "@/lib/api-token";
// Only server code can attach a context to this exact Request object. No header,
// cookie, or serializable property can impersonate an authorized MCP request.
const contexts = new WeakMap<Request, ApiContext>();
export function authorizedApiRequest(
  ctx: ApiContext,
  url: string,
  init?: RequestInit,
) {
  const req = new Request(url, init);
  contexts.set(req, ctx);
  return req;
}
export function internalApiContext(req: Request) {
  return contexts.get(req);
}
