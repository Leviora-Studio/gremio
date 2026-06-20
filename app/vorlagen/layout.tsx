// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { requireTemplateManager } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { VorlagenTabs } from "@/components/VorlagenTabs";

export const metadata = { title: "Vorlagen — Gremio" };

export default async function VorlagenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireTemplateManager();
  return (
    <div className="min-h-screen">
      <Nav user={user} />
      <div className="mx-auto w-full px-4 pb-24 pt-6 sm:px-6 lg:px-8 md:pb-6">
        <h1 className="mb-1 text-2xl font-bold">Vorlagen</h1>
        <p className="mb-4 text-sm text-slate-500">
          Board- und Finanz-Templates verwalten.
        </p>
        <VorlagenTabs />
        {children}
      </div>
    </div>
  );
}
