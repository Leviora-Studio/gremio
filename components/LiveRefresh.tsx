// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

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
    // Mehrere Events (z. B. Neusortierung vieler Karten) zu einem Refresh
    // zusammenfassen.
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };

    const es = new EventSource(src);
    es.onmessage = refresh;

    // Bei jeder (Wieder-)Verbindung nachziehen: EventSource verbindet nach
    // Abbrüchen selbst neu, aber der Server sendet dabei kein „change" — ohne
    // dies blieben Änderungen, die WÄHREND des Abbruchs passierten (Netzwechsel,
    // Hintergrund, Deploy, Proxy-Timeout), bis zur nächsten Änderung unsichtbar.
    // Der allererste Connect ist nicht nötig (SSR ist bereits aktuell).
    let firstOpen = true;
    es.onopen = () => {
      if (firstOpen) {
        firstOpen = false;
        return;
      }
      refresh();
    };

    // App/Tab kommt zurück in den Vordergrund (iOS suspendiert Hintergrund-Tabs
    // inkl. SSE, ohne dass zwingend ein reconnect/onopen feuert) → Stand holen.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      es.close();
    };
  }, [src, router]);

  return null;
}
