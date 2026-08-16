// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

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
      <main className="mx-auto w-full px-4 pb-24 pt-6 sm:px-6 lg:px-8 md:pb-6">
        {children}
      </main>
    </div>
  );
}
