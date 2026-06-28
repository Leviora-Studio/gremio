// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireInventoryBoardManage } from "@/lib/inventory";
import {
  getInventoryBoardFields,
  INVENTORY_FIELD_KEYS,
  INVENTORY_FIELD_LABELS,
  type InventoryFieldKey,
} from "@/lib/inventory-fields";
import { getInventoryNumbering } from "@/lib/inventory-items";
import { DeleteInventoryBoardButton } from "@/components/inventory/DeleteInventoryBoardButton";
import {
  renameInventoryBoardAction,
  updateInventoryFieldsAction,
  updateInventoryNumberingAction,
} from "./actions";

export const metadata = { title: "Inventar-Einstellungen — Gremio" };

export default async function InventoryBoardSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { board } = await requireInventoryBoardManage(Number(id));
  const [fields, numbering] = await Promise.all([
    getInventoryBoardFields(board.id),
    getInventoryNumbering(board.id),
  ]);
  const visible = new Set(
    fields.filter((f) => f.visible).map((f) => f.fieldKey),
  );

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link
          href={`/intern/inventar/${board.id}`}
          className="text-sm text-brand-600"
        >
          ← {board.name}
        </Link>
        <h1 className="text-2xl font-bold">Inventar-Einstellungen</h1>
      </div>

      {/* Allgemein */}
      <form action={renameInventoryBoardAction} className="card space-y-4 p-6">
        <h2 className="font-semibold">Allgemein</h2>
        <input type="hidden" name="boardId" value={board.id} />
        <div>
          <label htmlFor="b-name" className="label">
            Name
          </label>
          <input
            id="b-name"
            name="name"
            className="input"
            required
            defaultValue={board.name}
          />
        </div>
        <div>
          <label htmlFor="b-desc" className="label">
            Beschreibung
          </label>
          <textarea
            id="b-desc"
            name="description"
            className="input"
            rows={2}
            defaultValue={board.description ?? ""}
          />
        </div>
        <button type="submit" className="btn-primary">
          Speichern
        </button>
      </form>

      {/* Felder */}
      <form action={updateInventoryFieldsAction} className="card space-y-4 p-6">
        <div>
          <h2 className="font-semibold">Felder</h2>
          <p className="text-sm text-slate-500">
            Welche Felder bei den Gegenständen erscheinen. Die Bezeichnung ist
            immer sichtbar.
          </p>
        </div>
        <input type="hidden" name="boardId" value={board.id} />
        <div className="grid gap-2 sm:grid-cols-2">
          {INVENTORY_FIELD_KEYS.map((key) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2"
            >
              <input
                type="checkbox"
                name="visible"
                value={key}
                defaultChecked={visible.has(key)}
                className="h-4 w-4"
              />
              <span className="text-sm">
                {INVENTORY_FIELD_LABELS[key as InventoryFieldKey]}
              </span>
            </label>
          ))}
        </div>
        <button type="submit" className="btn-primary">
          Felder speichern
        </button>
      </form>

      {/* Inventarnummer */}
      <form
        action={updateInventoryNumberingAction}
        className="card space-y-4 p-6"
      >
        <div>
          <h2 className="font-semibold">Inventarnummer</h2>
          <p className="text-sm text-slate-500">
            Automatisch vergebene Nummer beim Anlegen eines Gegenstands. Format:
            Präfix + Zähler, dann Jahr und Kürzel (leere Teile werden
            übersprungen).
          </p>
        </div>
        <input type="hidden" name="boardId" value={board.id} />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={numbering?.enabled ?? false}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">
            Automatische Nummerierung aktiv
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            name="prefix"
            label="Präfix"
            defaultValue={numbering?.prefix ?? ""}
            placeholder="INV-"
          />
          <Field
            name="year"
            label="Jahr"
            defaultValue={numbering?.year ?? ""}
            placeholder="2026"
          />
          <Field
            name="code"
            label="Kürzel"
            defaultValue={numbering?.code ?? ""}
            placeholder="KOE"
          />
          <Field
            name="separator"
            label="Trennzeichen"
            defaultValue={numbering?.separator ?? "_"}
          />
          <Field
            name="padding"
            label="Stellen (Auffüllen)"
            type="number"
            defaultValue={String(numbering?.padding ?? 0)}
          />
          <Field
            name="next"
            label="Nächste Nummer"
            type="number"
            defaultValue={String(numbering?.next ?? 1)}
          />
        </div>
        <button type="submit" className="btn-primary">
          Nummerierung speichern
        </button>
      </form>

      {/* Löschen */}
      <div className="card space-y-3 border-red-200 p-6">
        <h2 className="font-semibold text-red-700">Gefahrenzone</h2>
        <p className="text-sm text-slate-500">
          Löscht das Inventar mit allen Gegenständen, Optionen und Einstellungen.
        </p>
        <DeleteInventoryBoardButton boardId={board.id} />
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={`num-${name}`}>
        {label}
      </label>
      <input
        id={`num-${name}`}
        name={name}
        type={type}
        className="input"
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </div>
  );
}
