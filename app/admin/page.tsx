// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  cards,
  boards,
  groups,
  locations,
  users,
} from "@/lib/db/schema";

async function tally(table: PgTable): Promise<number> {
  const [row] = await db.select({ c: count() }).from(table);
  return row?.c ?? 0;
}

export default async function AdminOverview() {
  const stats: { label: string; value: number; href?: string }[] = [
    { label: "Nutzer", value: await tally(users), href: "/admin/users" },
    { label: "Gruppen", value: await tally(groups), href: "/admin/groups" },
    { label: "Boards", value: await tally(boards), href: "/admin/boards" },
    { label: "Standorte", value: await tally(locations), href: "/admin/standorte" },
    { label: "Karten", value: await tally(cards) },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => {
        const inner = (
          <div className="card p-5">
            <div className="text-3xl font-bold">{s.value}</div>
            <div className="mt-1 text-sm text-slate-500">{s.label}</div>
          </div>
        );
        return s.href ? (
          <Link key={s.label} href={s.href} className="block hover:opacity-80">
            {inner}
          </Link>
        ) : (
          <div key={s.label}>{inner}</div>
        );
      })}
    </div>
  );
}
