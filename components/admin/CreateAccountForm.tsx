// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAccountAction, type State } from "@/app/admin/accounts/actions";

import { Select } from "@/components/Select";

export function CreateAccountForm({financeBoards=[]}:{financeBoards?:{id:number;name:string}[]}) {
  const [state, action, pending] = useActionState(
    createAccountAction,
    {} as State,
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);

  return (
    <form
      ref={ref}
      action={action}
      noValidate
      className="card flex flex-wrap items-end gap-2 p-4"
    >
      <div className="flex-1">
        <label className="label">Neues Konto</label>
        <input
          name="name"
          className="input"
          placeholder="Konto-Bezeichnung"
          required
        />
      </div>
      <div className="min-w-56 flex-1"><label className="label" htmlFor="new-account-finance">Finanzboard für Haushaltstitel</label><Select key={state.success} id="new-account-finance" portal searchable name="financeBoardId" disabled={pending} options={[{value:"",label:"Nicht zugeordnet"},...financeBoards.map(board=>({value:String(board.id),label:board.name}))]}/></div>
      <button type="submit" disabled={pending} className="btn-primary">
        {"Anlegen"}
      </button>
      {(state.error || state.success) && (
        <p
          className={`w-full text-sm ${
            state.error ? "text-red-600" : "text-green-600"
          }`}
        >
          {state.error ?? state.success}
        </p>
      )}
    </form>
  );
}
