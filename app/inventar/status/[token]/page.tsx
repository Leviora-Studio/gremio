// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { notFound } from "next/navigation";
import {
  getLoanByToken,
  getLoanCardProgress,
  getLoanItems,
  PENDING_LOAN_STATUSES,
} from "@/lib/inventory-loans";
import { getInventoryItemById } from "@/lib/inventory-items";
import { listLoanAttachments } from "@/lib/inventory-attachments";
import { PublicContractSection } from "@/components/inventory/PublicContractSection";
import { LiveRefresh } from "@/components/LiveRefresh";
import { withdrawRequestAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Anfrage-Status — Inventar" };

const STATUS: Record<string, { label: string; cls: string; hint: string }> = {
  requested: {
    label: "Angefragt – wird geprüft",
    cls: "bg-blue-50 text-blue-700",
    hint: "Deine Anfrage liegt zur Prüfung vor. Du wirst über das weitere Vorgehen informiert.",
  },
  contract_provided: {
    label: "Vertrag bereitgestellt",
    cls: "bg-blue-50 text-blue-700",
    hint: "Der Leihvertrag steht unten zum Herunterladen bereit. Bitte unterschreibe ihn und lade den Scan wieder hoch.",
  },
  contract_signed: {
    label: "Vertrag unterschrieben – wird geprüft",
    cls: "bg-blue-50 text-blue-700",
    hint: "Danke! Dein unterschriebener Vertrag liegt vor und wird geprüft.",
  },
  active: {
    label: "Angenommen – ausgeliehen",
    cls: "bg-emerald-50 text-emerald-700",
    hint: "Deine Anfrage wurde angenommen.",
  },
  returned: {
    label: "Abgeschlossen / zurückgegeben",
    cls: "bg-slate-100 text-slate-600",
    hint: "Dieser Vorgang ist abgeschlossen.",
  },
  rejected: {
    label: "Leider abgelehnt",
    cls: "bg-red-50 text-red-700",
    hint: "Deine Anfrage wurde leider abgelehnt.",
  },
  withdrawn: {
    label: "Zurückgezogen",
    cls: "bg-slate-100 text-slate-600",
    hint: "Du hast diese Anfrage zurückgezogen.",
  },
};

function fmtDate(s: string | null): string | null {
  if (!s) return null;
  const [datePart, timePart] = s.split("T");
  const [y, m, d] = datePart.split("-");
  const date = d ? `${d}.${m}.${y}` : datePart;
  return timePart ? `${date}, ${timePart} Uhr` : date;
}

export default async function InventoryRequestStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const loan = await getLoanByToken(token);
  if (!loan) notFound();
  const item = await getInventoryItemById(loan.itemId);

  const loanDocs = await listLoanAttachments(loan.id);
  const provided = loanDocs
    .filter(
      (d) =>
        d.uploadedBy != null &&
        (d.kind === "loan_contract" || d.kind === "loan_request"),
    )
    .map((d) => ({
      id: d.id,
      filename: d.filename,
      kind: d.kind,
      mime: d.mime,
    }));
  const signed = loanDocs
    .filter((d) => d.uploadedBy == null && d.kind === "loan_contract")
    .map((d) => ({ id: d.id, filename: d.filename, mime: d.mime }));

  const s = STATUS[loan.status] ?? STATUS.requested;
  const pending = (PENDING_LOAN_STATUSES as readonly string[]).includes(
    loan.status,
  );
  const from = fmtDate(loan.startDate);
  const to = fmtDate(loan.endDate);

  // Stückzahl-Anfrage: angefragte Menge immer zeigen, bestätigte erst nach der
  // Bestätigung (Ausleihe läuft/abgeschlossen).
  const confirmedQty = (await getLoanItems(loan.id)).length;
  const isQuantity = loan.requestedQuantity > 1 || confirmedQty > 1;
  const showConfirmed =
    loan.status === "active" || loan.status === "returned";

  // Aufgabentracking: bei verknüpfter Karte die Board-Spalten als Status zeigen.
  // Abgelehnt/zurückgezogen sind Vorgangs-Endzustände (nicht auf dem Board).
  const terminal = loan.status === "rejected" || loan.status === "withdrawn";
  const progress =
    loan.cardId && !terminal ? await getLoanCardProgress(loan.cardId) : null;
  const currentIndex = progress
    ? progress.columns.findIndex((c) => c.id === progress.currentStatusId)
    : -1;
  // Ist der aktuelle Schritt der letzte (z. B. „Zurückgegeben"), gilt der
  // Vorgang als abgeschlossen → grüner Haken statt Nummer (überall ein Haken).
  const atEnd = progress != null && currentIndex === progress.columns.length - 1;

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <LiveRefresh src={`/api/inventar/status/${token}/stream`} />
      <h1 className="text-2xl font-bold">Status deiner Anfrage</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bewahre den Link zu dieser Seite auf, um den Status später erneut
        aufzurufen.
      </p>

      <div className="card mt-6 space-y-4 p-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Gegenstand
          </div>
          <div className="font-semibold text-slate-800">
            {item?.name ?? "—"}
          </div>
        </div>

        {progress ? (
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Status
            </div>
            <ol className="mt-2 space-y-2">
              {progress.columns.map((c, i) => {
                const done = i < currentIndex;
                const current = i === currentIndex;
                // Erledigt-Optik (grüner Haken) auch für den aktuellen Schritt,
                // wenn er der letzte ist (Vorgang abgeschlossen).
                const completed = done || (current && atEnd);
                return (
                  <li key={c.id} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        completed
                          ? "bg-emerald-500 text-white"
                          : current
                            ? "bg-brand-600 text-white"
                            : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {completed ? "✓" : i + 1}
                    </span>
                    <span
                      className={
                        current
                          ? "font-semibold text-slate-800"
                          : done
                            ? "text-slate-500"
                            : "text-slate-400"
                      }
                    >
                      {c.name}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div>
            <span
              className={`inline-block rounded px-3 py-1 text-sm font-medium ${s.cls}`}
            >
              {s.label}
            </span>
            <p className="mt-2 text-sm text-slate-600">{s.hint}</p>
          </div>
        )}

        {loan.borrowerNote && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Hinweise zur Ausleihe
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {loan.borrowerNote}
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">
              Entleiher
            </dt>
            <dd className="text-slate-800">{loan.borrower}</dd>
          </div>
          {isQuantity && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">
                Angefragte Stückzahl
              </dt>
              <dd className="text-slate-800">
                {loan.requestedQuantity} Stück
                {showConfirmed && (
                  <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                    {confirmedQty} bestätigt
                  </span>
                )}
              </dd>
            </div>
          )}
          {(from || to) && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">
                Zeitraum
              </dt>
              <dd className="text-slate-800">
                {from ?? "?"} – {to ?? "?"}
              </dd>
            </div>
          )}
          {loan.purpose && (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-400">
                Verwendungsort / Zweck
              </dt>
              <dd className="text-slate-800">{loan.purpose}</dd>
            </div>
          )}
        </dl>

        {pending && (
          <form
            action={withdrawRequestAction.bind(null, token)}
            className="border-t border-slate-100 pt-4"
          >
            <button
              type="submit"
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Anfrage zurückziehen
            </button>
          </form>
        )}
      </div>

      {pending && (
        <PublicContractSection
          token={token}
          status={loan.status}
          provided={provided}
          signed={signed}
        />
      )}
    </main>
  );
}
