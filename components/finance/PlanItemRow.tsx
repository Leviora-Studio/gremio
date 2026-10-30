// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useCallback, useRef, useState } from "react";
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
  const [saveStatus, setSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

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
    setSaveStatus("saving");
    setError("");
    let failed = false;
    try {
      const res = await editAction({}, new FormData(form));
      if (res?.error) {
        failed = true;
        dirty.current = true;
        setSaveStatus("error");
        setError(res.error);
      } else setSaveStatus(dirty.current ? "pending" : "saved");
      // Server recomputes Summen-Warnungen → Seite aktualisieren.
      if (!res?.error) router.refresh();
    } catch {
      failed = true;
      dirty.current = true;
      setSaveStatus("error");
      setError("Speichern fehlgeschlagen. Deine Eingabe bleibt erhalten.");
    } finally {
      saving.current = false;
      // Falls während des Speicherns weitere Änderungen kamen.
      if (dirty.current && !failed) void flush();
    }
  }, [editAction, router]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setSaveStatus("pending");
    setError("");
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
        <div className="w-full text-xs" aria-live="polite" role="status">
          {saveStatus === "idle" && <span className="text-slate-500">Automatisches Speichern aktiv</span>}
          {saveStatus === "pending" && <span className="text-slate-500">Änderungen werden automatisch gespeichert …</span>}
          {saveStatus === "saving" && <span className="text-slate-500">Wird gespeichert …</span>}
          {saveStatus === "saved" && <span className="text-green-700">✓ Automatisch gespeichert</span>}
          {saveStatus === "error" && <><span className="text-red-700">{error}</span> <button type="button" className="text-brand-700 underline" onClick={() => void flush()}>Erneut versuchen</button></>}
        </div>
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
