// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

/**
 * Erkennung von PostgreSQL-Fehlercodes.
 *
 * Drizzle verpackt den `pg`-Fehler je nach Aufrufweg unterschiedlich tief,
 * deshalb wird sowohl direkt als auch in `cause` nachgesehen — dieselbe Logik
 * wie in `isTokenConflict` (lib/token.ts), nur allgemein.
 */
function pgError(e: unknown): { code?: string; constraint?: string } {
  const err = e as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  return {
    code: err.code ?? err.cause?.code,
    constraint: err.constraint ?? err.cause?.constraint,
  };
}

/**
 * Verletzung eines UNIQUE-Constraints (SQLSTATE 23505).
 *
 * Wird gebraucht, wo vorher „erst prüfen, dann schreiben" stand: Zwischen
 * Prüfung und Schreibzugriff kann ein zweiter Vorgang denselben Wert anlegen.
 * Die Datenbank ist die einzige Instanz, die das zuverlässig entscheidet — die
 * Prüfung davor bleibt trotzdem sinnvoll, weil sie im Normalfall die
 * verständlichere Meldung liefert.
 *
 * `constraintHint` grenzt auf einen bestimmten Constraint ein (Teilstring),
 * damit nicht jede beliebige Eindeutigkeitsverletzung als „Name vergeben"
 * gedeutet wird.
 */
export function isUniqueViolation(e: unknown, constraintHint?: string): boolean {
  const { code, constraint } = pgError(e);
  if (code !== "23505") return false;
  if (!constraintHint) return true;
  return (constraint ?? "").includes(constraintHint);
}
