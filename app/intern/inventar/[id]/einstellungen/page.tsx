// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, inventoryBoardAccess, users } from "@/lib/db/schema";
import { requireInventoryBoardManage } from "@/lib/inventory";
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
import {
  addInventoryAccessGroupAction,
  addInventoryAccessUserAction,
  deleteInventoryBoardConfirmedAction,
  removeInventoryAccessAction,
  renameInventoryBoardAction,
  transferInventoryOwnerAction,
  updateInventoryFieldsAction,
  updateInventoryNumberingAction,
} from "./actions";

export const metadata = { title: "Inventar-Einstellungen — Gremio" };

export default async function InventoryBoardSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { board } = await requireInventoryBoardManage(Number(id));
  const [fields, numbering, access, allUsers, allGroups] = await Promise.all([
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
  ]);
  const visible = new Set(
    fields.filter((f) => f.visible).map((f) => f.fieldKey),
  );

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

      {/* Inventarnummer */}
      <CollapsibleSection title="Automatische Inventarnummer">
        <form action={updateInventoryNumberingAction} className="space-y-4">
          <p className="text-sm text-slate-500">
            Automatisch vergebene Nummer beim Anlegen eines Gegenstands. Format:
            Präfix + Zähler, dann Jahr und Kürzel (leere Teile werden
            übersprungen).
          </p>
          <input type="hidden" name="boardId" value={board.id} />
          <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={numbering?.enabled ?? false}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">
            Automatische Nummerierung aktiv
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            name="prefix"
            label="Präfix"
            defaultValue={numbering?.prefix ?? ""}
            placeholder="INV-"
          />
          <Field
            name="year"
            label="Jahr"
            defaultValue={numbering?.year ?? ""}
            placeholder="2026"
          />
          <Field
            name="code"
            label="Kürzel"
            defaultValue={numbering?.code ?? ""}
            placeholder="KOE"
          />
          <Field
            name="separator"
            label="Trennzeichen"
            defaultValue={numbering?.separator ?? "_"}
          />
          <Field
            name="padding"
            label="Stellen (Auffüllen)"
            type="number"
            defaultValue={String(numbering?.padding ?? 0)}
          />
          <Field
            name="next"
            label="Nächste Nummer"
            type="number"
            defaultValue={String(numbering?.next ?? 1)}
          />
        </div>
          <button type="submit" className="btn-primary">
            Nummerierung speichern
          </button>
        </form>
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

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={`num-${name}`}>
        {label}
      </label>
      <input
        id={`num-${name}`}
        name={name}
        type={type}
        className="input"
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </div>
  );
}
