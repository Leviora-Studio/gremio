// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { notFound } from "next/navigation";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import { appBaseUrl } from "@/lib/public-api";
import { formatDateTime } from "@/lib/dates";
import { PublicUploadForm } from "@/components/PublicUploadForm";
import { PublicSubmitForm } from "@/components/PublicSubmitForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScrollToTop } from "@/components/ScrollToTop";
import { StatusLinkBox } from "@/components/StatusLinkBox";
import { getApplicationStatusByToken } from "@/lib/public-status";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return formatDateTime(d, "long");
}

export default async function StatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Gemeinsamer Loader mit der öffentlichen API — was dort nicht drinsteht,
  // ist auch hier nicht sichtbar (und umgekehrt). `undefined` deckt beides ab:
  // unbekannter Token UND Feedback-Token (Feedback hat eine eigene Seite).
  const antrag = await getApplicationStatusByToken(token);
  if (!antrag) notFound();

  const isArchived = antrag.archived;
  const canResubmit = antrag.submitMode === "resubmission";
  const canReceipt = antrag.submitMode === "receipt";
  const submitLabel = canResubmit
    ? "Nachreichung einreichen"
    : "Quittung einreichen";

  const link = `${appBaseUrl()}/status/${token}`;

  return (
    // Etwas breiter als die übrigen öffentlichen Seiten: Der Status-Link oben
    // ist lang und soll neben dem PDF-Button nicht auf drei Zeilen umbrechen.
    <main className="mx-auto max-w-2xl px-4 py-10">
      <LiveRefresh src={`/api/status/${token}/stream`} />
      <ScrollToTop />

      {/* Zuerst der Status-Link: ohne ihn findet der Antragsteller seinen
          Antrag nicht wieder (kein Mailversand). Deshalb ganz oben. */}
      <StatusLinkBox link={link} pdfHref={`/status/${token}/pdf`} />

      <h1 className="mt-8 text-2xl font-bold">Status deines Antrags</h1>

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
        {antrag.documents.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aktuell sind keine Dokumente hinterlegt.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {antrag.documents.map((d) => (
              <li key={d.id}>
                {/* Benannte Slots zeigen ihr Label plus den Dateinamen;
                    nachgereichte Dateien nur den Dateinamen. */}
                <AttachmentLink
                  id={d.id}
                  filename={d.filename}
                  label={d.kind === "other" ? undefined : d.label}
                  mime={d.mime}
                  src={`/api/status/${token}/attachment/${d.id}`}
                  className="text-brand-600 hover:underline"
                />
                {d.kind !== "other" && (
                  <span className="text-slate-400"> — {d.filename}</span>
                )}
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
                  Die Quittungen werden{" "}
                  <strong>automatisch fortlaufend benannt</strong> (Q1, Q2 …) —
                  du musst dich nicht selbst um die Benennung kümmern.
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

    </main>
  );
}
