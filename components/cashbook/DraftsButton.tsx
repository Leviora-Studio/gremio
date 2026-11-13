// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCents } from "@/lib/money";

export function DraftsButton({ drafts }: {
  drafts: { id: number; number: string; amount: number; budgetTitle: string }[];
}) {
  const [open, setOpen] = useState(false);

  return <>
    <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
      Entwürfe <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{drafts.length}</span>
    </button>
    <Modal portal manageFocus open={open} onClose={() => setOpen(false)} title={`Entwürfe (${drafts.length})`}>
      <div className="space-y-3">
        {drafts.length ? drafts.map(draft => <Link
          key={draft.id}
          href={`/intern/kassenbuch/vorgang/${draft.id}`}
          tabIndex={0}
          onClick={() => setOpen(false)}
          className="block rounded-lg border border-slate-200 p-4 hover:border-brand-400 hover:bg-brand-50"
        >
          <strong>{draft.number}</strong>
          <span className="mt-1 block text-sm text-slate-600">{formatCents(draft.amount)} · HT {draft.budgetTitle}</span>
        </Link>) : <p className="text-sm text-slate-500">Keine Entwürfe vorhanden.</p>}
      </div>
    </Modal>
  </>;
}
