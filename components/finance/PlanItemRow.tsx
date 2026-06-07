// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { DeleteConfirm } from "@/components/DeleteConfirm";

type State = { error?: string; success?: string };

export function PlanItemRow({
  item,
  child = false,
  editAction,
  deleteAction,
}: {
  item: {
    id: number;
    haushaltstitel: string;
    title: string;
    plannedAmount: string;
  };
  child?: boolean;
  editAction: (prev: State, formData: FormData) => Promise<State>;
  deleteAction: () => Promise<void>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const errRef = useRef<HTMLSpanElement>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current || saving.current) return;
    const form = formRef.current;
    if (!form) return;
    saving.current = true;
    dirty.current = false;
    try {
      const res = await editAction({}, new FormData(form));
      if (errRef.current) errRef.current.textContent = res?.error ?? "";
      // Server recomputes Summen-Warnungen → Seite aktualisieren.
      if (!res?.error) router.refresh();
    } finally {
      saving.current = false;
      // Falls während des Speicherns weitere Änderungen kamen.
      if (dirty.current) void flush();
    }
  }, [editAction, router]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  return (
    <div className={`flex flex-wrap items-end gap-2 ${child ? "ml-6" : ""}`}>
      <form
        ref={formRef}
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-1 flex-wrap items-end gap-2"
      >
        <div className="w-28">
          <label className="label">Haushaltstitel</label>
          <input
            name="haushaltstitel"
            defaultValue={item.haushaltstitel}
            className="input"
            onChange={schedule}
            onBlur={() => void flush()}
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="label">Bezeichnung</label>
          <input
            name="title"
            defaultValue={item.title}
            className="input"
            onChange={schedule}
            onBlur={() => void flush()}
          />
        </div>
        <div className="w-32">
          <label className="label">Betrag (€)</label>
          <input
            name="plannedAmount"
            defaultValue={item.plannedAmount}
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            onChange={schedule}
            onBlur={() => void flush()}
          />
        </div>
        <span ref={errRef} className="text-sm text-red-600" />
      </form>
      <DeleteConfirm
        action={deleteAction}
        requireWord={false}
        compact
        buttonLabel="✕"
        buttonClassName="btn-danger btn-sm"
        title="Position löschen"
        message="Die Position wird aus dem Haushaltsplan entfernt."
      />
    </div>
  );
}
