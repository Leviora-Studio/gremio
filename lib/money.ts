// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

/**
 * Obergrenze für Beträge in Cent. Bleibt unter dem int4-Maximum
 * (2.147.483.647) der Betragsspalten → kein DB-Overflow/500.
 */
export const MAX_AMOUNT_CENTS = 2_000_000_000; // 20.000.000,00 €

/**
 * Euro-Eingabe → Cent (int) | null. Erkennt deutsche UND punkt-dezimale Eingabe:
 *   "1234", "1234,56", "1.234,56", "1234.56", "12.50" (→ 12,50), "12.5" (→ 12,50),
 *   "1.234" / "12.500" / "1.000.000" (→ Tausenderpunkte).
 * Regel für reine Punkt-Eingabe: EIN Punkt mit 1–2 Nachkommastellen = Dezimal;
 * sonst (3 Stellen oder mehrere Punkte) = Tausenderpunkte.
 */
export function parseEuroToCents(input: string): number | null {
  let s = input.trim().replace(/[\s€]/g, "");
  if (s === "") return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma) {
    // Komma = Dezimaltrenner, etwaige Punkte = Tausender ("1.234,56", "1234,56").
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // Nur Punkt: als Dezimaltrenner werten, wenn genau EIN Punkt mit 1–2
    // Nachkommastellen ("12.50", "12.5"). Sonst NUR als Tausenderpunkte
    // akzeptieren, wenn das Muster sauber gruppiert ist ("1.234", "12.500",
    // "1.000.000"); fehlerhafte Eingaben ("1.2.3", "1.2345", "1.234.5",
    // "12.5000", "1.") werden abgewiesen statt still als falscher Betrag
    // interpretiert (früher: alle Punkte entfernen → "1.2.3" wurde 123,00 €).
    const parts = s.split(".");
    const isDecimal =
      parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2;
    if (isDecimal) {
      // s unverändert lassen — Punkt ist der Dezimaltrenner.
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, ""); // saubere Tausenderpunkte → entfernen
    } else {
      return null; // ungültiges Punkt-Muster
    }
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
