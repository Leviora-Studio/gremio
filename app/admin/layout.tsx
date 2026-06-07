// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { requireAdmin } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { AdminTabs } from "@/components/AdminTabs";

export const metadata = { title: "Admin Panel — Gremio" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  return (
    <div className="min-h-screen">
      <Nav user={user} />
      <div className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="mb-4 text-2xl font-bold">Admin Panel</h1>
        <AdminTabs />
        {children}
      </div>
    </div>
  );
}
