// SPDX-License-Identifier: AGPL-3.0-only
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

/**
 * Verletzung eines FOREIGN-KEY-Constraints (SQLSTATE 23503) — z. B. Spalte/Board
 * löschen, während ein Standort oder Feedback-Bereich darauf routet
 * (`ON DELETE RESTRICT`), oder ein Routing-Ziel setzen, das gerade gelöscht
 * wurde. WICHTIG: immer über diese Funktion prüfen, nie direkt `err.code`
 * lesen — Drizzle verpackt den pg-Fehler in `DrizzleQueryError` und hängt ihn
 * nur an `cause`; ein direkter `code`-Vergleich ist toter Code.
 */
export function isForeignKeyViolation(e: unknown): boolean {
  return pgError(e).code === "23503";
}

/**
 * Param-freie Fassung eines Datenbankfehlers zum Weiterwerfen/Loggen.
 *
 * `DrizzleQueryError.message` enthält ab der zweiten Zeile die
 * Query-PARAMETER (`params: …`) — bei Token-Abfragen also den geheimen
 * Status-Token, der so in Server-Logs landen würde (Next loggt unbehandelte
 * Fehler samt Message). Der SQLSTATE bleibt fürs Debugging erhalten, `cause`
 * bewusst nicht (dessen Message/Detail kann ebenfalls Werte enthalten).
 */
export function dbErrorWithoutParams(e: unknown, context: string): Error {
  const { code } = pgError(e);
  return new Error(
    `${context}: Datenbankfehler${code ? ` (SQLSTATE ${code})` : ""}`,
  );
}
