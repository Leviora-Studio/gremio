// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import type { User } from "@/lib/db/schema";
import { logoutAction } from "@/lib/auth/actions";
import { Avatar } from "./Avatar";
import { BottomNav } from "./BottomNav";

export function Nav({ user }: { user: User }) {
  // Anzeigename aus dem SSO (konstant), Fallback auf Benutzername.
  const displayName = user.name?.trim() || user.username;
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white md:static">
        {/* Mobil (< md): kompakte App-Kopfleiste (Logo + Konto). Die eigentliche
            Navigation läuft über die untere Tab-Leiste (BottomNav). */}
        <div className="flex h-14 items-center justify-between px-4 md:hidden">
          <Link
            href="/intern"
            className="flex items-center gap-2 text-lg font-bold text-slate-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Gremio Logo" className="h-7 w-auto" />
            <span>Gremio</span>
          </Link>
          <Link href="/intern/konto" aria-label="Konto">
            <Avatar username={displayName} src={avatarUrl(user)} size={32} />
          </Link>
        </div>

        {/* Desktop (md+): volle Leiste, unverändert. */}
        <div className="mx-auto hidden w-full items-center justify-between px-4 py-3 sm:px-6 lg:px-8 md:flex">
          <Link
            href="/intern"
            className="flex items-center gap-2 text-lg font-bold text-slate-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Gremio Logo" className="h-7 w-auto" />
            <span>Gremio</span>
          </Link>

          <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/intern"
            className="font-medium text-slate-600 hover:text-brand-600"
          >
            Startseite
          </Link>
          <Link
            href="/intern/aufgaben"
            className="font-medium text-slate-600 hover:text-brand-600"
          >
            Aufgaben
          </Link>
          <Link
            href="/intern/boards"
            className="font-medium text-slate-600 hover:text-brand-600"
          >
            Boards
          </Link>
          <Link
            href="/finanzen"
            className="font-medium text-slate-600 hover:text-brand-600"
          >
            Finanzen
          </Link>
          {(user.role === "admin" || user.role === "template_manager") && (
            <Link
              href="/vorlagen"
              className="font-medium text-slate-600 hover:text-brand-600"
            >
              Vorlagen
            </Link>
          )}
          {user.role === "admin" && (
            <Link
              href="/admin"
              className="font-medium text-slate-600 hover:text-brand-600"
            >
              Admin Panel
            </Link>
          )}
          <Link
            href="/intern/konto"
            className="flex items-center gap-2 font-medium text-slate-600 hover:text-brand-600"
          >
            <Avatar username={displayName} src={avatarUrl(user)} size={28} />
            <span className="hidden sm:inline">{displayName}</span>
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="btn-secondary px-3 py-1.5">
              Logout
            </button>
          </form>
          </nav>
        </div>
      </header>

      {/* Mobil (< md): untere Tab-Leiste im App-Stil. */}
      <BottomNav
        role={user.role}
        displayName={displayName}
        avatarSrc={avatarUrl(user)}
      />
    </>
  );
}

function avatarUrl(user: User): string | null {
  return user.avatarPath ? `/api/avatar/${user.id}` : null;
}
