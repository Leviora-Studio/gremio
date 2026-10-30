// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";

/** Require confirmation on every visit, including direct links to the editor. */
export function FinancePlanConfirmation({ boardId, children }: { boardId: number; children: ReactNode }) {
  const [confirmed, setConfirmed] = useState(false);
  const router = useRouter();
  const cancel = () => router.replace(`/finanzen/${boardId}`);
  return <>
    <Modal open={!confirmed} onClose={cancel} title="Haushaltsplan bearbeiten?" manageFocus>
      <p className="text-sm text-slate-600">Möchtest du den Haushaltsplan bearbeiten? Änderungen werden automatisch gespeichert und sind anschließend für alle Berechtigten sichtbar.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={cancel}>Abbrechen</button>
        <button type="button" className="btn-primary" onClick={() => setConfirmed(true)}>Ja, bearbeiten</button>
      </div>
    </Modal>
    {confirmed && children}
  </>;
}
