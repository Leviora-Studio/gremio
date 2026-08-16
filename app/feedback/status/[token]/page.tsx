// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { notFound } from "next/navigation";
import { appBaseUrl } from "@/lib/public-api";
import { formatDateTime } from "@/lib/dates";
import { getFeedbackByToken } from "@/lib/public-feedback-submission";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScrollToTop } from "@/components/ScrollToTop";
import { StatusLinkBox } from "@/components/StatusLinkBox";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Status deines Feedbacks — Gremio",
  // Tokengebundene Seite: Landet der geheime Link doch einmal öffentlich,
  // sollen Suchmaschinen ihn wenigstens nicht indexieren.
  robots: { index: false, follow: false },
};

/**
 * Öffentliche Statusseite eines Feedbacks.
 *
 * Zeigt bewusst NUR: Bereich, Name, Originaltext, aktuellen Board-Status,
 * Zeitstempel und den öffentlichen Hinweis des Gremiums. Nicht: Karten-ID,
 * Board, Spalten-ID, Kommentare, Aktivitätsverlauf, Anhänge oder Nextcloud.
 *
 * Bereich, Name und Text stammen aus dem Snapshot in `feedback_submissions` —
 * spätere interne Änderungen an `cards.applicant`/`cards.notes` verändern die
 * hier gezeigte Originaleinreichung also nicht.
 */
export default async function FeedbackStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const fb = await getFeedbackByToken(token);
  // Kein Feedback zu diesem Token (oder ein Antrags-Token) → 404.
  if (!fb) notFound();

  const link = `${appBaseUrl()}/feedback/status/${token}`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {/* Live-Updates über die bestehende Karten-SSE-Infrastruktur. */}
      <LiveRefresh src={`/api/status/${token}/stream`} />
      <ScrollToTop />

      <StatusLinkBox
        link={link}
        pdfHref={`/feedback/status/${token}/pdf`}
        subject="dein Feedback"
      />

      <h1 className="mt-8 text-2xl font-bold">Status deines Feedbacks</h1>

      <div className="card mt-6 space-y-4 p-6">
        {fb.number && (
          <div>
            <div className="text-xs font-medium uppercase text-slate-400">
              Nummer
            </div>
            <div className="text-lg font-semibold text-brand-700">
              {fb.number}
            </div>
          </div>
        )}
        <div>
          <div className="text-xs font-medium uppercase text-slate-400">
            Bereich
          </div>
          <div className="text-lg">{fb.areaName}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-slate-400">
            Einreicher
          </div>
          <div>{fb.submitterName}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-slate-400">
            Aktueller Status
          </div>
          <div className="inline-block rounded bg-brand-50 px-3 py-1 font-medium text-brand-700">
            {fb.statusName ?? "—"}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm text-slate-500">
          <div>Eingegangen: {formatDateTime(fb.createdAt, "long")}</div>
          <div>Letzte Änderung: {formatDateTime(fb.updatedAt, "long")}</div>
        </div>
      </div>

      {/* Öffentlicher Hinweis des Gremiums (bewusst öffentlich — im Gegensatz
          zu den internen Notizen). */}
      {fb.applicantNote && fb.applicantNote.trim() !== "" && (
        <div className="card mt-6 border-amber-300 bg-amber-50 p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-amber-800">
            Hinweis
          </h2>
          <p className="whitespace-pre-wrap text-sm text-amber-900">
            {fb.applicantNote}
          </p>
        </div>
      )}

      <div className="card mt-6 space-y-2 p-6">
        <h2 className="text-lg font-semibold">Dein Feedback</h2>
        {/* whitespace-pre-wrap erhält Absätze; React escapt den Text — es wird
            bewusst KEIN HTML aus der Einreichung gerendert. */}
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
          {fb.feedbackText}
        </p>
      </div>
    </main>
  );
}
