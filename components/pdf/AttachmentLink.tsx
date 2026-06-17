// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { PdfViewerModal } from "./PdfViewerModal";

export type AttachmentLinkProps = {
  id: number;
  filename: string;
  mime: string;
  /** Abruf-URL (intern: /api/attachment/{id}, öffentlich: /api/status/{token}/attachment/{id}). */
  src: string;
  /** Bearbeiten/Signieren erlaubt (intern, eingeloggt). Öffentlich = false. */
  editable?: boolean;
  /** Hat der Nutzer ein Signatur-Zertifikat hinterlegt? */
  hasCert?: boolean;
  /** Anzeigetext (Standard: Dateiname). */
  label?: string;
  className?: string;
};

/**
 * Öffnet einen Anhang im integrierten Viewer/Editor statt im Browser-Tab.
 * Nicht darstellbare Typen fallen auf einen normalen Download-Link zurück.
 */
export function AttachmentLink({
  id,
  filename,
  mime,
  src,
  editable = false,
  hasCert = false,
  label,
  className,
}: AttachmentLinkProps) {
  const [open, setOpen] = useState(false);
  const viewable = mime === "application/pdf" || mime.startsWith("image/");
  const text = label ?? filename;

  if (!viewable) {
    return (
      <a href={src} target="_blank" rel="noopener" className={className}>
        📄 {text}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx("inline text-left", className)}
        title="Im Viewer öffnen"
      >
        📄 {text}
      </button>
      <PdfViewerModal
        open={open}
        onClose={() => setOpen(false)}
        src={src}
        filename={filename}
        mime={mime}
        attachmentId={id}
        editable={editable}
        hasCert={hasCert}
      />
    </>
  );
}
