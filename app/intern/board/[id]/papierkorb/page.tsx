// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { requireBoardAccess, canEditBoard } from "@/lib/authz";
import { boardCardTrash } from "@/lib/card-trash";
import { boardAttachmentTrash } from "@/lib/attachment-trash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { FilterableList } from "@/components/FilterableList";
import { formatDateTime } from "@/lib/dates";
import { restoreCardAction,purgeCardAction,restoreFileAction, purgeFileAction } from "./actions";
export default async function BoardTrashPage({ params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  const { user, board } = await requireBoardAccess(boardId);
  const writable = await canEditBoard(user, board);
  const rows = await boardAttachmentTrash(user, boardId);
  const cardRows=await boardCardTrash(user,boardId);
  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="space-y-2"><Link className="text-sm text-brand-600" href={`/intern/board/${boardId}`}>← {board.name}</Link>
      <h1 className="text-2xl font-bold">Papierkorb <span className="text-slate-500">({rows.length+cardRows.length})</span></h1>
      <p className="text-sm leading-relaxed text-slate-600">Gelöschte Karten mit ihren Inhalten und Anhängen sowie gelöschte und ersetzte Dateien bleiben 30 Tage erhalten. Karten erscheinen nach der Wiederherstellung wieder im Board; Dateien landen wieder an ihrer ursprünglichen Karte. Abgelaufene Einträge werden täglich ab 03:00 Uhr automatisch endgültig gelöscht.</p>
      {!writable && <p className="text-sm text-slate-600">Du hast Leserechte. Zum Wiederherstellen oder endgültigen Löschen ist Schreibzugriff erforderlich.</p>}
    </div>
    <h2 className="text-lg font-semibold">Gelöschte Karten ({cardRows.length})</h2>
    <FilterableList placeholder="Karte suchen …" emptyText="Keine gelöschten Karten." items={cardRows.map(row=>({key:row.id,search:`${row.title} ${row.number??""}`,element:<section className="card space-y-4 p-5"><h3 className="break-words font-semibold">{row.number?`${row.number} · `:""}{row.title||"Unbenannte Karte"}</h3><dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">Gelöscht von</dt><dd>{row.deletedBy}</dd></div><div><dt className="text-slate-500">Im Papierkorb seit</dt><dd>{formatDateTime(row.deletedAt)}</dd></div><div><dt className="text-slate-500">Wiederherstellbar bis</dt><dd>{formatDateTime(row.expiresAt)}</dd></div></dl>{row.lastError&&<p role="alert" className="text-sm text-amber-800">{row.lastError}</p>}{row.state==="purging"?<p className="text-sm text-slate-600">Die Karte ist endgültig gelöscht. Ausstehende Dateien werden noch bereinigt.</p>:row.expiresAt<=new Date()?<p className="text-sm text-slate-600">Die Aufbewahrungsfrist ist abgelaufen.</p>:null}{writable&&<div className="flex flex-wrap gap-3">{row.restorable&&<ConfirmButton action={restoreCardAction.bind(null,boardId,row.id)} label="Wiederherstellen" className="btn-secondary" title="Karte wiederherstellen" message="Die Karte wird mit ihren ursprünglichen Inhalten und Anhängen in diesem Board wiederhergestellt." confirmLabel="Wiederherstellen" requireTyped="WIEDERHERSTELLEN"/>}<ConfirmButton action={purgeCardAction.bind(null,boardId,row.id)} label="Endgültig löschen" className="btn-danger" title="Karte endgültig löschen" message="Die Karte mit ihren Inhalten und Anhängen wird endgültig entfernt. Eigenständige Kassenbuchkopien und Nextcloud-Archive bleiben erhalten." confirmLabel="Endgültig löschen" confirmClassName="btn-danger" requireTyped="ENDGÜLTIG"/></div>}</section>}))}/>
    <h2 className="text-lg font-semibold">Dateien ({rows.length})</h2>
    <FilterableList placeholder="Dateiname oder Karte suchen …" emptyText={rows.length ? "Keine passenden Dateien." : "Der Datei-Papierkorb ist leer."} items={rows.map(row => ({ key: row.id, search: `${row.filename} ${row.cardTitle} ${row.cardNumber ?? ""}`, element:
      <section className="card space-y-4 p-5">
        <h2 className="break-words font-semibold">{row.filename}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-slate-500">Ursprüngliche Karte</dt><dd className="break-words">{row.cardId ? <Link className="text-brand-700 hover:underline" href={`/intern/card/${row.cardId}`}>{row.cardNumber ? `${row.cardNumber} · ` : ""}{row.cardTitle}</Link> : <>{row.cardNumber ? `${row.cardNumber} · ` : ""}{row.cardTitle} <span className="text-slate-500">(Karte gelöscht)</span></>}</dd></div>
          <div className="min-w-0"><dt className="text-slate-500">Gelöscht von</dt><dd className="break-words">{row.deletedBy}</dd></div>
          <div><dt className="text-slate-500">Im Papierkorb seit</dt><dd>{formatDateTime(row.deletedAt)}</dd></div>
          <div><dt className="text-slate-500">Wiederherstellbar bis</dt><dd>{formatDateTime(row.expiresAt)}</dd></div>
        </dl>
        {row.lastError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{row.lastError}</p>}
        {row.state === "purging" ? <p className="text-sm text-slate-600">Die endgültige Löschung wurde begonnen. Die ausstehende Dateibereinigung wird erneut versucht.</p> : row.expiresAt <= new Date() ? <p className="text-sm text-slate-600">Die Aufbewahrungsfrist ist abgelaufen. Die Datei wartet auf die tägliche Bereinigung.</p> : row.locked ? <p className="text-sm text-slate-600">Die Karte ist inzwischen dauerhaft gesperrt. Ihre eingefrorenen Inhalte können durch eine Wiederherstellung nicht mehr verändert werden.</p> : !row.cardId ? <p className="text-sm text-slate-600">Die ursprüngliche Karte wurde gelöscht. Eine Wiederherstellung ist nicht mehr möglich.</p> : null}
        {writable && <div className="flex flex-wrap gap-3">
          {row.restorable && <ConfirmButton action={restoreFileAction.bind(null, boardId, row.id)} label="Wiederherstellen" className="btn-secondary" title="Datei wiederherstellen" message="Die Datei wird mit ihrem ursprünglichen Namen an der ursprünglichen Karte wiederhergestellt. Vorhandene Dateien werden nicht überschrieben. Falls ihr früherer Ordner nicht mehr existiert, landet sie direkt an der Karte." confirmLabel="Wiederherstellen" requireTyped="WIEDERHERSTELLEN" />}
          <ConfirmButton action={purgeFileAction.bind(null, boardId, row.id)} label={row.state === "purging" ? "Bereinigung erneut versuchen" : "Endgültig löschen"} className="btn-danger" title="Datei endgültig löschen" message="Die gespeicherte Datei wird endgültig aus diesem Papierkorb entfernt. Diese Aktion kann nicht rückgängig gemacht werden. Eigenständige Kopien im Kassenbuch und Nextcloud-Archive bleiben erhalten." confirmLabel="Endgültig löschen" confirmClassName="btn-danger" requireTyped="ENDGÜLTIG" />
        </div>}
      </section>
    }))} />
  </div>;
}
