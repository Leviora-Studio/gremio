// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { randomUUID } from "node:crypto";
import type { User } from "@/lib/db/schema";
import { resolveMarkdownDocument, MarkdownDocumentError, type MarkdownTarget } from "@/lib/markdown-documents";
import { normalizeProtocolLogo } from "@/lib/protocol-logos";
import { createWebDavDirectoryExclusive, statWebDavEntry, writeWebDavBinary } from "@/lib/nextcloud";
import { protocolDirectoryPath, protocolFilePath } from "@/lib/protocol-paths";
import type { MarkdownImageUploadResult } from "@/lib/markdown-images";

const dependencies = { resolveMarkdownDocument, normalizeProtocolLogo, createWebDavDirectoryExclusive, statWebDavEntry, writeWebDavBinary, randomUUID };

export async function uploadMarkdownImage(user: User, target: MarkdownTarget, file: File, deps = dependencies): Promise<MarkdownImageUploadResult> {
  try {
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) throw new MarkdownDocumentError("Bitte ein Bild mit maximal 5 MB auswählen (PNG, JPEG, GIF oder WebP).");
    const context = await deps.resolveMarkdownDocument(user, target);
    let png: Buffer;
    try { png = await deps.normalizeProtocolLogo(Buffer.from(await file.arrayBuffer())); }
    catch { throw new MarkdownDocumentError("Das Bild ist beschädigt oder zu groß. Erlaubt sind PNG, JPEG, GIF und WebP bis 5 MB und 16 Megapixel."); }
    const stem = file.name.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "Bild";
    const filename = `${stem}-${deps.randomUUID()}.png`;
    const subfolder = [target.subfolder, "attachments"].filter(Boolean).join("/");
    const folderPath = protocolDirectoryPath(context.area.rootPath, context.session.folderName, subfolder);
    await deps.createWebDavDirectoryExclusive(context.creds, folderPath);
    if ((await deps.statWebDavEntry(context.creds, folderPath)).type !== "directory") throw new MarkdownDocumentError("Unter „attachments“ liegt bereits eine Datei statt eines Ordners.");
    await deps.resolveMarkdownDocument(user, target);
    const path = protocolFilePath(context.area.rootPath, context.session.folderName, filename, subfolder);
    if (!(await deps.writeWebDavBinary(context.creds, path, png, "image/png", false))) throw new MarkdownDocumentError("Der Bildname ist bereits vergeben. Bitte erneut versuchen.");
    return { reference: `attachments/${encodeURIComponent(filename)}`, alt: file.name.replace(/\.[^.]*$/, "") || "Bild" };
  } catch (error) {
    return { error: error instanceof MarkdownDocumentError ? error.message : "Der Bild-Upload konnte nicht bestätigt werden. Bitte den attachments-Ordner prüfen, bevor du es erneut versuchst." };
  }
}
