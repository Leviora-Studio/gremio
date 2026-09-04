// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { Modal } from "./Modal";

export function ConfirmDialog({ open, title, message, onConfirm, onClose, confirmLabel = "Verwerfen", disabled = false }: { open: boolean; title: string; message: string; onConfirm: () => void; onClose: () => void; confirmLabel?: string; disabled?: boolean }) {
  return <Modal portal manageFocus open={open} title={title} onClose={onClose}>
    <p className="text-sm text-slate-600">{message}</p>
    <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button><button type="button" className="btn-danger" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button></div>
  </Modal>;
}
