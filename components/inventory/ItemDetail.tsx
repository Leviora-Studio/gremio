// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  InventoryAttachment,
  InventoryDefect,
  InventoryLoan,
} from "@/lib/db/schema";
import type { InventoryItemView } from "@/lib/inventory-items";
import type { InventoryAttachmentKind } from "@/lib/inventory-attachment-kinds";
import { SubmitButton } from "@/components/SubmitButton";
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
  deleteLoanAction,
  returnLoanAction,
  toggleDefectAction,
} from "@/app/intern/inventar/item/[itemId]/actions";

type OptionKind = keyof GroupedOpts;

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
  defects: InventoryDefect[];
  attachments: Record<InventoryAttachmentKind, InventoryAttachment[]>;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<GroupedOpts>(initialOptions);
  const [editing, setEditing] = useState(false);

  const show = (k: string) => visibleFields.includes(k);
  const activeLoan = loans.find((l) => !l.returnedAt);
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
  if (show("loan_status"))
    stamm.push({ label: "Entleihstatus", value: item.loanStatusName || "—" });
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

      {/* Entleihe */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Entleihe</h2>
        {activeLoan ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm">
              Aktuell bei <strong>{activeLoan.borrower}</strong>
            </p>
            <p className="text-sm text-slate-600">
              Zeitraum: {period(activeLoan.startDate, activeLoan.endDate)}
              {activeLoan.purpose ? ` · ${activeLoan.purpose}` : ""}
            </p>
            <form action={returnLoanAction} className="mt-2">
              <input type="hidden" name="loanId" value={activeLoan.id} />
              <SubmitButton className="btn-secondary px-3 py-1 text-sm">
                Zurücknehmen
              </SubmitButton>
            </form>
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-500">
            Aktuell nicht entliehen.
          </p>
        )}

        <form
          action={createLoanAction}
          className="space-y-3 rounded-lg border border-slate-200 p-3"
        >
          <input type="hidden" name="itemId" value={item.id} />
          <p className="text-sm font-medium">Neuer Entleihvorgang</p>
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

        {loans.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">
              Historie
            </p>
            <ul className="space-y-1.5">
              {loans.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-2 rounded border border-slate-100 px-3 py-2 text-sm"
                >
                  <span>
                    <strong>{l.borrower}</strong> ·{" "}
                    {period(l.startDate, l.endDate)}
                    {l.returnedAt ? (
                      <span className="ml-1 text-slate-500">
                        (zurück am {fmtDateTime(l.returnedAt)})
                      </span>
                    ) : (
                      <span className="ml-1 font-medium text-amber-700">
                        (läuft)
                      </span>
                    )}
                  </span>
                  <form action={deleteLoanAction}>
                    <input type="hidden" name="loanId" value={l.id} />
                    <SubmitButton className="text-xs text-slate-400 hover:text-red-600">
                      löschen
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
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
                <span className={d.resolvedAt ? "line-through" : ""}>
                  {d.description}
                  {d.resolvedAt && (
                    <span className="ml-1 no-underline">
                      (behoben am {fmtDateTime(d.resolvedAt)})
                    </span>
                  )}
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
