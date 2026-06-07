// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import Link from "next/link";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">Etwas ist schiefgelaufen</h1>
      <p className="text-slate-600">
        Bitte versuche es erneut. Falls das Problem bestehen bleibt, wende dich
        an einen Administrator.
      </p>
      <div className="flex gap-2">
        <button onClick={reset} className="btn-primary">
          Erneut versuchen
        </button>
        <Link href="/intern" className="btn-secondary">
          Zur Startseite
        </Link>
      </div>
    </main>
  );
}
