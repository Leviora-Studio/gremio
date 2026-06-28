// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InventoryAttachment, InventoryLoan } from "@/lib/db/schema";
import type { InventoryItemView } from "@/lib/inventory-items";
import type { DefectView } from "@/lib/inventory-loans";
import {
  LOAN_STAGE_LABEL,
  loanStageClass,
} from "@/lib/inventory-loan-stage";
import type { InventoryAttachmentKind } from "@/lib/inventory-attachment-kinds";
import { SubmitButton } from "@/components/SubmitButton";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { ItemAttachments } from "./ItemAttachments";
import {
  ItemFormModal,
  type GroupedOpts,
  type Opt,
} from "./ItemFormModal";
import {
  createDefectAction,
  createLoanAction,
  deleteDefectAction,
  toggleDefectAction,
} from "@/app/intern/inventar/item/[itemId]/actions";

type OptionKind = keyof GroupedOpts;

const LOAN_STAGE = LOAN_STAGE_LABEL;

function fmtDate(s: string | null): string | null {
  if (!s) return null;
  const [y, m, d] = s.split("-");
  return d ? `${d}.${m}.${y}` : s;
}
function fmtCents(c: number | null): string {
  if (c == null) return "—";
  return `${(c / 100).toFixed(2).replace(".", ",")} €`;
}
function fmtDateTime(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function period(start: string | null, end: string | null): string {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return `ab ${s}`;
  if (e) return `bis ${e}`;
  return "ohne Zeitraum";
}

export function ItemDetail({
  item,
  boardName,
  visibleFields,
  options: initialOptions,
  numberingEnabled,
  loans,
  defects,
  attachments,
}: {
  item: InventoryItemView;
  boardName: string;
  visibleFields: string[];
  options: GroupedOpts;
  numberingEnabled: boolean;
  loans: InventoryLoan[];
  defects: DefectView[];
  attachments: Record<InventoryAttachmentKind, InventoryAttachment[]>;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<GroupedOpts>(initialOptions);
  const [editing, setEditing] = useState(false);

  const show = (k: string) => visibleFields.includes(k);
  const PENDING = ["requested", "contract_provided", "contract_signed"];
  const requests = loans.filter((l) => PENDING.includes(l.status));
  const openDefects = defects.filter((d) => !d.resolvedAt);

  function onOptionAdded(kind: OptionKind, opt: Opt) {
    setOptions((prev) => ({
      ...prev,
      [kind]: [...prev[kind], opt].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  const stamm: { label: string; value: ReactNode }[] = [];
  if (show("number"))
    stamm.push({ label: "Inventarnummer", value: item.number || "—" });
  if (show("category"))
    stamm.push({
      label: "Kategorie",
      value: item.categoryNames.length ? (
        <span className="flex flex-wrap gap-1">
          {item.categoryNames.map((n) => (
            <span
              key={n}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
            >
              {n}
            </span>
          ))}
        </span>
      ) : (
        "—"
      ),
    });
  if (show("location"))
    stamm.push({ label: "Standort", value: item.locationName || "—" });
  if (show("lendable"))
    stamm.push({
      label: "Entleihbar",
      value: item.lendable ? "ja" : "nein",
    });
  if (show("availability"))
    stamm.push({
      label: "Verfügbarkeit",
      value: (
        <AvailabilityBadge
          availability={item.availability}
          until={item.activeUntil}
        />
      ),
    });
  if (show("price"))
    stamm.push({ label: "Kaufpreis", value: fmtCents(item.price) });
  if (show("purchase_date"))
    stamm.push({ label: "Kaufdatum", value: fmtDate(item.purchaseDate) || "—" });
  if (show("vendor"))
    stamm.push({ label: "Händler", value: item.vendor || "—" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/intern/inventar/${item.boardId}`}
            className="text-sm text-brand-600"
          >
            ← {boardName}
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {item.name || "(ohne Bezeichnung)"}
            {openDefects.length > 0 && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-700">
                ⚠ {openDefects.length} Mangel
              </span>
            )}
          </h1>
          {item.number && (
            <p className="text-sm text-slate-500">{item.number}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-secondary"
        >
          Bearbeiten
        </button>
      </div>

      {/* Stammdaten */}
      {stamm.length > 0 && (
        <div className="card p-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {stamm.map((s) => (
              <div key={s.label}>
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  {s.label}
                </dt>
                <dd className="text-sm text-slate-800">{s.value}</dd>
              </div>
            ))}
          </dl>
          {show("notes") && item.notes && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <dt className="text-xs uppercase tracking-wide text-slate-400">
                Notizen
              </dt>
              <dd className="whitespace-pre-wrap text-sm text-slate-700">
                {item.notes}
              </dd>
            </div>
          )}
        </div>
      )}

      {/* Entleih-Vorgänge — jede Anfrage/Entleihe ist ein aufklickbarer Vorgang */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Entleih-Vorgänge</h2>

        {requests.length > 0 && (
          <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
            {requests.length} offene{" "}
            {requests.length === 1 ? "Anfrage" : "Anfragen"} — zum Bearbeiten den
            Vorgang öffnen.
          </p>
        )}

        {loans.length > 0 ? (
          <ul className="space-y-1.5">
            {loans.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/intern/inventar/loan/${l.id}`}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition hover:bg-slate-50 ${
                    PENDING.includes(l.status)
                      ? "border-blue-200 bg-blue-50/40"
                      : "border-slate-100"
                  }`}
                >
                  <span>
                    <strong>{l.borrower}</strong> · {period(l.startDate, l.endDate)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${loanStageClass(l.status)}`}
                  >
                    {l.status === "returned"
                      ? `zurück am ${fmtDateTime(l.returnedAt)}`
                      : LOAN_STAGE[l.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Noch keine Vorgänge.</p>
        )}

        <form
          action={createLoanAction}
          className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3"
        >
          <input type="hidden" name="itemId" value={item.id} />
          <p className="text-sm font-medium">Manueller Entleihvorgang</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Entleiher</label>
              <input
                name="borrower"
                className="input"
                required
                placeholder="Name"
              />
            </div>
            <div>
              <label className="label">Verwendungsort / Zweck</label>
              <input name="purpose" className="input" />
            </div>
            <div>
              <label className="label">Von</label>
              <input name="startDate" type="date" className="input" />
            </div>
            <div>
              <label className="label">Bis</label>
              <input name="endDate" type="date" className="input" />
            </div>
          </div>
          <SubmitButton className="btn-primary">Entleihen</SubmitButton>
        </form>
      </section>

      {/* Mängel */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Mängel</h2>
        <form action={createDefectAction} className="mb-4 flex items-end gap-2">
          <input type="hidden" name="itemId" value={item.id} />
          <div className="flex-1">
            <label className="label">Mangel melden</label>
            <input
              name="description"
              className="input"
              required
              placeholder="z. B. Bein wackelt"
            />
          </div>
          <SubmitButton className="btn-primary">Melden</SubmitButton>
        </form>

        {defects.length === 0 ? (
          <p className="text-sm text-slate-500">Keine Mängel erfasst.</p>
        ) : (
          <ul className="space-y-1.5">
            {defects.map((d) => (
              <li
                key={d.id}
                className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm ${
                  d.resolvedAt
                    ? "border-slate-100 text-slate-400"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <span>
                  <span className={d.resolvedAt ? "line-through" : ""}>
                    {d.description}
                  </span>
                  {d.resolvedAt && (
                    <span className="ml-1">
                      (behoben am {fmtDateTime(d.resolvedAt)})
                    </span>
                  )}
                  <span className="ml-1 block text-xs text-slate-400">
                    gemeldet von {d.creatorName ?? "—"} am{" "}
                    {fmtDateTime(d.createdAt)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <form action={toggleDefectAction}>
                    <input type="hidden" name="defectId" value={d.id} />
                    <SubmitButton className="text-xs text-brand-600 hover:underline">
                      {d.resolvedAt ? "wieder öffnen" : "behoben"}
                    </SubmitButton>
                  </form>
                  <form action={deleteDefectAction}>
                    <input type="hidden" name="defectId" value={d.id} />
                    <SubmitButton className="text-xs text-slate-400 hover:text-red-600">
                      löschen
                    </SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dateien: Belege, Leihanträge, Leihverträge (mit Historie) */}
      <ItemAttachments itemId={item.id} attachments={attachments} />

      {editing && (
        <ItemFormModal
          boardId={item.boardId}
          item={item}
          visibleFields={visibleFields}
          options={options}
          numberingEnabled={numberingEnabled}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
          onOptionAdded={onOptionAdded}
        />
      )}
    </div>
  );
}
