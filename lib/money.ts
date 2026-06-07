// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

/**
 * Obergrenze für Beträge in Cent. Bleibt unter dem int4-Maximum
 * (2.147.483.647) der Betragsspalten → kein DB-Overflow/500.
 */
export const MAX_AMOUNT_CENTS = 2_000_000_000; // 20.000.000,00 €

/** Euro-Eingabe ("1234", "1234,56", "1.234,56", "1234.56") → Cent (int) | null. */
export function parseEuroToCents(input: string): number | null {
  let s = input.trim().replace(/[\s€]/g, "");
  if (s === "") return null;
  if (s.includes(",")) {
    // Komma = Dezimaltrenner, Punkte = Tausender
    s = s.replace(/\./g, "").replace(",", ".");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  // Unrealistisch große Eingaben abweisen (Overflow-/Präzisionsschutz).
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/** Cent → Anzeige "1.234,56 €". */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (
    (cents / 100).toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

/** Cent → Eingabe-String "1234,56" (zum Editieren). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
