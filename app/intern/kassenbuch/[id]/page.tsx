// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { cashbookEntries } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { requireCashbook } from "@/lib/cashbook/access";
import { DraftsButton } from "@/components/cashbook/DraftsButton";
import { LedgerTable } from "@/components/cashbook/LedgerTable";
import { hasOpenCashbookFlag } from "@/lib/cashbook-types";
import { formatCents } from "@/lib/money";
export default async function CashbookPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const user = await requireUser(); let access; try {
    access = await requireCashbook(user, Number((await params).id));
}
catch {
    return <p className="card p-5">Sie haben nicht die nötigen Rechte für dieses Kassenbuch.</p>;
} const { book, permission } = access; const entries = await db.select().from(cashbookEntries).where(eq(cashbookEntries.cashbookId, book.id)).orderBy(desc(cashbookEntries.createdAt)); const posted = entries.filter(e => e.state === "posted"); const officePosted = posted.filter(e => e.correctsId == null); const office = permission === "office"; const queues = office ? [{ title: "Noch zu erledigende Anweisungen", rows: officePosted.filter(e => !e.officeDone) }, { title: "Erledigte Anweisungen", rows: officePosted.filter(e => e.officeDone) }] : [{ title: "Zur Unterschrift vorgelegt", rows: entries.filter(e => e.state === "submitted" && e.secondSignerId !== user.id) }, { title: "Zur Unterschrift vorliegend", rows: entries.filter(e => e.state === "submitted" && e.secondSignerId === user.id) }, { title: "Anweisung erteilt", rows: officePosted.filter(e => !e.officeDone) }]; return <div className="mx-auto max-w-[100rem] space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><h1 className="text-2xl font-bold">{book.name}</h1><div className="flex flex-wrap gap-3">{["write", "manage"].includes(permission) && <Link href={`/intern/kassenbuch/${book.id}/neu`} className="btn-primary">Buchung anlegen</Link>}{!office && <DraftsButton drafts={entries.filter(e => e.state === "draft").map(e => ({ id:e.id, number:e.data.number, amount:e.data.amount, budgetTitle:e.data.budgetTitle }))}/>}{(permission === "manage" || user.role === "admin") && <Link href={`/intern/kassenbuch/${book.id}/einstellungen`} className="btn-secondary">Einstellungen</Link>}</div></div><div className="grid gap-4 lg:grid-cols-3">{queues.map(queue => <details key={queue.title} className={`card min-w-0 p-4 ${queue.rows.some(hasOpenCashbookFlag) ? "border-red-400 bg-red-50/40" : queue.rows.length ? "border-brand-300 bg-brand-50/30" : ""}`}><summary className="cursor-pointer font-semibold">{queue.title} <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-sm">{queue.rows.length}</span>{queue.rows.some(hasOpenCashbookFlag) && <span className="mt-2 block text-sm font-semibold text-red-800">Rücksprache erforderlich: {queue.rows.filter(hasOpenCashbookFlag).length}</span>}</summary><div className="mt-3 space-y-2">{queue.rows.map(e => <Link className={`block rounded-lg border p-3 text-sm ${hasOpenCashbookFlag(e) ? "border-red-500 bg-red-50 text-red-900 hover:border-red-700" : "border-slate-200 bg-white hover:border-brand-400"}`} key={e.id} href={`/intern/kassenbuch/vorgang/${e.id}`}><strong>{e.bookingNumber ? `${e.bookingNumber} · ` : ""}{e.data.number}</strong>{hasOpenCashbookFlag(e) && <span className="mt-1 block font-semibold">Als falsch markiert – Rücksprache erforderlich</span>}<span className="block">{formatCents(e.data.amount)} · HT {e.data.budgetTitle}</span>{e.correctsId && <span className="text-amber-700">Korrekturbuchung zu #{e.correctsId}</span>}</Link>)}</div></details>)}</div>{!office && <LedgerTable bookId={book.id} userId={user.id} rows={posted.map(e => ({ id: e.id, flaggedAt:e.flaggedAt?.toISOString() ?? null, flagResolvedAt:e.flagResolvedAt?.toISOString() ?? null, bookingNumber:e.bookingNumber, data: e.data, authorizedAt: e.authorizedAt?.toISOString() ?? null, bookingDate: e.bookingDate, correctsId: e.correctsId }))}/>}</div>; }
