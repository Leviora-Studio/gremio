// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { DeleteConfirm } from "@/components/DeleteConfirm";
import { RenameWithConfirm } from "@/components/admin/RenameWithConfirm";
import {
  deleteAccountAction,
  renameAccountAction,
} from "@/app/admin/accounts/actions";

export function AccountRow({
  account,
}: {
  account: { id: number; name: string };
}) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-2 p-4">
      <RenameWithConfirm
        currentName={account.name}
        action={renameAccountAction.bind(null, account.id)}
        entityLabel="Konto"
      />
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
