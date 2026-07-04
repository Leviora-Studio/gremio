// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireInventoryBoardAccess } from "@/lib/inventory";
import { getInventoryItemById } from "@/lib/inventory-items";
import { getLoanById, getLoanItems } from "@/lib/inventory-loans";
import { listLoanAttachments } from "@/lib/inventory-attachments";
import {
  loanStageClass,
  loanStageLabel,
} from "@/lib/inventory-loan-stage";
import { SubmitButton } from "@/components/SubmitButton";
import { LoanContractUpload } from "@/components/inventory/LoanContractUpload";
import { LiveRefresh } from "@/components/LiveRefresh";
import {
  approveLoanAction,
  deleteLoanAction,
  rejectLoanAction,
  returnLoanAction,
  setLoanBorrowerNoteAction,
} from "../../item/[itemId]/actions";

const PENDING = ["requested", "contract_provided", "contract_signed"];

function fmtDate(s: string | null): string | null {
  if (!s) return null;
  const [datePart, timePart] = s.split("T");
  const [y, m, d] = datePart.split("-");
  const date = d ? `${d}.${m}.${y}` : datePart;
  return timePart ? `${date}, ${timePart} Uhr` : date;
}

export default async function InventoryLoanPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  const { loanId } = await params;
  const loan = await getLoanById(Number(loanId));
  if (!loan) notFound();
  const item = await getInventoryItemById(loan.itemId);
  if (!item) notFound();
  const { user, board } = await requireInventoryBoardAccess(item.boardId);

  const docs = await listLoanAttachments(loan.id);
  const loanItems = await getLoanItems(loan.id);
  const pending = PENDING.includes(loan.status);
  const from = fmtDate(loan.startDate);
  const to = fmtDate(loan.endDate);
  // Öffentlicher Status-Link der Anfrage (nur bei öffentlichen Anfragen mit Token).
  const statusLink = loan.token
    ? `${env.APP_BASE_URL}/inventar/status/${loan.token}`
    : null;

  const detail: { label: string; value: string }[] = [
    { label: "Entleiher", value: loan.borrower },
  ];
  if (loan.borrowerEmail)
    detail.push({ label: "E-Mail", value: loan.borrowerEmail });
  if (from || to)
    detail.push({ label: "Zeitraum", value: `${from ?? "?"} – ${to ?? "?"}` });
  if (loan.purpose)
    detail.push({ label: "Verwendungsort / Zweck", value: loan.purpose });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <LiveRefresh src={`/api/inventory/board/${board.id}/stream`} />

      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Link href={`/intern/inventar/${board.id}`} className="text-brand-600">
            ← {board.name}
          </Link>
          <span className="text-slate-300">/</span>
          <Link
            href={`/intern/inventar/item/${item.id}`}
            className="text-brand-600"
          >
            {item.name || "Gegenstand"}
          </Link>
        </div>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          Vorgang: {loan.borrower}
          <span
            className={`rounded px-2.5 py-0.5 text-sm font-medium ${loanStageClass(loan.status)}`}
          >
            {loanStageLabel(loan.status)}
          </span>
        </h1>
      </div>

      <div className="card p-5">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {detail.map((d) => (
            <div key={d.label}>
              <dt className="text-xs uppercase tracking-wide text-slate-400">
                {d.label}
              </dt>
              <dd className="text-sm text-slate-800">{d.value}</dd>
            </div>
          ))}
        </dl>

        {statusLink && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <dt className="text-xs uppercase tracking-wide text-slate-400">
              Status-Link (öffentlich)
            </dt>
            <dd>
              <a
                href={statusLink}
                target="_blank"
                rel="noopener"
                className="break-all text-sm text-brand-600 hover:underline"
              >
                {statusLink}
              </a>
            </dd>
          </div>
        )}

        {/* Aktionen je nach Status */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {pending && (
            <>
              {loan.status === "contract_signed" ? (
                <form action={approveLoanAction}>
                  <input type="hidden" name="loanId" value={loan.id} />
                  <SubmitButton className="btn-primary">Annehmen</SubmitButton>
                </form>
              ) : (
                <span className="text-sm text-slate-500">
                  Annehmen ist möglich, sobald der unterschriebene Vertrag
                  vorliegt.
                </span>
              )}
              <form action={rejectLoanAction}>
                <input type="hidden" name="loanId" value={loan.id} />
                <SubmitButton className="btn-secondary text-red-600">
                  Ablehnen
                </SubmitButton>
              </form>
            </>
          )}
          {loan.status === "active" && (
            <form action={returnLoanAction}>
              <input type="hidden" name="loanId" value={loan.id} />
              <SubmitButton className="btn-secondary">
                Rückgabe erfolgt
              </SubmitButton>
            </form>
          )}
          <form action={deleteLoanAction} className="ml-auto">
            <input type="hidden" name="loanId" value={loan.id} />
            <SubmitButton className="text-sm text-slate-400 hover:text-red-600">
              Vorgang löschen
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* Reservierte Stücke (bei Stückzahl-Ausleihe mehrere) */}
      {loanItems.length > 1 && (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">
            Reservierte Stücke ({loanItems.length})
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Dieser Vorgang umfasst mehrere konkrete Stücke.
          </p>
          <ul className="divide-y divide-slate-100">
            {loanItems.map((li) => (
              <li key={li.id}>
                <Link
                  href={`/intern/inventar/item/${li.id}`}
                  className="flex items-center justify-between gap-2 py-2 text-sm hover:text-brand-600"
                >
                  <span className="font-medium text-slate-800">{li.name}</span>
                  <span className="text-slate-400">{li.number ?? "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hinweise für den Entleiher (über den Status-Link sichtbar) */}
      <form action={setLoanBorrowerNoteAction} className="card space-y-2 p-5">
        <input type="hidden" name="loanId" value={loan.id} />
        <div>
          <h2 className="font-semibold">Hinweise für den Entleiher</h2>
          <p className="text-sm text-slate-500">
            Diese Hinweise sieht der Entleiher über seinen Status-Link.
          </p>
        </div>
        <textarea
          name="borrowerNote"
          rows={3}
          className="input"
          defaultValue={loan.borrowerNote ?? ""}
          placeholder="z. B. Abholung Mo–Fr 10–14 Uhr im Stura-Büro, Pfand 20 €."
        />
        <SubmitButton className="btn-primary">Speichern</SubmitButton>
      </form>

      {/* Dokumente des Vorgangs (Leihvertrag/-antrag) */}
      <div className="card p-5">
        <h2 className="mb-1 font-semibold">Dokumente</h2>
        <p className="mb-2 text-sm text-slate-500">
          Leihvertrag/-antrag für diesen Vorgang. Der bereitgestellte Vertrag
          erscheint auf der öffentlichen Statusseite zum Unterschreiben.
        </p>
        <LoanContractUpload
          loanId={loan.id}
          docs={docs}
          hasCert={!!user.certSubject}
        />
      </div>
    </div>
  );
}
