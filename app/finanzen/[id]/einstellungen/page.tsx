// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts as accountsTable,
  financeBoardAccess,
  financeBoardAccounts,
  financeBoardExpenseAccounts,
  financePlanItems,
  groups,
  users,
} from "@/lib/db/schema";
import { requireFinanceManage, resolveSourceBoards } from "@/lib/finance";
import { getAccessibleBoards } from "@/lib/authz";
import { getAccounts } from "@/lib/accounts";
import { centsToInput, formatCents } from "@/lib/money";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { Avatar } from "@/components/Avatar";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { TransferOwnerForm } from "@/components/admin/TransferOwnerForm";
import { RenameFinanceForm } from "@/components/finance/RenameFinanceForm";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { PlanItemRow } from "@/components/finance/PlanItemRow";
import {
  addFinanceAccessGroupAction,
  addFinanceAccessUserAction,
  addFinanceAccountAction,
  addFinanceExpenseAccountAction,
  addFinanceSourceAction,
  addPlanItemAction,
  editPlanItemAction,
  deletePlanItemAction,
  deleteFinanceBoardAction,
  removeFinanceAccessAction,
  removeFinanceAccountAction,
  removeFinanceExpenseAccountAction,
  removeFinanceSourceAction,
  transferFinanceOwnerAction,
} from "../../actions";

export default async function FinanceSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fbId = Number(id);
  const { user, fb } = await requireFinanceManage(fbId);

  const accounts = await getAccounts();
  // Betroffene Konten (n:m) dieses Finanzboards.
  const selectedAccounts = await db
    .select({ id: accountsTable.id, name: accountsTable.name })
    .from(financeBoardAccounts)
    .innerJoin(accountsTable, eq(accountsTable.id, financeBoardAccounts.accountId))
    .where(eq(financeBoardAccounts.financeBoardId, fbId))
    .orderBy(accountsTable.name);
  const selectedAccountIds = new Set(selectedAccounts.map((a) => a.id));
  const availableAccounts = accounts.filter((a) => !selectedAccountIds.has(a.id));

  // Optionaler Konten-Override für die Ausgaben-Berechnung (Teilmenge der oberen).
  const expenseAccounts = await db
    .select({ id: accountsTable.id, name: accountsTable.name })
    .from(financeBoardExpenseAccounts)
    .innerJoin(
      accountsTable,
      eq(accountsTable.id, financeBoardExpenseAccounts.accountId),
    )
    .where(eq(financeBoardExpenseAccounts.financeBoardId, fbId))
    .orderBy(accountsTable.name);
  const expenseAccountIds = new Set(expenseAccounts.map((a) => a.id));
  // Auswählbar sind nur betroffene Konten, die noch nicht im Override stehen.
  const availableExpenseAccounts = selectedAccounts.filter(
    (a) => !expenseAccountIds.has(a.id),
  );

  const allGroups = await db.select().from(groups).orderBy(groups.name);
  const activeUsers = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.username);

  // Quell-Boards: Owner-Live-Zugriff bestimmt, was rot markiert wird.
  const { accessible, inaccessible } = await resolveSourceBoards(fb);
  const sourceList = [
    ...accessible.map((s) => ({ ...s, ok: true })),
    ...inaccessible.map((s) => ({ ...s, ok: false })),
  ];
  const sourceIds = new Set(sourceList.map((s) => s.id));
  const accessibleBoards = (await getAccessibleBoards(user)).filter(
    (b) => !sourceIds.has(b.id),
  );

  const access = await db
    .select({
      id: financeBoardAccess.id,
      userId: financeBoardAccess.userId,
      username: users.username,
      avatarPath: users.avatarPath,
      groupName: groups.name,
    })
    .from(financeBoardAccess)
    .leftJoin(users, eq(users.id, financeBoardAccess.userId))
    .leftJoin(groups, eq(groups.id, financeBoardAccess.groupId))
    .where(eq(financeBoardAccess.financeBoardId, fbId));

  const items = await db
    .select()
    .from(financePlanItems)
    .where(eq(financePlanItems.financeBoardId, fbId))
    .orderBy(asc(financePlanItems.position));
  const tops = items.filter((i) => i.parentId == null);
  const childrenOf = (pid: number) => items.filter((i) => i.parentId === pid);
  const incomeTops = tops.filter((t) => t.kind === "income");
  const expenseTops = tops.filter((t) => t.kind === "expense");

  const renderTop = (top: (typeof tops)[number]) => {
    const kids = childrenOf(top.id);
    const childSum = kids.reduce((s, k) => s + (k.plannedAmount ?? 0), 0);
    const mismatch =
      kids.length > 0 &&
      top.plannedAmount != null &&
      childSum !== top.plannedAmount;
    return (
      <div key={top.id} className="space-y-2 rounded-md border border-slate-200 p-3">
        <PlanItemRow
          item={{
            id: top.id,
            haushaltstitel: top.haushaltstitel,
            title: top.title,
            plannedAmount: centsToInput(top.plannedAmount),
          }}
          editAction={editPlanItemAction.bind(null, top.id)}
          deleteAction={deletePlanItemAction.bind(null, top.id)}
        />
        {mismatch && (
          <p className="ml-1 text-sm text-amber-700">
            ⚠ Summe der Unterpunkte ({formatCents(childSum)}) weicht vom
            Oberpunkt ({formatCents(top.plannedAmount)}) ab.
          </p>
        )}
        {kids.map((k) => (
          <PlanItemRow
            key={k.id}
            child
            item={{
              id: k.id,
              haushaltstitel: k.haushaltstitel,
              title: k.title,
              plannedAmount: centsToInput(k.plannedAmount),
            }}
            editAction={editPlanItemAction.bind(null, k.id)}
            deleteAction={deletePlanItemAction.bind(null, k.id)}
          />
        ))}
        <form
          action={addPlanItemAction.bind(null, fbId, top.id, top.kind)}
          className="ml-6"
        >
          <SubmitButton className="btn-secondary btn-sm">
            + Unterpunkt
          </SubmitButton>
        </form>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/finanzen/${fbId}`} className="text-sm text-brand-600">
        ← Zurück zur Finanzübersicht
      </Link>
      <h1 className="text-2xl font-bold">Einstellungen: {fb.name}</h1>

      {/* Name */}
      <CollapsibleSection title="Name">
        <RenameFinanceForm
          id={fbId}
          name={fb.name}
          description={fb.description}
        />
      </CollapsibleSection>

      {/* Betroffene Konten */}
      <CollapsibleSection title="Betroffene Konten">
        <p className="mb-3 text-sm text-slate-500">
          Nur Karten der Quell-Boards mit einem dieser Konten (und gesetztem
          Haushaltstitel) fließen in die Auswertung ein. Mehrere Konten möglich.
        </p>
        <div className="space-y-2">
          {selectedAccounts.length === 0 && (
            <p className="text-sm text-slate-500">Noch keine Konten gewählt.</p>
          )}
          {selectedAccounts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm"
            >
              <span>{a.name}</span>
              <form action={removeFinanceAccountAction.bind(null, fbId, a.id)}>
                <SubmitButton className="btn-secondary btn-sm">
                  Entfernen
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
        {availableAccounts.length > 0 && (
          <form
            action={addFinanceAccountAction.bind(null, fbId)}
            className="mt-3 flex items-end gap-2"
          >
            <Select
              name="accountId"
              className="w-64"
              searchable
              searchPlaceholder="Konto suchen…"
              options={[
                { value: "", label: "— Konto wählen —" },
                ...availableAccounts.map((a) => ({
                  value: String(a.id),
                  label: a.name,
                })),
              ]}
            />
            <SubmitButton className="btn-secondary">Hinzufügen</SubmitButton>
          </form>
        )}
      </CollapsibleSection>

      {/* Konten für Ausgaben-Berechnung (Override) */}
      {selectedAccounts.length > 0 && (
        <CollapsibleSection title="Konten für Ausgaben-Berechnung">
          <p className="mb-3 text-sm text-slate-500">
            Optional: schränkt die Berechnung von „Live-Ausgaben" und
            „Tatsächlichen Ausgaben" auf eine Teilmenge der betroffenen Konten
            ein. <strong>Leer = alle betroffenen Konten</strong> zählen (wie die
            Antragsübersicht). Die Antragsübersicht bleibt davon unberührt.
          </p>
          <div className="space-y-2">
            {expenseAccounts.length === 0 && (
              <p className="text-sm text-slate-500">
                Keine Einschränkung — alle betroffenen Konten werden berücksichtigt.
              </p>
            )}
            {expenseAccounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm"
              >
                <span>{a.name}</span>
                <form
                  action={removeFinanceExpenseAccountAction.bind(null, fbId, a.id)}
                >
                  <SubmitButton className="btn-secondary btn-sm">
                    Entfernen
                  </SubmitButton>
                </form>
              </div>
            ))}
          </div>
          {availableExpenseAccounts.length > 0 && (
            <form
              action={addFinanceExpenseAccountAction.bind(null, fbId)}
              className="mt-3 flex items-end gap-2"
            >
              <Select
                name="accountId"
                className="w-64"
                searchable
                searchPlaceholder="Konto suchen…"
                options={[
                  { value: "", label: "— Konto wählen —" },
                  ...availableExpenseAccounts.map((a) => ({
                    value: String(a.id),
                    label: a.name,
                  })),
                ]}
              />
              <SubmitButton className="btn-secondary">Hinzufügen</SubmitButton>
            </form>
          )}
        </CollapsibleSection>
      )}

      {/* Quell-Boards */}
      <CollapsibleSection title="Quell-Boards">
        <div className="space-y-2">
          {sourceList.length === 0 && (
            <p className="text-sm text-slate-500">Noch keine Quell-Boards.</p>
          )}
          {sourceList.map((s) => (
            <div
              key={s.id}
              className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${
                s.ok ? "border-slate-200" : "border-red-300 bg-red-50"
              }`}
            >
              <span className={s.ok ? "" : "text-red-700"}>
                {s.name}
                {!s.ok && " — kein Zugriff des Eigentümers (Daten ausgeblendet)"}
              </span>
              <form action={removeFinanceSourceAction.bind(null, fbId, s.id)}>
                <SubmitButton className="btn-secondary btn-sm">
                  Entfernen
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
        {accessibleBoards.length > 0 && (
          <form
            action={addFinanceSourceAction.bind(null, fbId)}
            className="mt-3 flex items-end gap-2"
          >
            <Select
              name="boardId"
              className="w-64"
              options={[
                { value: "", label: "— Board wählen —" },
                ...accessibleBoards.map((b) => ({
                  value: String(b.id),
                  label: b.name,
                })),
              ]}
            />
            <SubmitButton className="btn-secondary">Hinzufügen</SubmitButton>
          </form>
        )}
      </CollapsibleSection>

      {/* Freigaben */}
      <CollapsibleSection title="Freigaben">
        <div className="grid gap-3 sm:grid-cols-2">
          <form
            action={addFinanceAccessUserAction.bind(null, fbId)}
            className="flex items-end gap-2"
          >
            <div className="flex-1">
              <label className="label">Nutzer freigeben</label>
              <Select
                name="userId"
                placeholder="Nutzer…"
                searchable
                searchPlaceholder="Nutzer suchen…"
                options={activeUsers.map((u) => ({
                  value: String(u.id),
                  label: u.username,
                }))}
              />
            </div>
            <SubmitButton className="btn-primary">+</SubmitButton>
          </form>

          <form
            action={addFinanceAccessGroupAction.bind(null, fbId)}
            className="flex items-end gap-2"
          >
            <div className="flex-1">
              <label className="label">Gruppe freigeben</label>
              <Select
                name="groupId"
                placeholder="Gruppe…"
                searchable
                searchPlaceholder="Gruppe suchen…"
                options={allGroups.map((g) => ({
                  value: String(g.id),
                  label: g.name,
                }))}
              />
            </div>
            <SubmitButton className="btn-primary">+</SubmitButton>
          </form>
        </div>

        <div className="mt-4 space-y-2">
          {access.length === 0 && (
            <p className="text-sm text-slate-500">
              Noch keine Freigaben (nur Eigentümer & Admins haben Zugriff).
            </p>
          )}
          {access.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
            >
              <span className="inline-flex items-center gap-2 text-sm">
                {a.userId ? (
                  <>
                    <Avatar
                      username={a.username ?? "?"}
                      src={a.avatarPath ? `/api/avatar/${a.userId}` : null}
                      size={22}
                    />
                    {a.username}
                  </>
                ) : (
                  <>👥 {a.groupName} (Gruppe)</>
                )}
              </span>
              <form action={removeFinanceAccessAction.bind(null, fbId, a.id)}>
                <SubmitButton className="btn-secondary px-2 py-1">
                  Entfernen
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Haushaltsplan */}
      <CollapsibleSection title="Haushaltsplan" contentClassName="space-y-4">
        <p className="text-sm text-slate-500">
          Getrennt nach Einnahmen und Ausgaben. Oberpunkte werden von Hand
          ausgefüllt (nicht automatisch summiert); bei Abweichung zur Summe der
          Unterpunkte erscheint eine Warnung. Nur Ausgaben fließen in die
          Ausgaben-Auswertungen ein.
        </p>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-green-700">Einnahmen</h3>
          {incomeTops.length === 0 && (
            <p className="text-xs text-slate-400">Noch keine Einnahmen.</p>
          )}
          {incomeTops.map(renderTop)}
          <form action={addPlanItemAction.bind(null, fbId, null, "income")}>
            <SubmitButton className="btn-secondary btn-sm">
              + Einnahme (Oberpunkt)
            </SubmitButton>
          </form>
        </div>

        <div className="space-y-3 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">Ausgaben</h3>
          {expenseTops.length === 0 && (
            <p className="text-xs text-slate-400">Noch keine Ausgaben.</p>
          )}
          {expenseTops.map(renderTop)}
          <form action={addPlanItemAction.bind(null, fbId, null, "expense")}>
            <SubmitButton className="btn-secondary btn-sm">
              + Ausgabe (Oberpunkt)
            </SubmitButton>
          </form>
        </div>
      </CollapsibleSection>

      {/* Eigentum & Löschen */}
      <CollapsibleSection title="Eigentum & Löschen" className="border-red-200">
        <div className="mb-4">
          <label className="label">Eigentum übertragen an</label>
          <p className="mb-2 text-xs text-slate-500">
            Der neue Eigentümer entscheidet über Freigaben; sichtbar sind nur
            Quell-Boards, auf die er Zugriff hat. Zum Schutz erst „ÜBERTRAGEN"
            eingeben; danach bestätigen.
          </p>
          <TransferOwnerForm
            action={transferFinanceOwnerAction.bind(null, fbId)}
            options={activeUsers.map((u) => ({
              value: String(u.id),
              label: u.username,
            }))}
            currentOwnerId={String(fb.ownerId)}
            entityLabel={`Finanzübersicht „${fb.name}"`}
            requireTyped="ÜBERTRAGEN"
          />
        </div>
        <DeleteConfirm
          action={deleteFinanceBoardAction.bind(null, fbId)}
          buttonLabel="Finanzübersicht löschen"
          title={`„${fb.name}" löschen`}
          message="Die Finanzübersicht inkl. Haushaltsplan wird unwiderruflich gelöscht (die Quell-Boards bleiben unberührt)."
        />
      </CollapsibleSection>
    </div>
  );
}
