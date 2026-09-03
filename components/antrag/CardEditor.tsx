// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import type { PriorityOption } from "@/lib/priorities";
import type { AccountOption } from "@/lib/accounts";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";
import { AutoTextarea } from "@/components/AutoTextarea";
import { UserTypeahead } from "./UserTypeahead";
import { UserMultiTypeahead } from "./UserMultiTypeahead";
import {
  saveCardAction,
  type CardValues,
} from "@/app/intern/card/[id]/actions";

type U = {
  id: number;
  username: string;
  name?: string | null;
  avatarPath?: string | null;
};
type Status = "idle" | "saving" | "saved" | "error";

export function CardEditor({
  cardId,
  boardId,
  visible,
  initial,
  creator,
  assignees,
  priorities,
  accounts,
  // Feedback-Karten nennen das Feld „Einreicher"; alle anderen bleiben bei
  // „Antragsteller". Nur die Beschriftung — Spalte und API-Feld heißen
  // weiterhin `applicant`.
  applicantLabel = "Antragsteller",
}: {
  cardId: number;
  boardId: number;
  visible: string[];
  initial: {
    title: string;
    applicant: string;
    budgetTitle: string | null;
    number: string | null;
    deadline: string | null;
    meeting: string | null;
    decisionRef: string | null;
    instructionDate: string | null;
    transferDate: string | null;
    requestedAmount: string | null;
    approvedAmount: string | null;
    actualAmount: string | null;
    priorityId: number | null;
    accountId: number | null;
    notes: string | null;
    applicantNote: string | null;
  };
  creator: U | null;
  assignees: U[];
  priorities: PriorityOption[];
  accounts: AccountOption[];
  applicantLabel?: string;
}) {
  const valuesRef = useRef<CardValues>({
    title: initial.title,
    applicant: initial.applicant,
    budgetTitle: initial.budgetTitle,
    number: initial.number,
    creatorUserId: creator?.id ?? null,
    assigneeUserIds: assignees.map((a) => a.id),
    deadline: initial.deadline,
    meeting: initial.meeting,
    decisionRef: initial.decisionRef,
    instructionDate: initial.instructionDate,
    transferDate: initial.transferDate,
    requestedAmount: initial.requestedAmount,
    approvedAmount: initial.approvedAmount,
    actualAmount: initial.actualAmount,
    priorityId: initial.priorityId ?? null,
    accountId: initial.accountId,
    notes: initial.notes,
    applicantNote: initial.applicantNote,
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nur tatsächlich geänderte Felder werden gespeichert (partieller Patch).
  // Sonst würde jeder Speichervorgang den kompletten (evtl. veralteten)
  // Snapshot zurückschreiben und z. B. ein zwischenzeitlich automatisch
  // gesetztes Anweisungsdatum wieder auf null überschreiben.
  const dirty = useRef<Set<keyof CardValues>>(new Set());

  function doSave() {
    const keys = [...dirty.current];
    if (keys.length === 0) {
      setStatus((s) => (s === "saving" ? "saved" : s));
      return;
    }
    const patch: Partial<CardValues> = {};
    for (const k of keys) {
      (patch as Record<string, unknown>)[k] = valuesRef.current[k];
    }
    setStatus("saving");
    saveCardAction(cardId, patch)
      .then((r) => {
        if (r.ok) {
          // Nur die gesendeten Keys als „sauber" markieren — während des
          // Requests geänderte Felder bleiben dirty und werden nachgespeichert.
          for (const k of keys) dirty.current.delete(k);
          if (dirty.current.size) schedule();
          else setStatus("saved");
        } else {
          setStatus("error");
          setErrorMsg(r.error ?? "Fehler beim Speichern.");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("Netzwerkfehler.");
      });
  }

  function flushNow() {
    if (timer.current) clearTimeout(timer.current);
    doSave();
  }

  function schedule() {
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(doSave, 700);
  }

  function update(patch: Partial<CardValues>, immediate = false) {
    valuesRef.current = { ...valuesRef.current, ...patch };
    for (const k of Object.keys(patch)) {
      dirty.current.add(k as keyof CardValues);
    }
    if (immediate) flushNow();
    else schedule();
  }

  // Pro Feld eine Zelle; die Reihenfolge ergibt sich aus `visible`
  // (vom Board-Eigentümer einstellbar). Jeweils zwei nebeneinander,
  // auf kleinen Screens einspaltig.
  const fieldNodes: Record<string, ReactNode> = {
    number: (
      <div>
        <label className="label">Antragsnummer</label>
        <input
          defaultValue={valuesRef.current.number ?? ""}
          className="input"
          placeholder="automatisch"
          onChange={(e) => update({ number: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    applicant: (
      <div>
        <label className="label">{applicantLabel}</label>
        <input
          defaultValue={valuesRef.current.applicant}
          className="input"
          onChange={(e) => update({ applicant: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    budget_title: (
      <div>
        <label className="label">Haushaltstitel</label>
        <input
          defaultValue={valuesRef.current.budgetTitle ?? ""}
          className="input"
          onChange={(e) => update({ budgetTitle: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    requested_amount: (
      <div>
        <label className="label">Beantragter Betrag (€)</label>
        <input
          defaultValue={valuesRef.current.requestedAmount ?? ""}
          className="input"
          inputMode="decimal"
          placeholder="0,00"
          onChange={(e) => update({ requestedAmount: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    approved_amount: (
      <div>
        <label className="label">Genehmigter Betrag (€)</label>
        <input
          defaultValue={valuesRef.current.approvedAmount ?? ""}
          className="input"
          inputMode="decimal"
          placeholder="0,00"
          onChange={(e) => update({ approvedAmount: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    actual_amount: (
      <div>
        <label className="label">Tatsächliche Ausgaben (€)</label>
        <input
          defaultValue={valuesRef.current.actualAmount ?? ""}
          className="input"
          inputMode="decimal"
          placeholder="0,00"
          onChange={(e) => update({ actualAmount: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    instruction_date: (
      <div>
        <label className="label">Anweisungsdatum</label>
        <DatePicker
          defaultValue={valuesRef.current.instructionDate ?? ""}
          onChange={(v) => update({ instructionDate: v || null }, true)}
        />
      </div>
    ),
    transfer_date: (
      <div>
        <label className="label">Überweisungsdatum</label>
        <DatePicker
          defaultValue={valuesRef.current.transferDate ?? ""}
          onChange={(v) => update({ transferDate: v || null }, true)}
        />
      </div>
    ),
    creator: (
      <div>
        <label className="label">Ersteller</label>
        <UserTypeahead
          boardId={boardId}
          initial={creator}
          onChange={(u) => update({ creatorUserId: u?.id ?? null }, true)}
        />
      </div>
    ),
    assignee: (
      <div>
        <label className="label">Zugewiesen zu</label>
        <UserMultiTypeahead
          boardId={boardId}
          initial={assignees}
          onChange={(us) => update({ assigneeUserIds: us.map((u) => u.id) }, true)}
        />
      </div>
    ),
    deadline: (
      <div>
        <label className="label">Deadline</label>
        <DatePicker
          defaultValue={valuesRef.current.deadline ?? ""}
          onChange={(v) => update({ deadline: v || null }, true)}
        />
      </div>
    ),
    meeting: (
      <div>
        <label className="label">Sitzung</label>
        <DatePicker
          defaultValue={valuesRef.current.meeting ?? ""}
          onChange={(v) => update({ meeting: v || null }, true)}
        />
      </div>
    ),
    decision_ref: (
      <div>
        <label className="label">Beschlussreferenz</label>
        <input
          defaultValue={valuesRef.current.decisionRef ?? ""}
          className="input"
          onChange={(e) => update({ decisionRef: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    priority: (
      <div>
        <label className="label">Priorität</label>
        <Select
          defaultValue={
            valuesRef.current.priorityId != null
              ? String(valuesRef.current.priorityId)
              : ""
          }
          onChange={(v) => update({ priorityId: v ? Number(v) : null }, true)}
          options={[
            { value: "", label: "—" },
            ...priorities.map((p) => ({ value: String(p.id), label: p.label })),
          ]}
        />
      </div>
    ),
    account: (
      <div>
        <label className="label">Konto</label>
        <Select
          defaultValue={
            valuesRef.current.accountId
              ? String(valuesRef.current.accountId)
              : ""
          }
          onChange={(v) => update({ accountId: v ? Number(v) : null }, true)}
          options={[
            { value: "", label: "—" },
            ...accounts.map((a) => ({ value: String(a.id), label: a.name })),
          ]}
        />
      </div>
    ),
    notes: (
      <div className="sm:col-span-2">
        <label className="label">Notizen</label>
        <AutoTextarea
          defaultValue={valuesRef.current.notes ?? ""}
          onChange={(e) => update({ notes: e.target.value })}
          onBlur={flushNow}
        />
      </div>
    ),
    applicant_note: (
      <div className="sm:col-span-2">
        <label className="label">Hinweis für Antragsteller</label>
        <AutoTextarea
          defaultValue={valuesRef.current.applicantNote ?? ""}
          onChange={(e) => update({ applicantNote: e.target.value })}
          onBlur={flushNow}
        />
        <p className="mt-1 text-xs text-amber-700">
          ⚠ Dieser Text ist über den Status-Link öffentlich für den
          Antragsteller sichtbar.
        </p>
      </div>
    ),
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="relative sm:col-span-2">
        {/* Auto-Speichern-Status in der Ecke — verbraucht keine eigene Zeile,
            damit die Felder direkt unter der Überschrift beginnen. */}
        <div className="absolute right-0 top-0 z-10">
          <SaveIndicator status={status} errorMsg={errorMsg} />
        </div>
        <label className="label">Titel *</label>
        <input
          defaultValue={valuesRef.current.title}
          className="input"
          placeholder="Titel der Karte"
          onChange={(e) => update({ title: e.target.value })}
          onBlur={flushNow}
        />
      </div>
      {visible.map((k) =>
        fieldNodes[k] ? <Fragment key={k}>{fieldNodes[k]}</Fragment> : null,
      )}
    </div>
  );
}

function SaveIndicator({
  status,
  errorMsg,
}: {
  status: Status;
  errorMsg: string;
}) {
  if (status === "saving")
    return <span className="text-xs text-slate-400">Speichert…</span>;
  if (status === "saved")
    return <span className="text-xs text-green-600">Gespeichert ✓</span>;
  if (status === "error")
    return <span className="text-xs text-red-600">{errorMsg}</span>;
  return <span className="text-xs text-slate-300">Automatisches Speichern</span>;
}
