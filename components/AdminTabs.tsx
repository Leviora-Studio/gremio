// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const tabs = [
  { href: "/admin", label: "Übersicht", exact: true },
  { href: "/admin/users", label: "Nutzer" },
  { href: "/admin/groups", label: "Gruppen" },
  { href: "/admin/boards", label: "Boards" },
  { href: "/admin/finanzboards", label: "Finanzboards" },
  { href: "/admin/standorte", label: "Standorte" },
  { href: "/admin/umfragen", label: "Umfragen" },
  { href: "/admin/inventar", label: "Inventar" },
  { href: "/admin/formular", label: "Antragsformular" },
  { href: "/admin/priorities", label: "Priorität" },
  { href: "/admin/accounts", label: "Konten" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={clsx(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              active
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
