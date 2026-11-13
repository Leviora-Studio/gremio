// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { accessibleCashbooks } from "@/lib/cashbook/access";
import { CreateCashbookForm } from "@/components/cashbook/CreateCashbookForm";

export default async function AdminCashbooksPage() {
  const user = await requireAdmin();
  const books = await accessibleCashbooks(user);

  return (
    <div className="max-w-6xl space-y-6">
      <h2 className="text-lg font-semibold">Kassenbücher</h2>
      {books.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {books.map(book => (
            <Link key={book.id} href={`/intern/kassenbuch/${book.id}`} className="card block p-5 font-semibold hover:border-brand-400">
              {book.name}
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Dir ist noch kein Kassenbuch freigegeben.</p>
      )}
      <CreateCashbookForm />
    </div>
  );
}
