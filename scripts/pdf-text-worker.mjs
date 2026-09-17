// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Input is bytes only. Never load URLs, run PDF actions, or render a document.
globalThis.fetch = async () => {
  throw new Error("Network access disabled");
};
const require = createRequire(import.meta.url);
const assets = dirname(require.resolve("pdfjs-dist/package.json"));
let task;
try {
  task = getDocument({
    data: new Uint8Array(workerData.bytes),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    cMapUrl: join(assets, "cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: join(assets, "standard_fonts/"),
  });
  const pdf = await task.promise;
  if (pdf.isPureXfa) throw Object.assign(new Error(), { code: "xfa" });
  const { startPage, pageLimit } = workerData;
  if (startPage > pdf.numPages)
    throw Object.assign(new Error(), { code: "page" });
  const end = Math.min(pdf.numPages, startPage + pageLimit - 1);
  let remaining = 200_000;
  let truncated = false;
  const bounded = (value) => {
    const text = String(value ?? "").replace(/\u0000/g, "");
    const result = text.slice(0, remaining);
    remaining -= result.length;
    if (result.length < text.length) truncated = true;
    return result;
  };
  const pages = [];
  for (let pageNumber = startPage; pageNumber <= end; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const stream = page.streamTextContent().getReader();
    let text = "";
    try {
      while (true) {
        const chunk = await stream.read();
        if (chunk.done) break;
        for (const item of chunk.value.items) {
          if (!("str" in item)) continue;
          text += bounded(item.str + (item.hasEOL ? "\n" : " "));
        }
        if (remaining === 0) {
          truncated = true;
          await stream.cancel();
          break;
        }
      }
    } finally {
      stream.releaseLock();
    }
    const formFields = [];
    const seen = new Set();
    for (const field of await page.getAnnotations({ intent: "any" })) {
      if (
        !field.fieldName ||
        !["Tx", "Btn", "Ch"].includes(field.fieldType) ||
        field.pushButton
      )
        continue;
      if (seen.has(field.fieldName)) continue;
      seen.add(field.fieldName);
      if (remaining === 0 || formFields.length >= 500) {
        truncated = true;
        break;
      }
      const raw = field.fieldValue;
      const value = Array.isArray(raw)
        ? raw.map(String).join(", ")
        : String(raw ?? "");
      formFields.push({
        name: bounded(field.fieldName),
        type:
          field.fieldType === "Tx"
            ? "text"
            : field.fieldType === "Ch"
              ? "choice"
              : field.radioButton
                ? "radio"
                : "checkbox",
        value: bounded(value),
      });
    }
    pages.push({
      page: pageNumber,
      text: text.trim(),
      formFields,
      hasText: !!text.trim() || formFields.some((field) => !!field.value),
    });
    page.cleanup();
    if (remaining === 0) break;
  }
  const lastPage = pages.at(-1).page;
  const nextPage = lastPage < pdf.numPages ? lastPage + 1 : null;
  parentPort.postMessage({
    ok: true,
    result: {
      totalPages: pdf.numPages,
      pages,
      nextPage,
      truncated,
      text: pages
        .map((page) =>
          [
            `--- Seite ${page.page} ---`,
            page.text,
            ...page.formFields.map((field) => `${field.name}: ${field.value}`),
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n"),
      warnings: [
        ...(pages.some((page) => !page.hasText)
          ? [
              "Mindestens eine Seite enthält keinen extrahierbaren Text. Gescannte Inhalte benötigen OCR; Gremio führt keine OCR aus.",
            ]
          : []),
        ...(truncated
          ? [
              "Die Text- oder Formularfeldgrenze wurde erreicht; das Ergebnis ist unvollständig.",
            ]
          : []),
      ],
    },
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code:
      error?.name === "PasswordException"
        ? "password"
        : error?.code === "page"
          ? "page"
          : error?.code === "xfa"
            ? "xfa"
            : "invalid",
  });
} finally {
  await task?.destroy().catch(() => {});
}
