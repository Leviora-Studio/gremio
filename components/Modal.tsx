// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  headerActions,
  showCloseButton = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  /**
   * X-Button in der Kopfzeile. Default `true` — nur Modals, die bewusst eigene
   * Abschluss-Buttons anbieten (z. B. „Neue Karte" mit Verwerfen/Fertig),
   * schalten ihn ab. Escape und Backdrop rufen weiterhin `onClose` auf.
   */
  showCloseButton?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            {headerActions}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Schließen"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
