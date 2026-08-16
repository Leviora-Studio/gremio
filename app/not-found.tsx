// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-5xl font-bold text-slate-300">404</h1>
      <p className="text-slate-600">Diese Seite wurde nicht gefunden.</p>
      <Link href="/" className="btn-primary">
        Zur Startseite
      </Link>
    </main>
  );
}
