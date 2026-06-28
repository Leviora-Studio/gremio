// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { notFound } from "next/navigation";
import {
  getLoanByToken,
  PENDING_LOAN_STATUSES,
} from "@/lib/inventory-loans";
import { getInventoryItemById } from "@/lib/inventory-items";
import { listLoanAttachments } from "@/lib/inventory-attachments";
import { PublicContractSection } from "@/components/inventory/PublicContractSection";
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
  const [y, m, d] = s.split("-");
  return d ? `${d}.${m}.${y}` : s;
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
    .map((d) => ({ id: d.id, filename: d.filename, kind: d.kind }));
  const signed = loanDocs
    .filter((d) => d.uploadedBy == null && d.kind === "loan_contract")
    .map((d) => ({ id: d.id, filename: d.filename }));

  const s = STATUS[loan.status] ?? STATUS.requested;
  const pending = (PENDING_LOAN_STATUSES as readonly string[]).includes(
    loan.status,
  );
  const from = fmtDate(loan.startDate);
  const to = fmtDate(loan.endDate);

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
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

        <div>
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${s.cls}`}
          >
            {s.label}
          </span>
          <p className="mt-2 text-sm text-slate-600">{s.hint}</p>
        </div>

        <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">
              Entleiher
            </dt>
            <dd className="text-slate-800">{loan.borrower}</dd>
          </div>
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
          provided={provided}
          signed={signed}
        />
      )}
    </main>
  );
}
