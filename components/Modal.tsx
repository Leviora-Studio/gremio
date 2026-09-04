// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  children,
  headerActions,
  showCloseButton = true,
  portal = false,
  manageFocus = false,
  keepMounted = false,
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
  portal?: boolean;
  manageFocus?: boolean;
  keepMounted?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const frame = manageFocus ? requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('button, input, textarea, [tabindex="0"]')?.focus()) : null;
    const onKey = (e: KeyboardEvent) => {
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals.item(modals.length - 1) !== panel.current) return;
      if (e.key === "Escape") close.current();
      if (manageFocus && e.key === "Tab" && !((e.target as Element)?.closest('[data-app-popover]'))) {
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), [tabindex="0"]') ?? [])].filter(node => node.getClientRects().length);
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (frame !== null) cancelAnimationFrame(frame);
      if (manageFocus && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, manageFocus]);

  if (!open && !keepMounted) return null;
  if (portal && typeof document === "undefined") return null;

  const content = (
    <div
      style={!open ? { display: "none" } : undefined}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal={open ? "true" : undefined}
        aria-labelledby={titleId}
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
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
  return portal ? createPortal(content, document.body) : content;
}
