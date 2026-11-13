// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { accessibleCashbooks } from "@/lib/cashbook/access";
import { CreateCashbookForm } from "@/components/cashbook/CreateCashbookForm";
export default async function CashbookIndex() { const user = await requireUser(); const books = await accessibleCashbooks(user); return <div className="mx-auto max-w-6xl space-y-6"><h1 className="text-2xl font-bold">Kassenbuch</h1><div className="grid gap-4 sm:grid-cols-2">{books.map(book => <Link href={`/intern/kassenbuch/${book.id}`} key={book.id} className="card space-y-2 p-5 hover:border-brand-400"><h2 className="font-semibold">{book.name}</h2><p className="text-sm text-slate-500">{book.permission === "office" ? "Büroablauf" : book.permission === "read" ? "Lesender Zugriff" : "Schreibender Zugriff"}</p></Link>)}</div>{!books.length && <p className="text-slate-500">Dir ist noch kein Kassenbuch freigegeben.</p>}{user.role === "admin" && <CreateCashbookForm />}</div>; }
