// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import path from "node:path";
import type { User } from "@/lib/db/schema";
import { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials } from "@/lib/protocols";
import { readWebDavImage, readWebDavText, statWebDavEntry, writeWebDavBinary } from "@/lib/nextcloud";
import { protocolDeletionPath } from "@/lib/protocol-deletion";
import { protocolFilePath } from "@/lib/protocol-paths";
import { markdownImageLocation } from "@/lib/markdown-images";
import { parseProtocolFrontmatter } from "@/lib/protocol-frontmatter";
import { getProtocolLogos, getProtocolLogoBytes, normalizeProtocolLogo } from "@/lib/protocol-logos";
import { renderProtocolPdf, type ProtocolPdfRenderInput } from "@/lib/protocol-pdf-renderer";
import { renderResultProtocolFilename } from "@/lib/result-protocol-filename";

export type ProtocolExportInput = { filename: string; logoId: number | null };
export type ProtocolExportResult = { success?: string; error?: string };
class ExportError extends Error {}
const dependencies = { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials, readWebDavImage, readWebDavText, statWebDavEntry, writeWebDavBinary, getProtocolLogos, getProtocolLogoBytes, normalizeProtocolLogo, renderProtocolPdf };

export async function exportProtocolPdf(user: User, areaId: number, sessionId: number, folderName: string, sourceName: string, input: ProtocolExportInput, deps = dependencies): Promise<ProtocolExportResult> {
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
    const protocolName = path.posix.basename(session.protocolPath);
    if (protocolDeletionPath(area.rootPath, folderName, protocolName) !== session.protocolPath) throw new ExportError("Die Verlaufsprotokolldatei liegt nicht im Sitzungsordner.");
    const isSourceProtocol = sourceName === protocolName;
    if (!isSourceProtocol) {
      let resultName: string;
      try { resultName = renderResultProtocolFilename(area.resultFilePattern, area.name, session.folderName, session.sessionDate, protocolName); }
      catch { throw new ExportError("Das Ergebnisprotokoll ist nicht eindeutig konfiguriert. Bitte die Bereichseinstellungen prüfen."); }
      if (sourceName !== resultName) throw new ExportError("Nur das Verlaufs- oder Ergebnisprotokoll kann exportiert werden.");
    }
    const sourcePath = protocolDeletionPath(area.rootPath, folderName, sourceName);
    const creds = deps.protocolCredentials(area);
    const assertFolder = async () => {
      const folder = await deps.statWebDavEntry(creds, folderPath);
      if (folder.type !== "directory" || (session.folderFileId && folder.fileId !== session.folderFileId)) throw new ExportError("Der Sitzungsordner wurde verändert. Bitte neu laden.");
    };
    await assertFolder();
    const sourceStat = await deps.statWebDavEntry(creds, sourcePath);
    if (sourceStat.type !== "file" || (isSourceProtocol && session.protocolFileId && sourceStat.fileId !== session.protocolFileId)) throw new ExportError("Die Protokolldatei wurde ersetzt oder entfernt. Bitte neu laden.");
    const source = await deps.readWebDavText(creds, sourcePath);
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
    }
    const images: ProtocolPdfRenderInput["images"] = {};
    // Local Markdown images (including reference definitions) and HTML img sources.
    const references = [...parsed.body.matchAll(/!\[(?:\\.|[^\]\\])*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?|<img\b[^>]*\bsrc=["']([^"']+)["']/gmi)]
      .map(match => match[1] ?? match[2] ?? match[3]).filter(value => !/^(?:https?:|#|mailto:)/i.test(value));
    if (new Set(references).size > 30) throw new ExportError("Das Protokoll enthält zu viele Bildverweise (maximal 30).");
    let imageBytes = 0;
    for (const reference of new Set(references)) {
      // Reference definitions can also describe ordinary document links.
      if (!/\.(png|jpe?g|webp|gif)$/i.test(reference)) continue;
      const location = markdownImageLocation(reference);
      if (!location) throw new ExportError("Bilder müssen mit einem relativen Pfad innerhalb des Sitzungsordners verlinkt sein.");
      const image = await deps.readWebDavImage(creds, protocolFilePath(area.rootPath, folderName, location.filename, location.subfolder));
      const png = await deps.normalizeProtocolLogo(image.bytes);
      imageBytes += png.length;
      if (imageBytes > 20 * 1024 * 1024) throw new ExportError("Die eingebundenen Bilder sind zusammen größer als 20 MB.");
      images[location.relativePath] = { data: png.toString("base64"), mime: "image/png" };
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
