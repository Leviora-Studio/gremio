// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { User } from "@/lib/db/schema";
import { contentDisposition } from "@/lib/attachments";
import { protocolFilePath } from "@/lib/protocol-paths";
import { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials } from "@/lib/protocols";
import { readWebDavPdf, readWebDavImage, WebDavPdfError, type NcCredentials } from "@/lib/nextcloud";

const dependencies = { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials, readWebDavPdf };
type MediaTarget = string | { filename: string; subfolder?: string };

/** Shared response boundary, with injectable IO for authorization/path tests. */
export async function protocolPdfResponse(
  user: User | null,
  areaId: number,
  sessionId: number,
  filename: MediaTarget,
  deps = dependencies,
): Promise<Response> {
  return protocolMediaResponse(user, areaId, sessionId, filename, {
    ...deps,
    readMedia: async (creds, path) => ({ bytes: await deps.readWebDavPdf(creds, path), mime: "application/pdf" }),
  });
}

export async function protocolImageResponse(user: User | null, areaId: number, sessionId: number, filename: MediaTarget,
  deps = { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials, readWebDavImage },
): Promise<Response> {
  return protocolMediaResponse(user, areaId, sessionId, filename, { ...deps, readMedia: deps.readWebDavImage });
}

async function protocolMediaResponse(user: User | null, areaId: number, sessionId: number, location: MediaTarget,
  deps: Omit<typeof dependencies, "readWebDavPdf"> & { readMedia: (creds: NcCredentials, path: string) => Promise<{ bytes: Buffer; mime: string }> },
): Promise<Response> {
  const { filename, subfolder = "" } = typeof location === "string" ? { filename: location } : location;
  const error = (message: string, status: number) => new Response(message, {
    status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
  if (!user) return error("Unauthorized", 401);
  if (!Number.isSafeInteger(areaId) || areaId < 1 || !Number.isSafeInteger(sessionId) || sessionId < 1) return error("Not found", 404);
  const area = await deps.getProtocolAreaById(areaId);
  if (!area || !(await deps.canAccessProtocolArea(user, area))) return error("Not found", 404);
  const session = await deps.getProtocolSession(areaId, sessionId);
  if (!session) return error("Not found", 404);
  let path: string;
  try {
    path = protocolFilePath(area.rootPath, session.folderName, filename, subfolder);
  } catch { return error("Ungültiger Dateiname oder Sitzungsordner.", 400); }
  try {
    const { bytes, mime } = await deps.readMedia(deps.protocolCredentials(area), path);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": mime,
      "Content-Disposition": contentDisposition(filename, "inline"),
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    } });
  } catch (cause) {
    if (cause instanceof WebDavPdfError) return error(cause.message, cause.status);
    if ((cause as { status?: number })?.status === 404) return error("Datei nicht gefunden.", 404);
    // Never forward WebDAV errors, URLs or credentials to the browser.
    return error("Die Datei konnte nicht aus Nextcloud geladen werden.", 502);
  }
}
