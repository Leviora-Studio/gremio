// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Hält die aktuelle Seite live: öffnet einen SSE-Stream und ruft bei jeder
 * gemeldeten Änderung ein (debounced) router.refresh() auf. Dadurch aktualisiert
 * sich die Server-Komponente ohne manuelles Neuladen — für Board und
 * öffentliche Statusseite gleichermaßen. Rendert nichts.
 */
export function LiveRefresh({ src }: { src: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const es = new EventSource(src);
    es.onmessage = () => {
      // Mehrere Events (z. B. Neusortierung vieler Karten) zu einem Refresh
      // zusammenfassen.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };
    // EventSource verbindet bei Verbindungsabbrüchen selbst neu (retry).
    return () => {
      if (timer.current) clearTimeout(timer.current);
      es.close();
    };
  }, [src, router]);

  return null;
}
