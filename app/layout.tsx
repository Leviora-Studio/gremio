// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "Gremio",
  description: "Anträge in Gremien einreichen und verwalten",
  applicationName: "Gremio",
  // Standalone-Verhalten auf iOS (Android nutzt das Web-App-Manifest).
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Gremio" },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
