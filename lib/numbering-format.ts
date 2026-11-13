// SPDX-License-Identifier: AGPL-3.0-only
export type NumberingConfig = {
    prefix: string;
    year: string;
    code: string;
    separator: string;
    padding: number;
};
/**
 * Setzt die Antragsnummer zusammen: Präfix+Zahl werden zusammengeklebt,
 * danach Jahr und Kürzel als weitere Blöcke. Nur nicht-leere Blöcke werden
 * mit dem Trennzeichen verbunden (keine doppelten/überflüssigen Trenner).
 */
export function buildCardNumber(cfg: NumberingConfig, counter: number): string {
    const num = cfg.padding > 0 ? String(counter).padStart(cfg.padding, "0") : String(counter);
    const head = `${cfg.prefix}${num}`;
    const parts = [head, cfg.year, cfg.code].filter((p) => p !== "");
    return parts.join(cfg.separator);
}
