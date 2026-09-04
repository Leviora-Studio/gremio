// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { spawn } from "node:child_process";
import path from "node:path";

export type ProtocolPdfRenderInput = { markdown: string; sourceName: string; logo: string | null; images: Record<string, { data: string; mime: string }> };
const runtime = globalThis as typeof globalThis & { protocolPdfJobs?: number };

/** No shell, no application secrets in the child, bounded time/memory/output and concurrency. */
export async function renderProtocolPdf(input: ProtocolPdfRenderInput): Promise<Buffer> {
  if ((runtime.protocolPdfJobs ?? 0) >= 2) throw new Error("Der PDF-Export ist gerade ausgelastet. Bitte kurz warten.");
  const payload = JSON.stringify(input);
  if (Buffer.byteLength(payload) > 40 * 1024 * 1024) throw new Error("Die Exportdaten sind zu groß.");
  runtime.protocolPdfJobs = (runtime.protocolPdfJobs ?? 0) + 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(process.env.PROTOCOL_PDF_PYTHON || "python3", [path.join(process.cwd(), "scripts/protocol-pdf/render.py")], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1", ...(process.env.DYLD_FALLBACK_LIBRARY_PATH ? { DYLD_FALLBACK_LIBRARY_PATH: process.env.DYLD_FALLBACK_LIBRARY_PATH } : {}) },
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let stopped = false;
      const stop = (message: string) => { if (stopped) return; stopped = true; child.kill("SIGKILL"); reject(new Error(message)); };
      const timer = setTimeout(() => stop("Der PDF-Export hat das Zeitlimit überschritten. Bitte das Protokoll kürzen oder später erneut versuchen."), 60_000);
      child.on("error", () => { clearTimeout(timer); stop("Der PDF-Renderer ist nicht verfügbar. Bitte die serverseitige Python-/WeasyPrint-Installation prüfen."); });
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) stop("Das erzeugte PDF ist größer als 25 MB.");
        else chunks.push(chunk);
      });
      // Never echo renderer diagnostics: Markdown, paths or URLs may be sensitive.
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.on("close", code => {
        clearTimeout(timer);
        if (stopped) return;
        const pdf = Buffer.concat(chunks);
        if (code !== 0 || pdf.subarray(0, 5).toString() !== "%PDF-") return reject(new Error("PDF-Erzeugung fehlgeschlagen. Bitte YAML und Bildverweise prüfen; nur Bilder aus dem Sitzungsordner sind zulässig. Falls das Protokoll korrekt ist, die Renderer-Installation prüfen."));
        resolve(pdf);
      });
      child.stdin.end(payload);
    });
  } finally { runtime.protocolPdfJobs = Math.max(0, (runtime.protocolPdfJobs ?? 1) - 1); }
}
