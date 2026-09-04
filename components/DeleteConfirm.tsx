// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";

/**
 * Zweistufige In-App-Löschbestätigung (kein Browser-Dialog):
 * 1) das Wort (Standard "LÖSCHEN") eintippen → Button wird aktiv
 * 2) nach Klick ein Modal, das mit „OK, löschen" final bestätigt werden muss.
 * Mit `wordInModal` erfolgt auch die Worteingabe erst im Modal.
 * `action` ist eine bereits gebundene Server-Action (gibt optional {error} zurück).
 */
export function DeleteConfirm({
  action,
  word = "LÖSCHEN",
  buttonLabel = "Löschen",
  title,
  message,
  compact = false,
  requireWord = true,
  wordInModal = false,
  disabled = false,
  buttonClassName = "btn-danger",
}: {
  action: () => Promise<{ error?: string } | void>;
  word?: string;
  buttonLabel?: string;
  title: string;
  message?: string;
  /** Einzeilig ohne Label (z.B. in Listen-Zeilen) — gleiche Höhe wie Nachbarn. */
  compact?: boolean;
  /** false = ohne Worteingabe, nur Modal-Bestätigung. */
  requireWord?: boolean;
  /** Worteingabe im Bestätigungsdialog statt neben dem auslösenden Button. */
  wordInModal?: boolean;
  /** Keep the confirmation mounted while another operation temporarily blocks it. */
  disabled?: boolean;
  buttonClassName?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const armed = !requireWord || text.trim().toUpperCase() === word.toUpperCase();

  return (
    <div className="flex flex-wrap items-end gap-2">
      {requireWord && !wordInModal &&
        (compact ? (
          <input
            className="input w-44"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`${word} eingeben`}
          />
        ) : (
          <div>
            <label className="label">Zum Löschen „{word}" eingeben</label>
            <input
              className="input w-48"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={word}
            />
          </div>
        ))}
      <button
        type="button"
        disabled={disabled || pending || (!wordInModal && !armed)}
        onClick={() => {
          setError(null);
          if (wordInModal) setText("");
          setOpen(true);
        }}
        className={buttonClassName}
      >
        {buttonLabel}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <p className="text-sm text-slate-600">
          {message ?? "Diese Aktion kann nicht rückgängig gemacht werden."}
        </p>
        {requireWord && wordInModal && (
          <label className="mt-4 block">
            <span className="label">Zum Löschen „{word}" eingeben</span>
            <input
              className="input w-full"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={word}
              autoComplete="off"
              disabled={pending}
            />
          </label>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
            disabled={disabled || pending || !armed}
            onClick={() =>
              startTransition(async () => {
                const r = await action();
                if (r && "error" in r && r.error) {
                  setError(r.error);
                } else {
                  setOpen(false);
                }
              })
            }
            className="btn-danger"
          >
            OK, löschen
          </button>
        </div>
      </Modal>
    </div>
  );
}
