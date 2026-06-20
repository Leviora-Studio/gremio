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
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // Im Dev keinen SW registrieren — UND einen evtl. von einem früheren
      // Prod-Build auf demselben Origin (z. B. localhost) hinterlassenen SW
      // aktiv abmelden, sonst stört er HMR durch gecachte Assets.
      navigator.serviceWorker
        .getRegistrations()
        .then((rs) => rs.forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Registrierung fehlgeschlagen — App funktioniert trotzdem (nur ohne PWA-Cache). */
    });
  }, []);
  return null;
}
