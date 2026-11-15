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
  confirmName,
  recycleBin = true,
  recycleBinMessage,
}: {
  action: (confirmation?: string, confirmedName?: string) => Promise<{ error?: string } | void>;
  /** Optional second-stage name confirmation, checked again by the server. */
  confirmName?: string;
  /** Typed confirmations can also protect immediate deletions. */
  recycleBin?: boolean;
  recycleBinMessage?:string;
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
  const [name, setName] = useState("");
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
          setName("");
          if (wordInModal) setText("");
          setOpen(true);
        }}
        className={buttonClassName}
      >
        {buttonLabel}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <p className="text-sm text-slate-600">
          {requireWord && recycleBin ? recycleBinMessage ?? "Dieser Eintrag wird mit seinen zugehörigen Inhalten und Dateien für 30 Tage in den Papierkorb verschoben. Nur Admins können ihn dort wiederherstellen oder sofort endgültig löschen. Nach Ablauf der Frist erfolgt die endgültige Löschung automatisch bei der täglichen Bereinigung." : message ?? "Diese Aktion kann nicht rückgängig gemacht werden."}
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
        {confirmName !== undefined && <label className="mt-4 block">
          <span className="label">Gib zusätzlich den vollständigen Namen ein: <strong className="break-words">{confirmName}</strong></span>
          <input className="input mt-2 w-full" aria-label="Name zur Bestätigung" placeholder="Vollständiger Name" value={name} onChange={event => setName(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={pending}/>
        </label>}
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
            disabled={disabled || pending || !armed || (confirmName !== undefined && name !== confirmName)}
            onClick={() =>
              startTransition(async () => {
                const r = confirmName !== undefined ? await action(requireWord ? text : undefined, name) : requireWord ? await action(text) : await action();
                if (r && "error" in r && r.error) {
                  setError(r.error);
                } else {
                  setOpen(false);
                }
              })
            }
            className="btn-danger"
          >
            {confirmName !== undefined ? "Löschen" : "OK, löschen"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
