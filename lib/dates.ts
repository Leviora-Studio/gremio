// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

// Zentrale Datums-/Zeit-Formatierung. Timestamps liegen in der DB als UTC
// (timestamptz); angezeigt wird immer in deutscher Schreibweise und der
// Zeitzone Europe/Berlin — unabhängig von der Server-Zeitzone des Containers.
const TIME_ZONE = "Europe/Berlin";

/** Heutiges Datum als "YYYY-MM-DD" in Europe/Berlin (nicht UTC). */
export function todayInBerlin(): string {
  // en-CA formatiert als YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
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
