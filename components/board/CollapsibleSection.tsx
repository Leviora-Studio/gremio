// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import type { ReactNode } from "react";

/**
 * Ausklappbarer Einstellungs-Block (natives <details>, kein Client-JS).
 * Standardmäßig eingeklappt — sorgt für eine übersichtliche Settings-Seite.
 */
export function CollapsibleSection({
  title,
  children,
  className,
  contentClassName,
  defaultOpen,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className={`collapsible card ${className ?? ""}`}
      {...(defaultOpen ? { open: true } : {})}
    >
      {/* Padding liegt auf dem summary → die ganze (eingeklappte) Box ist klickbar. */}
      <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg p-5 text-lg font-semibold text-slate-800 hover:bg-slate-50">
        <span>{title}</span>
        <svg
          className="chev h-5 w-5 shrink-0 text-slate-400 transition-transform"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className={`px-5 pb-5 ${contentClassName ?? ""}`}>{children}</div>
    </details>
  );
}
