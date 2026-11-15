// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { formatDateTime } from "@/lib/dates";
import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, groups, cashbookAccess, cashbookActivity, boards } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard } from "@/lib/authz";
import { cashbookWriters, requireCashbook } from "@/lib/cashbook/access";
import { getAccessibleFinanceBoards, getFinanceBoardById } from "@/lib/finance";
import { formatBookingNumber } from "@/lib/cashbook/booking-number";
import { CashbookArchiveSettings } from "@/components/cashbook/CashbookArchiveSettings";
import { cashbookArchiveSettings } from "@/lib/cashbook/archive";
import { CashbookSettings } from "@/components/cashbook/CashbookSettings";
import { cashbookTemplateFieldsAction } from "@/app/intern/kassenbuch/actions";
export default async function Settings({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const user = await requireUser(); const { book } = await requireCashbook(user, Number((await params).id), "manage"); const archiveSettings=book.ownerId===user.id?await cashbookArchiveSettings(user,book.id):null; const financeSources = (await getAccessibleFinanceBoards(user)).map(board=>({id:board.id,name:board.name})); if(book.financeBoardId&&!financeSources.some(board=>board.id===book.financeBoardId)){const current=await getFinanceBoardById(book.financeBoardId);if(current)financeSources.push({id:current.id,name:current.name});} const allGroups = await db.select().from(groups).where(activeRows.groups); const people = (await db.select().from(users).where(eq(users.isActive, true))).map(u => ({ id: u.id, name: u.name || u.username })); const history = await db.select({ event: cashbookActivity, name: users.name, username: users.username }).from(cashbookActivity).innerJoin(users, eq(users.id, cashbookActivity.userId)).where(trashAnd(activeRows.cashbookActivity, and(eq(cashbookActivity.cashbookId, book.id), isNull(cashbookActivity.entryId)))).orderBy(desc(cashbookActivity.createdAt)); const sourceBoards = []; for (const board of await db.select().from(boards).where(trashAnd(activeRows.boards, eq(boards.isApplicationBoard, true))))
    if (await canAccessBoard(user, board))
        sourceBoards.push({ id: board.id, name: board.name }); return <div className="mx-auto max-w-6xl space-y-6"><Link className="text-brand-700" href={`/intern/kassenbuch/${book.id}`}>← {book.name}</Link><h1 className="text-2xl font-bold">Kassenbuch-Einstellungen</h1><CashbookSettings financeBoards={financeSources} financeBoardId={book.financeBoardId} key={book.revision} id={book.id} revision={book.revision} initial={book.config} nextNumber={book.nextNumber} nextBookingNumber={book.nextBookingNumber} people={people} writers={(await cashbookWriters(book)).map(u => ({ id: u.id, name: u.name || u.username }))} groups={allGroups.map(g => ({ id: g.id, name: g.name }))} grants={await db.select().from(cashbookAccess).where(trashAnd(activeRows.cashbookAccess, eq(cashbookAccess.cashbookId, book.id)))} boards={sourceBoards} fields={await cashbookTemplateFieldsAction(book.id)}/>{archiveSettings&&<CashbookArchiveSettings key={archiveSettings.revision} bookId={book.id} initial={archiveSettings} bookingExample={formatBookingNumber(book.config.bookingNumbering,book.nextBookingNumber)}/>}<section className="card space-y-3 p-5"><h2 className="font-semibold">Verlauf der Einstellungen und Freigaben</h2>{history.map(({ event, name, username }) => <div key={event.id} className="border-b border-slate-100 py-3 text-sm"><p className="font-medium">{event.type === "created" ? "Kassenbuch angelegt" : event.type === "sharing" ? "Freigabe geändert" : event.type === "archive_settings" ? "Nextcloud-Archiv-Einstellungen geändert" : "Einstellungen geändert"} · {name || username}</p><p className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</p>{event.type === "sharing" && <p>{event.detail.kind === "group" ? "Gruppe" : "Person"}: {(event.detail.kind === "group" ? allGroups : people).find(u => u.id === event.detail.subjectId)?.name ?? String(event.detail.subjectId)} · {event.detail.after === "write" ? "Schreibend" : event.detail.after === "read" ? "Lesend" : "Freigabe entfernt"}</p>}</div>)}</section></div>; }
