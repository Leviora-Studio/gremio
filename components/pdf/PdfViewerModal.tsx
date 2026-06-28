// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import type { PdfEditorProps } from "./PdfEditor";

const PdfEditor = dynamic(() => import("./PdfEditor"), {
  ssr: false,
  loading: () => (
    <p className="p-6 text-sm text-slate-500">Viewer wird geladen…</p>
  ),
});

export type PdfViewerModalProps = {
  open: boolean;
  onClose: () => void;
  src: string;
  filename: string;
  mime: string;
  attachmentId: number;
  editable: boolean;
  hasCert: boolean;
  fieldsUrl?: string;
  saveAction?: PdfEditorProps["saveAction"];
};

export function PdfViewerModal({
  open,
  onClose,
  src,
  filename,
  mime,
  attachmentId,
  editable,
  hasCert,
  fieldsUrl,
  saveAction,
}: PdfViewerModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {isPdf ? (
          <PdfEditor
            src={src}
            filename={filename}
            attachmentId={attachmentId}
            editable={editable}
            hasCert={hasCert}
            onClose={onClose}
            fieldsUrl={fieldsUrl}
            saveAction={saveAction}
          />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="max-w-[70%] truncate text-sm font-medium" title={filename}>
                {filename}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={src}
                  target="_blank"
                  rel="noopener"
                  className="btn-secondary btn-sm"
                >
                  Herunterladen
                </a>
                <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
                  Schließen
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-slate-100 p-3">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={filename} className="max-w-full" />
              ) : (
                <p className="p-6 text-sm text-slate-600">
                  Vorschau nicht möglich.{" "}
                  <a href={src} target="_blank" rel="noopener" className="text-brand-600 underline">
                    Datei öffnen
                  </a>
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
