// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";

/**
 * Eigentumsübertragung mit In-App-Bestätigung (Popup, das den neuen
 * Eigentümer namentlich nennt). Für Board- und Finanzboard-Admin.
 */
export function TransferOwnerForm({
  action,
  options,
  currentOwnerId,
  entityLabel,
  requireTyped,
}: {
  action: (formData: FormData) => Promise<void>;
  options: { value: string; label: string }[];
  currentOwnerId: string;
  entityLabel: string;
  /** Wenn gesetzt: dieses Wort muss eingetippt werden, um den Button freizuschalten. */
  requireTyped?: string;
}) {
  const [ownerId, setOwnerId] = useState(currentOwnerId);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectedLabel = options.find((o) => o.value === ownerId)?.label ?? "?";
  const unlocked = !requireTyped || typed.trim() === requireTyped;

  const confirm = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("ownerId", ownerId);
      await action(fd);
      setOpen(false);
      setTyped("");
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-48"
          value={ownerId}
          onChange={setOwnerId}
          options={options}
          searchable
          searchPlaceholder="Nutzer suchen…"
        />
        {requireTyped && (
          <input
            className="input w-44"
            placeholder={`${requireTyped} eingeben`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label={`Zum Freischalten ${requireTyped} eingeben`}
          />
        )}
        <button
          type="button"
          disabled={!unlocked}
          onClick={() => setOpen(true)}
          className="btn-secondary px-3 py-1.5"
        >
          Eigentum übertragen
        </button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Eigentum übertragen?"
      >
        <p className="text-sm text-slate-600">
          {entityLabel} an <strong>{selectedLabel}</strong> übertragen? Der neue
          Eigentümer darf es verwalten (umbenennen, Freigaben, löschen).
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn-secondary"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="btn-primary"
          >
            Übertragen
          </button>
        </div>
      </Modal>
    </>
  );
}
