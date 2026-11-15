// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { db } from "@/lib/db";
import { cashbooks } from "@/lib/db/schema";
import { activeRows } from "@/lib/trash-visibility";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { trashCashbookAction } from "@/app/intern/kassenbuch/actions";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { accessibleCashbooks } from "@/lib/cashbook/access";
import { CreateCashbookForm } from "@/components/cashbook/CreateCashbookForm";

export default async function AdminCashbooksPage() {
  const user = await requireAdmin();
  const readable = await accessibleCashbooks(user);
  const books = await db.select().from(cashbooks).where(activeRows.cashbooks).orderBy(cashbooks.name);

  return (
    <div className="max-w-6xl space-y-6">
      <h2 className="text-lg font-semibold">Kassenbücher</h2>
      {books.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {books.map(book => (
            <section key={book.id} className="card space-y-4 p-5">{readable.some(row=>row.id===book.id)?<Link href={`/intern/kassenbuch/${book.id}`} className="font-semibold text-brand-700">{book.name}</Link>:<h3 className="font-semibold">{book.name}</h3>}<DeleteConfirm confirmName={book.name} action={trashCashbookAction.bind(null,book.id)} compact buttonLabel="Löschen" title="Kassenbuch in den Papierkorb verschieben"/></section>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Dir ist noch kein Kassenbuch freigegeben.</p>
      )}
      <CreateCashbookForm />
    </div>
  );
}
