// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import {subscribeAppChanges} from "@/lib/app-realtime";
import {
  subscribeCardChanges,
  subscribeInventoryChanges,
  type CardChange,
  type InventoryChange,
} from "@/lib/realtime";

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
function changeSSE<T>(
  signal: AbortSignal,
  subscribe: (cb: (c: T) => void) => () => void,
  match: (c: T) => boolean,
  authorize?: () => Promise<boolean>,
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
      const checkedSend = async (value: string) => {
        try {
          if (authorize && !await authorize()) { close(); return; }
          send(value);
        } catch { close(); }
      };
      unsub = subscribe((c) => {
        if (match(c)) void checkedSend("data: change\n\n");
      });
      heartbeat = setInterval(() => void checkedSend(": ping\n\n"), 25000);
      signal.addEventListener("abort", close, {once:true});
      if(signal.aborted)close();
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

/** SSE der Karten-Änderungen, gefiltert über `match` (Board-ID / Token). */
export function cardChangeSSE(
  signal: AbortSignal,
  match: (c: CardChange) => boolean,
  authorize?: () => Promise<boolean>,
): Response {
  return changeSSE(signal, subscribeCardChanges, match, authorize);
}

/** SSE der Inventar-Änderungen, gefiltert über `match` (Board-ID / Token). */
export function inventoryChangeSSE(
  signal: AbortSignal,
  match: (c: InventoryChange) => boolean,
  authorize?: () => Promise<boolean>,
): Response {
  return changeSSE(signal, subscribeInventoryChanges, match, authorize);
}

/** Authenticated application-wide invalidation; never contains record data. */
export function appChangeSSE(signal:AbortSignal,authorize:()=>Promise<boolean>):Response{return changeSSE(signal,cb=>subscribeAppChanges(()=>cb(undefined)),()=>true,authorize);}
