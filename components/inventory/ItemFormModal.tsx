// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useState } from "react";
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
  numberingEnabled,
  onClose,
  onSaved,
  onOptionAdded,
}: {
  boardId: number;
  item: InventoryItemView | null;
  visibleFields: string[];
  options: GroupedOpts;
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

          {show("category") && (
            <ChipMultiSelect
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

          <div className="grid gap-4 sm:grid-cols-2">
            {show("location") && (
              <SingleSelect
                label="Standort"
                options={options.location}
                value={locationId}
                onChange={setLocationId}
                onAdd={(name) => addOption("location", name)}
              />
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
          </div>

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

          {/* versteckte Felder für die Custom-Selects */}
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
      <select
        className="input"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
      >
        <option value="">— keine —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <AddOption placeholder={`Neuer ${label} …`} onAdd={onAdd} />
    </div>
  );
}

function ChipMultiSelect({
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
  return (
    <div>
      <label className="label">{label}</label>
      {options.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {options.map((o) => {
            const active = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onToggle(o.id)}
                className={`rounded-full border px-2.5 py-1 text-sm transition ${
                  active
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {active ? "✓ " : ""}
                {o.name}
              </button>
            );
          })}
        </div>
      )}
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
    <div className="mt-1">
      <div className="flex gap-1.5">
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
          className="input h-8 py-1 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="btn-secondary h-8 px-2 py-1 text-sm"
        >
          +
        </button>
      </div>
      {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
    </div>
  );
}
