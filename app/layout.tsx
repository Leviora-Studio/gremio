// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gremio",
  description: "Anträge in Gremien einreichen und verwalten",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
