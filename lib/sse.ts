// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { subscribeCardChanges, type CardChange } from "@/lib/realtime";

// Globale Obergrenze gleichzeitiger SSE-Streams je App-Instanz — Backstop,
// damit ein einzelner Client nicht beliebig viele Dauerverbindungen
// (je Heartbeat-Interval + Listener) offenhalten und Ressourcen erschöpfen kann.
const MAX_SSE_CONNECTIONS = 500;
let active = 0;

/**
 * Baut eine Server-Sent-Events-Response, die bei jeder passenden Karten-
 * Änderung ein `data: change` sendet. `match` filtert die Notifications
 * (z. B. auf eine Board-ID oder ein Token). Heartbeats halten die Verbindung
 * durch Proxies offen; `X-Accel-Buffering: no` deaktiviert nginx-Pufferung.
 */
export function cardChangeSSE(
  signal: AbortSignal,
  match: (c: CardChange) => boolean,
): Response {
  if (active >= MAX_SSE_CONNECTIONS) {
    return new Response("Zu viele gleichzeitige Live-Verbindungen.", {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }
  active++;

  const encoder = new TextEncoder();
  let released = false;
  let unsub: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  // Genau einmal aufräumen (Counter, Heartbeat, Subscription).
  const release = () => {
    if (released) return;
    released = true;
    active--;
    if (heartbeat) clearInterval(heartbeat);
    unsub();
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        if (released) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          release();
        }
      };
      const close = () => {
        release();
        try {
          controller.close();
        } catch {
          /* bereits geschlossen */
        }
      };

      send("retry: 5000\n\n");
      send(": connected\n\n");
      unsub = subscribeCardChanges((c) => {
        if (match(c)) send("data: change\n\n");
      });
      heartbeat = setInterval(() => send(": ping\n\n"), 25000);
      signal.addEventListener("abort", close);
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
