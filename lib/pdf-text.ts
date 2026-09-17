// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";

export type PdfTextResult = {
  totalPages: number;
  pages: {
    page: number;
    text: string;
    formFields: { name: string; type: string; value: string }[];
    hasText: boolean;
  }[];
  text: string;
  nextPage: number | null;
  truncated: boolean;
  warnings: string[];
};
export class PdfTextError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

/** Limit CPU time, concurrent extraction and worker memory for untrusted PDFs. */
export async function extractPdfText(
  bytes: Uint8Array,
  startPage = 1,
  pageLimit = 10,
): Promise<PdfTextResult> {
  if (
    !Number.isInteger(startPage) ||
    startPage < 1 ||
    !Number.isInteger(pageLimit) ||
    pageLimit < 1 ||
    pageLimit > 20
  )
    throw new PdfTextError("Ungültige Seitenauswahl.", 400);
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new PdfTextError("PDF größer als 25 MiB.", 413);
  const state = globalThis as typeof globalThis & {
    __gremioPdfTextActive?: number;
  };
  if ((state.__gremioPdfTextActive ?? 0) >= 2)
    throw new PdfTextError(
      "PDF-Verarbeitung ausgelastet. Bitte später erneut versuchen.",
      429,
    );
  state.__gremioPdfTextActive = (state.__gremioPdfTextActive ?? 0) + 1;
  let worker: Worker | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<PdfTextResult>((resolve, reject) => {
      worker = new Worker(join(process.cwd(), "scripts/pdf-text-worker.mjs"), {
        workerData: { bytes, startPage, pageLimit },
        execArgv: [],
        env: {},
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
        },
      });
      // Parser diagnostics can contain document content. Do not log them.
      worker.stdout.resume();
      worker.stderr.resume();
      timer = setTimeout(
        () =>
          reject(
            new PdfTextError(
              "PDF-Verarbeitung hat das Zeitlimit überschritten.",
              422,
            ),
          ),
        15_000,
      );
      worker.once(
        "message",
        (message: { ok: boolean; result: PdfTextResult; code: string }) => {
          if (message.ok) resolve(message.result);
          else
            reject(
              new PdfTextError(
                message.code === "password"
                  ? "Passwortgeschützte PDFs können nicht gelesen werden."
                  : message.code === "page"
                    ? "Die angeforderte Seite existiert nicht."
                    : message.code === "xfa"
                      ? "XFA-Formulare werden nicht unterstützt."
                      : "PDF-Inhalt konnte nicht gelesen werden.",
                message.code === "page" ? 400 : 422,
              ),
            );
        },
      );
      worker.once("error", () =>
        reject(new PdfTextError("PDF-Verarbeitung fehlgeschlagen.")),
      );
      worker.once("exit", () =>
        reject(new PdfTextError("PDF-Verarbeitung wurde abgebrochen.")),
      );
    });
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    state.__gremioPdfTextActive!--;
  }
}
