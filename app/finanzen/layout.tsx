// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const metadata = { title: "Finanzen — Gremio" };

export default async function FinanzenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <Nav user={user} />
      <main className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
