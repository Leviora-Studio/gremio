// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";

type State = { error?: string; success?: string };

/**
 * Umbenennen mit In-App-Bestätigung (Modal) + grüner Erfolgsmeldung darunter.
 * `action` ist die bereits an die ID gebundene Server-Action
 * (prev, formData) => State; das neue Feld heißt „name".
 */
export function RenameWithConfirm({
  currentName,
  action,
  entityLabel,
  inputClassName = "input w-64",
}: {
  currentName: string;
  action: (prev: State, formData: FormData) => Promise<State>;
  entityLabel: string;
  inputClassName?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [open, setOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== currentName;

  const confirm = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", trimmed);
      const r = await action({}, fd);
      if (r?.error) {
        setModalError(r.error);
      } else {
        setOpen(false);
        setSuccess(r?.success ?? "Gespeichert.");
        router.refresh();
      }
    });

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          className={inputClassName}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSuccess(null);
          }}
        />
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={!changed}
          onClick={() => {
            setModalError(null);
            setOpen(true);
          }}
        >
          Umbenennen
        </button>
      </div>
      {success && <p className="mt-1 text-sm text-green-600">{success}</p>}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${entityLabel} umbenennen`}
      >
        <p className="text-sm text-slate-600">
          „{currentName}" in „{trimmed}" umbenennen?
        </p>
        {modalError && <p className="mt-3 text-sm text-red-600">{modalError}</p>}
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
            disabled={pending}
            onClick={confirm}
            className="btn-primary"
          >
            Umbenennen
          </button>
        </div>
      </Modal>
    </div>
  );
}
