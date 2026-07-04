// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Select } from "@/components/Select";
import {
  addInventoryOptionAction,
  createInventoryItemAction,
  deleteInventoryItemAction,
  updateInventoryItemAction,
  type ItemActionState,
} from "@/app/intern/inventar/[id]/item-actions";
import type { InventoryItemView } from "@/lib/inventory-items";

export type Opt = { id: number; name: string };
export type GroupedOpts = {
  category: Opt[];
  location: Opt[];
  loan_status: Opt[];
};
type OptionKind = keyof GroupedOpts;

function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function ItemFormModal({
  boardId,
  item,
  visibleFields,
  options,
  groupNames,
  numberingEnabled,
  onClose,
  onSaved,
  onOptionAdded,
}: {
  boardId: number;
  item: InventoryItemView | null;
  visibleFields: string[];
  options: GroupedOpts;
  groupNames: string[];
  numberingEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
  onOptionAdded: (kind: OptionKind, opt: Opt) => void;
}) {
  const isEdit = !!item;
  const [state, formAction, pending] = useActionState(
    isEdit ? updateInventoryItemAction : createInventoryItemAction,
    {} as ItemActionState,
  );
  const [delState, delAction, delPending] = useActionState(
    deleteInventoryItemAction,
    {} as ItemActionState,
  );

  const [locationId, setLocationId] = useState<number | null>(
    item?.locationId ?? null,
  );
  const [lendable, setLendable] = useState<boolean>(item?.lendable ?? true);
  const [categoryIds, setCategoryIds] = useState<number[]>(
    item?.categoryIds ?? [],
  );
  const [groupName, setGroupName] = useState<string | null>(
    item?.groupName ?? null,
  );
  // Vorhandene Gruppennamen + ggf. der aktuelle (falls noch nicht in der Liste).
  const [groupOptions, setGroupOptions] = useState<string[]>(() => {
    const set = new Set(groupNames);
    if (item?.groupName) set.add(item.groupName);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (state.ok || delState.ok) onSaved();
  }, [state.ok, delState.ok, onSaved]);

  const show = (k: string) => visibleFields.includes(k);

  async function addOption(kind: OptionKind, name: string) {
    const res = await addInventoryOptionAction({ boardId, kind, name });
    if ("error" in res) return res.error;
    onOptionAdded(kind, { id: res.id, name: res.name });
    if (kind === "category") setCategoryIds((ids) => [...ids, res.id]);
    if (kind === "location") setLocationId(res.id);
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card w-full max-w-xl space-y-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isEdit ? "Gegenstand bearbeiten" : "Neuer Gegenstand"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <form action={formAction} noValidate className="space-y-4">
          {isEdit ? (
            <input type="hidden" name="itemId" value={item.id} />
          ) : (
            <input type="hidden" name="boardId" value={boardId} />
          )}

          {/* Bezeichnung — immer sichtbar, Pflicht */}
          <div>
            <label htmlFor="it-name" className="label">
              Bezeichnung
            </label>
            <input
              id="it-name"
              name="name"
              className="input"
              required
              autoFocus
              defaultValue={item?.name ?? ""}
              placeholder="z. B. Bierzeltgarnitur"
            />
          </div>

          {show("group") && (
            <GroupSelect
              options={groupOptions}
              value={groupName}
              onChange={setGroupName}
              onAdd={(name) => {
                setGroupOptions((prev) =>
                  prev.includes(name)
                    ? prev
                    : [...prev, name].sort((a, b) => a.localeCompare(b, "de")),
                );
                setGroupName(name);
              }}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {show("number") && (
              <div>
                <label htmlFor="it-number" className="label">
                  Inventarnummer
                </label>
                <input
                  id="it-number"
                  name="number"
                  className="input"
                  defaultValue={item?.number ?? ""}
                  placeholder={
                    numberingEnabled && !isEdit
                      ? "wird automatisch vergeben"
                      : "frei vergeben"
                  }
                />
              </div>
            )}
            {show("serial_number") && (
              <div>
                <label htmlFor="it-serial" className="label">
                  Seriennummer (nur intern)
                </label>
                <input
                  id="it-serial"
                  name="serialNumber"
                  className="input"
                  defaultValue={item?.serialNumber ?? ""}
                />
              </div>
            )}
          </div>

          {show("category") && (
            <CategorySelect
              label="Kategorie"
              options={options.category}
              selected={categoryIds}
              onToggle={(id) =>
                setCategoryIds((ids) =>
                  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
                )
              }
              onAdd={(name) => addOption("category", name)}
            />
          )}

          {show("location") && (
            <SingleSelect
              label="Standort"
              options={options.location}
              value={locationId}
              onChange={setLocationId}
              onAdd={(name) => addOption("location", name)}
            />
          )}

          {show("condition") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Zustand (intern)</label>
                <Select
                  name="condition"
                  defaultValue={item?.condition ?? "active"}
                  options={[
                    { value: "active", label: "Aktiv" },
                    { value: "defect", label: "Defekt" },
                    { value: "lost", label: "Verloren gegangen" },
                  ]}
                />
              </div>
              <div>
                <label htmlFor="it-condnote" className="label">
                  Notiz zum Zustand
                </label>
                <input
                  id="it-condnote"
                  name="conditionNote"
                  className="input"
                  defaultValue={item?.conditionNote ?? ""}
                  placeholder="z. B. Bein gebrochen, Sommerfest 2026"
                />
              </div>
            </div>
          )}

          {show("lendable") && (
            <div>
              <span className="label">Entleihbar</span>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={lendable}
                  onChange={(e) => setLendable(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-slate-700">
                  Gegenstand ist entleihbar (sonst öffentlich nicht sichtbar)
                </span>
              </label>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            {show("price") && (
              <div>
                <label htmlFor="it-price" className="label">
                  Kaufpreis (€)
                </label>
                <input
                  id="it-price"
                  name="price"
                  inputMode="decimal"
                  className="input"
                  defaultValue={centsToInput(item?.price)}
                  placeholder="0,00"
                />
              </div>
            )}
            {show("purchase_date") && (
              <div>
                <label htmlFor="it-pdate" className="label">
                  Kaufdatum
                </label>
                <input
                  id="it-pdate"
                  name="purchaseDate"
                  type="date"
                  className="input"
                  defaultValue={item?.purchaseDate ?? ""}
                />
              </div>
            )}
            {show("vendor") && (
              <div>
                <label htmlFor="it-vendor" className="label">
                  Händler
                </label>
                <input
                  id="it-vendor"
                  name="vendor"
                  className="input"
                  defaultValue={item?.vendor ?? ""}
                />
              </div>
            )}
          </div>

          {show("notes") && (
            <div>
              <label htmlFor="it-notes" className="label">
                Notizen
              </label>
              <textarea
                id="it-notes"
                name="notes"
                rows={2}
                className="input"
                defaultValue={item?.notes ?? ""}
              />
            </div>
          )}

          {/* Kaufbelege direkt beim Anlegen (nur im Erstellen-Modus). */}
          {!isEdit && (
            <div>
              <label htmlFor="it-receipts" className="label">
                Kaufbelege (optional, mehrere möglich)
              </label>
              <input
                id="it-receipts"
                type="file"
                name="receiptFiles"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-50"
              />
            </div>
          )}

          {/* versteckte Felder für die Custom-Selects */}
          {show("group") && (
            <input type="hidden" name="groupName" value={groupName ?? ""} />
          )}
          {show("location") && (
            <input type="hidden" name="locationId" value={locationId ?? ""} />
          )}
          {show("lendable") && (
            <input type="hidden" name="lendable" value={lendable ? "1" : "0"} />
          )}
          {show("category") &&
            categoryIds.map((id) => (
              <input key={id} type="hidden" name="categoryIds" value={id} />
            ))}

          {(state.error || delState.error) && (
            <p className="text-sm text-red-600">
              {state.error || delState.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {isEdit &&
                (confirmDelete ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="submit"
                      formAction={delAction}
                      name="itemId"
                      value={item.id}
                      disabled={delPending}
                      className="btn-secondary text-red-600"
                    >
                      Wirklich löschen
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-sm text-slate-500"
                    >
                      Abbrechen
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-sm font-medium text-red-600"
                  >
                    Löschen
                  </button>
                ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary"
              >
                Abbrechen
              </button>
              <button type="submit" disabled={pending} className="btn-primary">
                {isEdit ? "Speichern" : "Anlegen"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Suchbare Einfachauswahl für „Artikel/Gruppe" (wie Standort), Werte sind
 *  Strings; neue Gruppen werden lokal ergänzt (erst beim Speichern persistiert). */
function GroupSelect({
  options,
  value,
  onChange,
  onAdd,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  onAdd: (name: string) => void;
}) {
  return (
    <div>
      <label className="label">Artikel/Gruppe</label>
      <Select
        placeholder="— keine —"
        searchable
        value={value ?? ""}
        onChange={(v) => onChange(v || null)}
        options={[
          { value: "", label: "— keine —" },
          ...options.map((g) => ({ value: g, label: g })),
        ]}
      />
      <AddOption
        placeholder="Neue Gruppe …"
        onAdd={async (name) => {
          onAdd(name);
          return null;
        }}
      />
      <p className="mt-1 text-xs text-slate-500">
        Gleiche Gruppe = ein Sammel-Posten. Öffentlich erscheint nur die
        Stückzahl; jedes Stück behält seine eigene Inventarnummer.
      </p>
    </div>
  );
}

function SingleSelect({
  label,
  options,
  value,
  onChange,
  onAdd,
}: {
  label: string;
  options: Opt[];
  value: number | null;
  onChange: (v: number | null) => void;
  onAdd: (name: string) => Promise<string | null>;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <Select
        placeholder="— keine —"
        searchable
        value={value == null ? "" : String(value)}
        onChange={(v) => onChange(v ? Number(v) : null)}
        options={[
          { value: "", label: "— keine —" },
          ...options.map((o) => ({ value: String(o.id), label: o.name })),
        ]}
      />
      <AddOption placeholder={`Neuer ${label} …`} onAdd={onAdd} />
    </div>
  );
}

/** Suchbares Mehrfach-Select (Kategorie): Dropdown mit Suche + Chips über die
 *  gesamte Breite, plus „neu hinzufügen" darunter. */
function CategorySelect({
  label,
  options,
  selected,
  onToggle,
  onAdd,
}: {
  label: string;
  options: Opt[];
  selected: number[];
  onToggle: (id: number) => void;
  onAdd: (name: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options;
  const selectedOpts = options.filter((o) => selected.includes(o.id));

  return (
    <div>
      <label className="label">{label}</label>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-left text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <span className="flex flex-wrap gap-1">
            {selectedOpts.length ? (
              selectedOpts.map((o) => (
                <span
                  key={o.id}
                  className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700"
                >
                  {o.name}
                </span>
              ))
            ) : (
              <span className="text-slate-400">Kategorien wählen…</span>
            )}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path
              d="M5 7.5 10 12.5 15 7.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-200 bg-white text-sm shadow-lg">
            <div className="border-b border-slate-100 p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Suchen…"
                className="h-8 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <ul className="max-h-60 overflow-auto py-1">
              {visible.length === 0 ? (
                <li className="px-3 py-1.5 text-slate-400">Keine Treffer</li>
              ) : (
                visible.map((o) => {
                  const isSel = selected.includes(o.id);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => onToggle(o.id)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-brand-50 ${
                          isSel
                            ? "font-medium text-brand-700"
                            : "text-slate-700"
                        }`}
                      >
                        <span className="w-4 shrink-0">{isSel ? "✓" : ""}</span>
                        {o.name}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </div>
      <AddOption placeholder="Neue Kategorie …" onAdd={onAdd} />
    </div>
  );
}

function AddOption({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr(null);
    const error = await onAdd(trimmed);
    setBusy(false);
    if (error) setErr(error);
    else setName("");
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="input flex-1"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="btn-secondary shrink-0"
        >
          Hinzufügen
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
