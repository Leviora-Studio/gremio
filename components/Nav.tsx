// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import type { User } from "@/lib/db/schema";
import { logoutAction } from "@/lib/auth/actions";
import { Avatar } from "./Avatar";

export function Nav({ user }: { user: User }) {
  // Anzeigename aus dem SSO (konstant), Fallback auf Benutzername.
  const displayName = user.name?.trim() || user.username;
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
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
  );
}

function avatarUrl(user: User): string | null {
  return user.avatarPath ? `/api/avatar/${user.id}` : null;
}
