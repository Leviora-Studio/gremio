// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import Link from "next/link";

/**
 * Navigation zwischen den öffentlichen Bereichen (Antrag · Feedback · Inventar).
 * Der aktuelle Bereich wird über `current` markiert und nicht verlinkt.
 *
 * Bewusst eine schlichte Button-Reihe im vorhandenen Stil statt einer neuen
 * Navigationskomponente — die öffentlichen Seiten haben absichtlich keinen
 * globalen Header.
 */
const AREAS = [
  { key: "antrag", href: "/", label: "📝 Antrag stellen" },
  { key: "feedback", href: "/feedback", label: "💬 Feedback geben" },
  { key: "inventar", href: "/inventar", label: "📦 Inventar & Ausleihe" },
] as const;

export type PublicArea = (typeof AREAS)[number]["key"];

export function PublicNav({ current }: { current: PublicArea }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {AREAS.map((a) =>
        a.key === current ? (
          <span
            key={a.key}
            aria-current="page"
            className="rounded-md bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
          >
            {a.label}
          </span>
        ) : (
          <Link
            key={a.key}
            href={a.href}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
          >
            {a.label} →
          </Link>
        ),
      )}
    </nav>
  );
}
