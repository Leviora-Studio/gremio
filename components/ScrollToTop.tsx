// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect } from "react";

/**
 * Springt beim Betreten der Seite an den Seitenanfang. Nötig, weil nach dem
 * Absenden des Antragsformulars per Server-Action-`redirect()` clientseitig
 * navigiert wird und die Scroll-Position des (langen) Formulars sonst erhalten
 * bleibt — der Antragsteller landet dann mitten auf der Statusseite und sieht
 * den Hinweis zum Status-Link nicht.
 *
 * Läuft nur beim Mounten: `router.refresh()` (LiveRefresh) rendert die Seite
 * neu, ohne neu zu mounten, scrollt also nicht ungefragt weg.
 */
export function ScrollToTop() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return null;
}
