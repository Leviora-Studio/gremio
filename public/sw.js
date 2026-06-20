// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
//
// Bewusst minimaler, sicherer Service Worker für eine server-zentrierte App:
// - Es werden NUR unveränderliche, content-gehashte Assets gecacht
//   (/_next/static, /icons) → kein Risiko veralteter dynamischer Inhalte.
// - Navigationen (HTML) laufen network-first; offline → statische Fallbackseite.
// - POST/Server-Actions/API werden nie gecacht.
// Cache-Version bei SW-Änderungen erhöhen, um alte Caches zu verwerfen.
const CACHE = "gremio-shell-v1";
const PRECACHE = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POST/Server-Actions nie anfassen

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // nur eigene Origin

  // Unveränderliche Assets: cache-first (Dateinamen sind content-gehasht).
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Navigationen: network-first, offline → Fallbackseite. NICHT cachen
  // (dynamische, auth-abhängige Inhalte).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
    return;
  }

  // Alles Übrige (API, SSE-Streams, …): network-only.
});
