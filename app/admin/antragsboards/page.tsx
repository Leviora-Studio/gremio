// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import {asc,eq} from "drizzle-orm";
import {requireAdmin} from "@/lib/auth";
import {db} from "@/lib/db";
import {boards,boardTemplates} from "@/lib/db/schema";
import {CreateApplicationBoardForm} from "@/components/admin/CreateApplicationBoardForm";
export default async function ApplicationBoardsPage(){
 await requireAdmin();
 const templates=await db.select({id:boardTemplates.id,name:boardTemplates.name}).from(boardTemplates).orderBy(asc(boardTemplates.name));
 const rows=await db.select().from(boards).where(eq(boards.isApplicationBoard,true)).orderBy(asc(boards.name));
 return <div className="space-y-6"><div><h2 className="text-xl font-semibold">Antragsboards</h2><p className="mt-1 text-sm text-slate-500">Nur Administrationskonten können Antragsboards erstellen. Freigaben, Spalten und Kartenfelder verwaltest du anschließend in den Boardeinstellungen.</p></div><CreateApplicationBoardForm templates={templates}/><section className="space-y-3"><h3 className="font-semibold">Vorhandene Antragsboards ({rows.length})</h3>{rows.map(board=><div key={board.id} className="card flex flex-wrap items-center justify-between gap-3 p-4"><Link className="font-medium text-brand-600" href={`/intern/board/${board.id}`}>{board.name}</Link><Link className="btn-secondary btn-sm" href={`/intern/board/${board.id}/einstellungen`}>Einstellungen</Link></div>)}</section></div>;
}
