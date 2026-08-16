// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useRouter } from "next/navigation";

/**
 * Globaler In-App-Zurück-Button: geht einen Schritt zurück (wie der
 * Browser-Zurück-Knopf). Fällt auf die Startseite zurück, wenn es keine
 * In-App-Historie gibt (z.B. nach Direkteinstieg per Link).
 *
 * Ohne `label`: kompakter Icon-Button (für die globale Leiste).
 * Mit `label`: Text-Variante (z.B. in der Kartenansicht neben dem Board-Link).
 */
export function BackButton({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const go = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/intern");
    }
  };

  if (label) {
    return (
      <button
        type="button"
        onClick={go}
        className={
          className ??
          "inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
        }
      >
        <span aria-hidden>←</span> {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label="Zurück"
      title="Zurück"
      onClick={go}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50"
    >
      <span aria-hidden className="text-lg leading-none">
        ←
      </span>
    </button>
  );
}
