// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boards,
  groups,
  inventoryBoardAccess,
  users,
} from "@/lib/db/schema";
import { requireInventoryBoardManage } from "@/lib/inventory";
import { LoanBoardEditor } from "@/components/inventory/LoanBoardEditor";
import {
  getInventoryBoardFields,
  INVENTORY_FIELD_KEYS,
  INVENTORY_FIELD_LABELS,
  type InventoryFieldKey,
} from "@/lib/inventory-fields";
import { getInventoryNumbering } from "@/lib/inventory-items";
import { Avatar } from "@/components/Avatar";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { TransferOwnerForm } from "@/components/admin/TransferOwnerForm";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { InventoryNumberingForm } from "@/components/inventory/InventoryNumberingForm";
import {
  addInventoryAccessGroupAction,
  addInventoryAccessUserAction,
  deleteInventoryBoardConfirmedAction,
  removeInventoryAccessAction,
  renameInventoryBoardAction,
  transferInventoryOwnerAction,
  updateInventoryFieldsAction,
} from "./actions";

export const metadata = { title: "Inventar-Einstellungen — Gremio" };

export default async function InventoryBoardSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { board } = await requireInventoryBoardManage(Number(id));
  const [fields, numbering, access, allUsers, allGroups, loanBoardRow] =
    await Promise.all([
      getInventoryBoardFields(board.id),
      getInventoryNumbering(board.id),
      db
        .select({
          id: inventoryBoardAccess.id,
          userId: inventoryBoardAccess.userId,
          groupId: inventoryBoardAccess.groupId,
          userName: users.username,
          avatarPath: users.avatarPath,
          groupName: groups.name,
        })
        .from(inventoryBoardAccess)
        .leftJoin(users, eq(users.id, inventoryBoardAccess.userId))
        .leftJoin(groups, eq(groups.id, inventoryBoardAccess.groupId))
        .where(eq(inventoryBoardAccess.boardId, board.id)),
      db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.isActive, true))
        .orderBy(users.username),
      db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .orderBy(groups.name),
      board.loanBoardId
        ? db
            .select({ id: boards.id, name: boards.name })
            .from(boards)
            .where(eq(boards.id, board.loanBoardId))
            .limit(1)
        : Promise.resolve([]),
    ]);
  const visible = new Set(
    fields.filter((f) => f.visible).map((f) => f.fieldKey),
  );
  const loanBoard = loanBoardRow[0] ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-2">
      <div>
        <Link
          href={`/intern/inventar/${board.id}`}
          className="text-sm text-brand-600"
        >
          ← {board.name}
        </Link>
        <h1 className="text-2xl font-bold">Inventar-Einstellungen</h1>
      </div>

      {/* Allgemein */}
      <CollapsibleSection title="Allgemein" defaultOpen>
        <form action={renameInventoryBoardAction} className="space-y-4">
          <input type="hidden" name="boardId" value={board.id} />
          <div>
            <label htmlFor="b-name" className="label">
              Name
            </label>
            <input
              id="b-name"
              name="name"
              className="input"
              required
              defaultValue={board.name}
            />
          </div>
          <div>
            <label htmlFor="b-desc" className="label">
              Beschreibung
            </label>
            <textarea
              id="b-desc"
              name="description"
              className="input"
              rows={2}
              defaultValue={board.description ?? ""}
            />
          </div>
          <button type="submit" className="btn-primary">
            Speichern
          </button>
        </form>
      </CollapsibleSection>

      {/* Freigaben */}
      <CollapsibleSection title="Freigaben">
        <p className="mb-3 text-sm text-slate-500">
          Lege fest, welche Nutzer und Gruppen dieses Inventar sehen und
          bearbeiten dürfen. Eigentümer und Admins haben immer Zugriff.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <form
            action={addInventoryAccessUserAction.bind(null, board.id)}
            className="flex items-end gap-2"
          >
            <div className="flex-1">
              <label className="label">Nutzer freigeben</label>
              <Select
                name="userId"
                placeholder="Nutzer…"
                searchable
                searchPlaceholder="Nutzer suchen…"
                options={allUsers.map((u) => ({
                  value: String(u.id),
                  label: u.username,
                }))}
              />
            </div>
            <SubmitButton className="btn-primary">+</SubmitButton>
          </form>

          <form
            action={addInventoryAccessGroupAction.bind(null, board.id)}
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
                      username={a.userName ?? "?"}
                      src={a.avatarPath ? `/api/avatar/${a.userId}` : null}
                      size={22}
                    />
                    {a.userName}
                  </>
                ) : (
                  <>👥 {a.groupName} (Gruppe)</>
                )}
              </span>
              <form
                action={removeInventoryAccessAction.bind(null, board.id, a.id)}
              >
                <SubmitButton className="btn-secondary px-2 py-1">
                  Entfernen
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Felder */}
      <CollapsibleSection title="Felder">
        <form action={updateInventoryFieldsAction} className="space-y-4">
          <p className="text-sm text-slate-500">
            Welche Felder bei den Gegenständen erscheinen. Die Bezeichnung ist
            immer sichtbar.
          </p>
          <input type="hidden" name="boardId" value={board.id} />
          <div className="grid gap-2 sm:grid-cols-2">
          {INVENTORY_FIELD_KEYS.map((key) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2"
            >
              <input
                type="checkbox"
                name="visible"
                value={key}
                defaultChecked={visible.has(key)}
                className="h-4 w-4"
              />
              <span className="text-sm">
                {INVENTORY_FIELD_LABELS[key as InventoryFieldKey]}
              </span>
            </label>
          ))}
        </div>
          <button type="submit" className="btn-primary">
            Felder speichern
          </button>
        </form>
      </CollapsibleSection>

      {/* Aufgabentracking: Leihvorgänge als Karten auf einem Kanban-Board */}
      <CollapsibleSection title="Aufgabentracking (Leihvorgänge als Karten)">
        <LoanBoardEditor
          boardId={board.id}
          loanBoard={loanBoard}
          suggestedName={`${board.name} – Leihvorgänge`}
        />
      </CollapsibleSection>

      {/* Inventarnummer */}
      <CollapsibleSection title="Automatische Inventarnummer">
        <InventoryNumberingForm
          boardId={board.id}
          config={{
            enabled: numbering?.enabled ?? false,
            prefix: numbering?.prefix ?? "",
            year: numbering?.year ?? "",
            separator: numbering?.separator ?? "_",
            padding: numbering?.padding ?? 0,
            next: numbering?.next ?? 1,
          }}
        />
      </CollapsibleSection>

      {/* Eigentum & Löschen */}
      <CollapsibleSection title="Eigentum & Löschen" className="border-red-200">
        <div className="mb-4">
          <label className="label">Eigentum übertragen an</label>
          <p className="mb-2 text-xs text-slate-500">
            Zum Schutz erst „ÜBERTRAGEN" eingeben; danach bestätigen.
          </p>
          <TransferOwnerForm
            action={transferInventoryOwnerAction.bind(null, board.id)}
            options={allUsers.map((u) => ({
              value: String(u.id),
              label: u.username,
            }))}
            currentOwnerId={String(board.ownerId)}
            entityLabel={`Inventar „${board.name}"`}
            requireTyped="ÜBERTRAGEN"
          />
        </div>
        <DeleteConfirm
          action={deleteInventoryBoardConfirmedAction.bind(null, board.id)}
          buttonLabel="Inventar löschen"
          title={`Inventar „${board.name}" löschen`}
          message="Das Inventar wird inkl. aller Gegenstände, Vorgänge und Dateien unwiderruflich gelöscht."
        />
      </CollapsibleSection>
    </div>
  );
}
