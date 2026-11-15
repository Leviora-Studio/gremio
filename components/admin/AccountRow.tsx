// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import { Select } from "@/components/Select";
import { assignAccountFinanceBoardAction, type State } from "@/app/admin/accounts/actions";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { RenameWithConfirm } from "@/components/admin/RenameWithConfirm";
import {
  deleteAccountAction,
  renameAccountAction,
} from "@/app/admin/accounts/actions";

export function AccountRow({
  account, financeBoards,
}: {
  account: { id: number; name: string; financeBoardId?:number|null };
  financeBoards:{id:number;name:string}[];
}) {
  const [state, action, pending] = useActionState(assignAccountFinanceBoardAction.bind(null,account.id),{} as State);
  return (
    <div className="card flex flex-wrap items-center justify-between gap-2 p-4">
      <div className="w-full min-w-0 sm:w-auto"><RenameWithConfirm
        inputClassName="input min-w-0 w-full sm:w-64"
        currentName={account.name}
        action={renameAccountAction.bind(null, account.id)}
        entityLabel="Konto"
      /></div>
      <form action={action} className="flex w-full min-w-0 flex-wrap items-end gap-2 sm:w-auto">
        <div className="min-w-56 flex-1"><label className="label" htmlFor={`account-finance-${account.id}`}>Finanzboard für Haushaltstitel</label><Select key={String(account.financeBoardId)} id={`account-finance-${account.id}`} ariaLabel={`Finanzboard für Konto ${account.name}`} name="financeBoardId" portal searchable disabled={pending} defaultValue={account.financeBoardId ? String(account.financeBoardId) : ""} options={[{value:"",label:"Nicht zugeordnet"},...financeBoards.map(board=>({value:String(board.id),label:board.name}))]}/></div>
        <button className="btn-secondary" disabled={pending}>Zuordnung speichern</button>
        {(state.error||state.success)&&<p role={state.error?"alert":"status"} className={`w-full text-sm ${state.error?"text-red-700":"text-slate-600"}`}>{state.error??state.success}</p>}
      </form>
      <DeleteConfirm
        action={deleteAccountAction.bind(null, account.id)}
        compact
        buttonLabel="Löschen"
        buttonClassName="btn-danger btn-sm"
        title={`Konto „${account.name}" löschen`}
        message="Das Konto wird gelöscht; bei betroffenen Karten wird das Konto-Feld geleert."
      />
    </div>
  );
}
