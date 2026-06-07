// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { requireAdmin } from "@/lib/auth";
import { getAccounts } from "@/lib/accounts";
import { CreateAccountForm } from "@/components/admin/CreateAccountForm";
import { AccountRow } from "@/components/admin/AccountRow";

export default async function AccountsPage() {
  await requireAdmin();
  const items = await getAccounts();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Konten</h2>
        <p className="text-sm text-slate-500">
          Auswahloptionen für das Kartenfeld „Konto". Diese erscheinen auf den
          Karten als Auswahlfeld (sofern das Feld am Board aktiviert ist).
        </p>
      </div>

      <CreateAccountForm />

      {items.length === 0 && (
        <p className="text-sm text-slate-500">Noch keine Konten angelegt.</p>
      )}
      {items.map((a) => (
        <AccountRow key={a.id} account={a} />
      ))}
    </div>
  );
}
