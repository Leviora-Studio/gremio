// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, boards, boardStatuses, attachments } from "@/lib/db/schema";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/dates";
import { PUBLIC_ATTACHMENT_KINDS } from "@/lib/constants";
import { PublicUploadForm } from "@/components/PublicUploadForm";
import { PublicSubmitForm } from "@/components/PublicSubmitForm";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";

const NAMED_PUBLIC: { kind: string; label: string }[] = [
  { kind: "finance_request", label: "Finanzantrag" },
  { kind: "annex_a", label: "Anlage A" },
  { kind: "annex_b", label: "Anlage B" },
];

function fmt(d: Date) {
  return formatDateTime(d, "long");
}

export default async function StatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [antrag] = await db
    .select({
      id: cards.id,
      boardId: cards.boardId,
      statusId: cards.statusId,
      number: cards.number,
      title: cards.title,
      applicant: cards.applicant,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
      resubmittedAt: cards.resubmittedAt,
      applicantNote: cards.applicantNote,
      statusName: boardStatuses.name,
      isArchiveTrigger: boardStatuses.isArchiveTrigger,
    })
    .from(cards)
    .leftJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(eq(cards.token, token))
    .limit(1);

  if (!antrag) notFound();

  // Board-Gates: bestimmt, ob/welcher „Einreichen"-Button gezeigt wird.
  const [board] = await db
    .select({
      resubmitStatusId: boards.resubmitStatusId,
      receiptFromStatusId: boards.receiptFromStatusId,
      receiptToStatusId: boards.receiptToStatusId,
    })
    .from(boards)
    .where(eq(boards.id, antrag.boardId))
    .limit(1);

  // Liegt der Antrag in der Archiv-Spalte (Nextcloud-Trigger), ist er
  // abgeschlossen: kein öffentliches Nachreichen / Einreichen mehr.
  const isArchived = !!antrag.isArchiveTrigger;
  const canResubmit =
    !isArchived &&
    !!board?.resubmitStatusId &&
    antrag.statusId === board.resubmitStatusId;
  const canReceipt =
    !isArchived &&
    !!board?.receiptFromStatusId &&
    !!board?.receiptToStatusId &&
    antrag.statusId === board.receiptFromStatusId;
  const submitLabel = canResubmit
    ? "Nachreichung einreichen"
    : "Quittung einreichen";

  const atts = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.cardId, antrag.id),
        inArray(attachments.kind, [...PUBLIC_ATTACHMENT_KINDS]),
      ),
    )
    .orderBy(asc(attachments.uploadedAt));

  const named = NAMED_PUBLIC.map((n) => ({
    label: n.label,
    file: atts.find((a) => a.kind === n.kind) ?? null,
  })).filter((n) => n.file);
  const others = atts.filter((a) => a.kind === "other");

  const link = `${env.APP_BASE_URL}/status/${token}`;

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <LiveRefresh src={`/api/status/${token}/stream`} />
      <h1 className="text-2xl font-bold">Status deines Antrags</h1>

      <div className="card mt-6 space-y-4 p-6">
        {antrag.number && (
          <div>
            <div className="text-xs font-medium uppercase text-slate-400">
              Antragsnummer
            </div>
            <div className="text-lg font-semibold text-brand-700">
              {antrag.number}
            </div>
          </div>
        )}
        <div>
          <div className="text-xs font-medium uppercase text-slate-400">
            Antragsgegenstand
          </div>
          <div className="text-lg">{antrag.title}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-slate-400">
            Antragsteller
          </div>
          <div>{antrag.applicant}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-slate-400">
            Aktueller Status
          </div>
          <div className="inline-block rounded bg-brand-50 px-3 py-1 font-medium text-brand-700">
            {antrag.statusName ?? "—"}
          </div>
          {antrag.resubmittedAt && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 rounded bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
                ● Von dir nachgereicht am {fmt(antrag.resubmittedAt)}
              </span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm text-slate-500">
          <div>Eingegangen: {fmt(antrag.createdAt)}</div>
          <div>Letzte Änderung: {fmt(antrag.updatedAt)}</div>
        </div>
      </div>

      {/* Hinweis für den Antragsteller (vom Gremium gesetzt) */}
      {antrag.applicantNote && antrag.applicantNote.trim() !== "" && (
        <div className="card mt-6 border-amber-300 bg-amber-50 p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-amber-800">
            Hinweis
          </h2>
          <p className="whitespace-pre-wrap text-sm text-amber-900">
            {antrag.applicantNote}
          </p>
        </div>
      )}

      {/* Dokumente (nur ansehen) */}
      <div className="card mt-6 space-y-3 p-6">
        <h2 className="text-lg font-semibold">Dokumente</h2>
        {named.length === 0 && others.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aktuell sind keine Dokumente hinterlegt.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {named.map((n) => (
              <li key={n.file!.id}>
                <AttachmentLink
                  id={n.file!.id}
                  filename={n.file!.filename}
                  label={n.label}
                  mime={n.file!.mime}
                  src={`/api/status/${token}/attachment/${n.file!.id}`}
                  className="text-brand-600 hover:underline"
                />
                <span className="text-slate-400"> — {n.file!.filename}</span>
              </li>
            ))}
            {others.map((a) => (
              <li key={a.id}>
                <AttachmentLink
                  id={a.id}
                  filename={a.filename}
                  mime={a.mime}
                  src={`/api/status/${token}/attachment/${a.id}`}
                  className="text-brand-600 hover:underline"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Datei nachreichen (nur hinzufügen, nichts überschreiben/löschen).
          Entfällt, sobald der Antrag archiviert ist. */}
      <div className="card mt-6 space-y-3 p-6">
        <h2 className="text-lg font-semibold">Datei nachreichen</h2>
        {isArchived ? (
          <p className="text-sm text-slate-500">
            Dieser Antrag ist abgeschlossen und archiviert. Es können keine
            weiteren Dateien mehr hinzugefügt werden.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Du kannst weitere PDF-Dateien hinzufügen (z. B. Quittungen oder
              nachgeforderte Unterlagen). Bereits hochgeladene Dateien bleiben
              erhalten und können hier nicht gelöscht werden.
            </p>
            <PublicUploadForm token={token} />
          </>
        )}
      </div>

      {/* Einreichen — nur wenn die aktuelle Spalte ein Gate aktiviert hat */}
      {(canResubmit || canReceipt) && (
        <div className="card mt-6 space-y-3 border-brand-100 p-6">
          <h2 className="text-lg font-semibold">
            {canResubmit ? "Unterlagen einreichen" : "Quittung einreichen"}
          </h2>
          <p className="text-sm text-slate-500">
            {canResubmit
              ? "Lade hier die nachgeforderten Unterlagen als PDF hoch und reiche sie anschließend ein. Dein Antrag wird dann als nachgereicht markiert."
              : "Lade hier die Quittung(en) als PDF hoch und reiche sie anschließend ein. Dein Antrag geht damit in den nächsten Schritt."}
          </p>
          {/* Benennungs-Hinweis nur beim Einreichen von Quittungen. */}
          {!canResubmit && (
            <div className="rounded-md border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
              <p className="font-semibold">Wichtig für deine Quittungen</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  Jede Quittung muss <strong>vollständig sichtbar</strong> und{" "}
                  <strong>nicht abgeschnitten</strong> sein — der gesamte Beleg
                  inklusive <strong>Kaufdatum</strong> muss auf dem Scan klar
                  erkennbar sein.
                </li>
                <li>
                  Lade <strong>jede Quittung als eigene, einzelne PDF-Datei</strong>{" "}
                  hoch — bitte nicht mehrere Quittungen in einem Dokument
                  zusammenfassen.
                </li>
                <li>
                  Benenne die Dateien fortlaufend nach dem Schema{" "}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-brand-800 ring-1 ring-brand-200">
                    {antrag.number ? `${antrag.number}_Q1` : "Antragsnummer_Q1"}
                  </code>
                  ,{" "}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-brand-800 ring-1 ring-brand-200">
                    {antrag.number ? `${antrag.number}_Q2` : "Antragsnummer_Q2"}
                  </code>{" "}
                  usw.
                  {!antrag.number && (
                    <>
                      {" "}
                      („Antragsnummer" durch deine oben angezeigte Antragsnummer
                      ersetzen.)
                    </>
                  )}
                </li>
              </ul>
            </div>
          )}
          <PublicUploadForm token={token} />
          <div className="border-t border-slate-100 pt-3">
            <PublicSubmitForm token={token} label={submitLabel} />
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a href={`/status/${token}/pdf`} className="btn-primary">
          Eingangsbestätigung (PDF)
        </a>
        <span className="text-sm text-slate-500">
          Bitte speichere diesen Link: {link}
        </span>
      </div>
    </main>
  );
}
