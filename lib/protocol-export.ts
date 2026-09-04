// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import path from "node:path";
import type { User } from "@/lib/db/schema";
import { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials } from "@/lib/protocols";
import { readWebDavImage, readWebDavText, statWebDavEntry, writeWebDavBinary } from "@/lib/nextcloud";
import { protocolDeletionPath } from "@/lib/protocol-deletion";
import { parseProtocolFrontmatter } from "@/lib/protocol-frontmatter";
import { getProtocolLogos, getProtocolLogoBytes, normalizeProtocolLogo } from "@/lib/protocol-logos";
import { renderProtocolPdf, type ProtocolPdfRenderInput } from "@/lib/protocol-pdf-renderer";

export type ProtocolExportInput = { filename: string; logoId: number | null };
export type ProtocolExportResult = { success?: string; error?: string };
class ExportError extends Error {}
const dependencies = { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials, readWebDavImage, readWebDavText, statWebDavEntry, writeWebDavBinary, getProtocolLogos, getProtocolLogoBytes, normalizeProtocolLogo, renderProtocolPdf };

export async function exportProtocolPdf(user: User, areaId: number, sessionId: number, folderName: string, input: ProtocolExportInput, deps = dependencies): Promise<ProtocolExportResult> {
  try {
    if (!Number.isSafeInteger(areaId) || areaId < 1 || !Number.isSafeInteger(sessionId) || sessionId < 1) throw new ExportError("Ungültige Sitzung.");
    const area = await deps.getProtocolAreaById(areaId);
    if (!area || !(await deps.canAccessProtocolArea(user, area))) throw new ExportError("Kein Zugriff auf diesen Protokollbereich.");
    const session = await deps.getProtocolSession(areaId, sessionId);
    if (!session?.protocolPath || session.folderName !== folderName) throw new ExportError("Protokoll nicht gefunden oder Sitzung umbenannt. Bitte neu laden.");
    if (!input || typeof input.filename !== "string" || !/\.pdf$/i.test(input.filename) || Buffer.byteLength(input.filename) > 255 || input.filename.startsWith(".")) throw new ExportError("Bitte einen einfachen Dateinamen mit der Endung .pdf eingeben.");
    let outputPath: string;
    const folderPath = protocolDeletionPath(area.rootPath, folderName);
    try { outputPath = protocolDeletionPath(area.rootPath, folderName, input.filename); }
    catch { throw new ExportError("Der PDF-Dateiname darf keine Pfadtrenner enthalten."); }
    const sourceName = path.posix.basename(session.protocolPath);
    if (protocolDeletionPath(area.rootPath, folderName, sourceName) !== session.protocolPath) throw new ExportError("Die Protokolldatei liegt nicht im Sitzungsordner.");
    const creds = deps.protocolCredentials(area);
    const assertFolder = async () => {
      const folder = await deps.statWebDavEntry(creds, folderPath);
      if (folder.type !== "directory" || (session.folderFileId && folder.fileId !== session.folderFileId)) throw new ExportError("Der Sitzungsordner wurde verändert. Bitte neu laden.");
    };
    await assertFolder();
    const sourceStat = await deps.statWebDavEntry(creds, session.protocolPath);
    if (sourceStat.type !== "file" || (session.protocolFileId && sourceStat.fileId !== session.protocolFileId)) throw new ExportError("Die Protokolldatei wurde ersetzt. Bitte neu laden.");
    const source = await deps.readWebDavText(creds, session.protocolPath);
    if (sourceStat.etag && source.stat.etag && sourceStat.etag !== source.stat.etag) throw new ExportError("Die Protokolldatei wurde während des Ladens geändert. Bitte erneut exportieren.");
    let parsed: ReturnType<typeof parseProtocolFrontmatter>;
    try { parsed = parseProtocolFrontmatter(source.content); } catch (cause) { throw new ExportError((cause as Error).message); }
    const logos = await deps.getProtocolLogos(areaId);
    if (input.logoId !== null && (!Number.isSafeInteger(input.logoId) || !logos.some(logo => logo.id === input.logoId))) throw new ExportError("Das ausgewählte Logo gehört nicht zu diesem Bereich oder wurde entfernt.");
    const logoId = input.logoId ?? logos.find(logo => logo.isDefault)?.id ?? logos[0]?.id;
    let logo: Buffer | null = null;
    if (logoId) {
      logo = await deps.getProtocolLogoBytes(areaId, logoId);
      if (!logo) throw new ExportError("Das Logo wurde entfernt. Bitte den Exportdialog erneut öffnen.");
    } else {
      const name = parsed.fields.logo || "logo.png";
      let logoPath: string;
      try { logoPath = protocolDeletionPath(area.rootPath, folderName, name); } catch { throw new ExportError("Das YAML-Logo muss eine Bilddatei direkt im Sitzungsordner sein, kein externer oder absoluter Pfad."); }
      try { logo = await deps.normalizeProtocolLogo((await deps.readWebDavImage(creds, logoPath)).bytes); }
      catch (cause) { if (parsed.fields.logo || (cause as { status?: number }).status !== 404) throw new ExportError("Das im YAML angegebene Logo konnte nicht aus dem Sitzungsordner geladen werden."); }
    }
    const images: ProtocolPdfRenderInput["images"] = {};
    // Local Markdown images (including reference definitions) and HTML img sources.
    const references = [...parsed.body.matchAll(/!\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?|<img\b[^>]*\bsrc=["']([^"']+)["']/gmi)]
      .map(match => match[1] ?? match[2] ?? match[3]).filter(value => !/^(?:https?:|#|mailto:)/i.test(value));
    if (new Set(references).size > 30) throw new ExportError("Das Protokoll enthält zu viele Bildverweise (maximal 30).");
    let imageBytes = 0;
    for (const reference of new Set(references)) {
      let name: string;
      try { name = decodeURIComponent(reference.replace(/^\.\//, "")); protocolDeletionPath(area.rootPath, folderName, name); }
      catch { throw new ExportError("Bilder müssen direkt im Sitzungsordner liegen; externe oder verschachtelte Bildpfade sind nicht erlaubt."); }
      if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) continue;
      const image = await deps.readWebDavImage(creds, protocolDeletionPath(area.rootPath, folderName, name));
      const png = await deps.normalizeProtocolLogo(image.bytes);
      imageBytes += png.length;
      if (imageBytes > 20 * 1024 * 1024) throw new ExportError("Die eingebundenen Bilder sind zusammen größer als 20 MB.");
      images[name] = { data: png.toString("base64"), mime: "image/png" };
    }
    let pdf: Buffer;
    try { pdf = await deps.renderProtocolPdf({ markdown: source.content, sourceName, logo: logo?.toString("base64") ?? null, images }); }
    catch (cause) { throw new ExportError((cause as Error).message); }
    await assertFolder();
    if (!(await deps.writeWebDavBinary(creds, outputPath, pdf, "application/pdf", false))) throw new ExportError("Eine Datei mit diesem Namen existiert bereits und wurde nicht überschrieben. Bitte einen anderen Dateinamen wählen.");
    return { success: `„${input.filename}“ wurde im Sitzungsordner abgelegt.` };
  } catch (cause) {
    return { error: cause instanceof ExportError ? cause.message : "Der Export konnte nicht bestätigt werden. Bitte Nextcloud und die Dateiliste prüfen, bevor du es erneut versuchst." };
  }
}
