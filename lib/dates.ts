// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

// Zentrale Datums-/Zeit-Formatierung. Timestamps liegen in der DB als UTC
// (timestamptz); angezeigt wird immer in deutscher Schreibweise und der
// Zeitzone Europe/Berlin — unabhängig von der Server-Zeitzone des Containers.
const TIME_ZONE = "Europe/Berlin";

/** Heutiges Datum als "YYYY-MM-DD" in Europe/Berlin (nicht UTC). */
export function todayInBerlin(): string {
  // en-CA formatiert als YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

/**
 * Jahr-Monat als "YYYY-MM" in Europe/Berlin (nicht UTC). Für Monats-Buckets,
 * damit die Zuordnung an Monatsgrenzen unabhängig von der Server-Zeitzone ist.
 */
export function berlinYearMonth(d: Date | string | number = new Date()): string {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: TIME_ZONE }).slice(0, 7);
}

export function formatDateTime(
  d: Date | string | number,
  dateStyle: "full" | "long" | "medium" | "short" = "long",
): string {
  return new Date(d).toLocaleString("de-DE", {
    dateStyle,
    timeStyle: "short",
    timeZone: TIME_ZONE,
  });
}
