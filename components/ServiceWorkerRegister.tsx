// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect } from "react";

/**
 * Registriert den Service Worker — NUR in Produktion. Im Dev würde ein SW das
 * HMR und das Caching der Dev-Assets stören, daher dort bewusst aus.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Registrierung fehlgeschlagen — App funktioniert trotzdem (nur ohne PWA-Cache). */
    });
  }, []);
  return null;
}
