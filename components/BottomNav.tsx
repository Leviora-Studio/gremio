// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./Avatar";
import { logoutAction } from "@/lib/auth/actions";

/**
 * Mobile-App-Navigation (< md): feste untere Tab-Leiste statt der Desktop-
 * Linkleiste — gibt der App auf dem Handy ein natives Gefühl. Auf Desktop
 * komplett ausgeblendet (`md:hidden`); dort bleibt die Leiste in Nav.tsx.
 */

type Role = "admin" | "template_manager" | "user";

const TABS: {
  href: string;
  label: string;
  match: (p: string) => boolean;
  icon: React.ReactNode;
}[] = [
  {
    href: "/intern",
    label: "Start",
    match: (p) => p === "/intern",
    icon: (
      <Icon>
        <path d="M4 10.5 12 4l8 6.5M6 9.5V19a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1V9.5" />
      </Icon>
    ),
  },
  {
    href: "/intern/aufgaben",
    label: "Aufgaben",
    match: (p) => p.startsWith("/intern/aufgaben"),
    icon: (
      <Icon>
        <path d="M10 7h9M10 12h9M10 17h9M4 6.6l1.3 1.3 2.2-2.4M4 11.6l1.3 1.3 2.2-2.4M4 16.6l1.3 1.3 2.2-2.4" />
      </Icon>
    ),
  },
  {
    href: "/intern/boards",
    label: "Boards",
    match: (p) => p.startsWith("/intern/board") || p.startsWith("/intern/card"),
    icon: (
      <Icon>
        <rect x="3.5" y="4.5" width="5" height="15" rx="1.2" />
        <rect x="9.5" y="4.5" width="5" height="9" rx="1.2" />
        <rect x="15.5" y="4.5" width="5" height="15" rx="1.2" />
      </Icon>
    ),
  },
  {
    href: "/finanzen",
    label: "Finanzen",
    match: (p) => p.startsWith("/finanzen"),
    icon: (
      <Icon>
        <path d="M16.8 6.3a6.5 6.5 0 1 0 0 11.4M4.5 10.3h8M4.5 13.7h6.5" />
      </Icon>
    ),
  },
];

export function BottomNav({
  role,
  displayName,
  avatarSrc,
}: {
  role: Role;
  displayName: string;
  avatarSrc: string | null;
}) {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);

  // Bei offener Bildschirmtastatur die feste Leiste ausblenden — sonst schiebt
  // iOS sie über die Tastatur nach oben. Erkannt über die VisualViewport-Höhe
  // (die URL-Leiste < 150px löst nicht aus; in der Standalone-PWA gibt es sie
  // ohnehin nicht).
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboardOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Bei jedem Seitenwechsel das „Mehr"-Sheet schließen.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Escape schließt das Sheet.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const moreActive =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/vorlagen") ||
    pathname.startsWith("/intern/inventar") ||
    pathname.startsWith("/intern/konto");

  const moreLinks = [
    { href: "/intern/inventar", label: "Inventar" },
    ...(role === "admin" || role === "template_manager"
      ? [{ href: "/vorlagen", label: "Vorlagen" }]
      : []),
    ...(role === "admin" ? [{ href: "/admin", label: "Admin Panel" }] : []),
  ];

  return (
    <div className="md:hidden">
      {/* „Mehr"-Sheet */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setMoreOpen(false)}
          role="presentation"
        >
          <div className="absolute inset-0 bg-slate-900/20" />
          <div
            className="absolute inset-x-3 bottom-[calc(3.75rem_+_env(safe-area-inset-bottom))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Link
              href="/intern/konto"
              className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50"
            >
              <Avatar username={displayName} src={avatarSrc} size={36} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {displayName}
                </div>
                <div className="text-xs text-slate-500">Konto & Profil</div>
              </div>
            </Link>
            {moreLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="block px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {l.label}
              </Link>
            ))}
            <form action={logoutAction} className="border-t border-slate-100">
              <button
                type="submit"
                className="block w-full px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-slate-50"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab-Leiste — bei offener Tastatur ausgeblendet (s. keyboardOpen). */}
      <nav
        className={`fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] ${
          keyboardOpen ? "hidden" : ""
        }`}
      >
        <div className="flex">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium ${
                  active ? "text-brand-600" : "text-slate-500"
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-label="Mehr"
            aria-expanded={moreOpen}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium ${
              moreActive || moreOpen ? "text-brand-600" : "text-slate-500"
            }`}
          >
            <Icon>
              <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
              <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
            </Icon>
            <span>Mehr</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}
