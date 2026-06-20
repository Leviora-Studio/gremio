// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import type { MetadataRoute } from "next";

// Web-App-Manifest → /manifest.webmanifest. Next verlinkt es automatisch im
// <head>. Macht Gremio auf Android UND Desktop (Chrome/Edge) installierbar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gremio — Anträge verwalten",
    short_name: "Gremio",
    description:
      "Anträge in Gremien verwalten — Kanban-Boards, Finanzübersichten und Archiv.",
    // Installierte App startet im internen Bereich; `scope: "/"` hält die ganze
    // App (inkl. Login-Redirect) im App-Fenster.
    start_url: "/intern",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    lang: "de",
    dir: "ltr",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
