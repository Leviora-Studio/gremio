// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiAttachment } from "@/lib/api-card-extras";
import { apiError } from "@/lib/api";
import { absPath } from "@/lib/attachments";
import { extractPdfText, PdfTextError } from "@/lib/pdf-text";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { rateLimit } from "@/lib/rate-limit";

export async function attachmentTextApi(
  req: Request,
  id: string,
  attachmentId: string,
) {
  const resolved = await resolveApiAttachment(req, id, attachmentId);
  if (resolved instanceof NextResponse) return resolved;
  if (resolved.attachment.mime !== "application/pdf")
    return apiError(415, "Textextraktion ist nur für PDFs verfügbar.");
  const params = new URL(req.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    return apiError(400, "Ungültige Seitenauswahl.");
  const query = z
    .object({
      startPage: z.coerce.number().int().min(1).max(1_000_000).default(1),
      pageLimit: z.coerce.number().int().min(1).max(20).default(10),
    })
    .strict()
    .safeParse(Object.fromEntries(params));
  if (!query.success) return apiError(400, "Ungültige Seitenauswahl.");
  if (!rateLimit(`pdf-text:${resolved.ctx.user.id}`, 30, 60_000))
    return apiError(429, "Zu viele PDF-Leseanfragen.");
  let bytes: Buffer;
  try {
    const path = absPath(resolved.attachment.path);
    if ((await stat(path)).size > MAX_UPLOAD_BYTES)
      return apiError(413, "PDF größer als 25 MiB.");
    bytes = await readFile(path);
  } catch {
    return apiError(404, "Datei nicht gefunden.");
  }
  try {
    const result = await extractPdfText(
      bytes,
      query.data.startPage,
      query.data.pageLimit,
    );
    return NextResponse.json(
      {
        attachmentId: resolved.attachment.id,
        filename: resolved.attachment.filename,
        ...result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return error instanceof PdfTextError
      ? apiError(error.status, error.message)
      : apiError(422, "PDF-Inhalt konnte nicht gelesen werden.");
  }
}
