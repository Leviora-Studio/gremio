// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Modal } from "@/components/Modal";

/**
 * Button, der eine Aktion erst nach Bestätigung im In-App-Modal ausführt
 * (kein Browser-Dialog). `action` ist eine bereits gebundene Server-Action.
 */
export function ConfirmButton({
  action,
  label,
  className,
  title,
  message,
  confirmLabel = "Bestätigen",
  confirmClassName = "btn-primary",
  requireTyped,
}: {
  action: () => Promise<{ error?: string } | void>;
  label: ReactNode;
  className?: string;
  title: string;
  message?: string;
  confirmLabel?: string;
  confirmClassName?: string;
  /** Wenn gesetzt: dieses Wort muss eingetippt werden, um zu bestätigen. */
  requireTyped?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const unlocked = !requireTyped || typed.trim() === requireTyped;

  const close = () => {
    setOpen(false);
    setTyped("");
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setError(null);
          setTyped("");
          setOpen(true);
        }}
      >
        {label}
      </button>

      <Modal open={open} onClose={close} title={title}>
        {message && <p className="text-sm text-slate-600">{message}</p>}
        {requireTyped && (
          <div className="mt-3">
            <label className="mb-1 block text-sm text-slate-600">
              Zum Bestätigen <strong>{requireTyped}</strong> eingeben:
            </label>
            <input
              className="input w-48"
              placeholder={`${requireTyped} eingeben`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={close} className="btn-secondary">
            Abbrechen
          </button>
          <button
            type="button"
            disabled={pending || !unlocked}
            className={confirmClassName}
            onClick={() =>
              startTransition(async () => {
                const r = await action();
                if (r && "error" in r && r.error) {
                  setError(r.error);
                } else {
                  close();
                }
              })
            }
          >
            {confirmLabel}
          </button>
        </div>
      </Modal>
    </>
  );
}
