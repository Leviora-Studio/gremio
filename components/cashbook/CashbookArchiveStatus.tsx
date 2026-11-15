// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cashbookArchive,cashbookArchiveJobs } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/dates";
/** Render only after the parent page has required access to this posted entry. */
export async function CashbookArchiveStatus({entryId}:{entryId:number}) {
 const [row]=await db.select({archivedAt:cashbookArchiveJobs.archivedAt,path:cashbookArchiveJobs.archivePath,error:cashbookArchiveJobs.lastError,enabled:cashbookArchive.enabled})
  .from(cashbookArchiveJobs).leftJoin(cashbookArchive,eq(cashbookArchive.cashbookId,cashbookArchiveJobs.cashbookId)).where(eq(cashbookArchiveJobs.entryId,entryId));
 if(!row)return null;
 return <section className="card space-y-2 p-5"><h2 className="font-semibold">Nextcloud-Archivierung</h2>{row.archivedAt?<><p className="text-sm text-green-800">Alle Dateien archiviert am {formatDateTime(row.archivedAt)}.</p><p className="break-words text-sm text-slate-600">Archivordner: {row.path}</p></>:<><p className="text-sm text-slate-600">{!row.enabled?"Archivierung pausiert. Der Auftrag bleibt gespeichert.":row.error?"Archivierung noch nicht abgeschlossen. Der Auftrag wird automatisch erneut versucht.":"Archivierung vorgemerkt. Die Dateien werden automatisch übertragen."}</p>{row.error&&<p role="alert" className="text-sm text-amber-800">{row.error}</p>}</>}</section>;
}
