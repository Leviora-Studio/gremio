// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boardAccess,
  boardArchive,
  boardCardFields,
  boardNumbering,
  boardStatuses,
  groups,
  users,
} from "@/lib/db/schema";
import { requireBoardManage } from "@/lib/authz";
import { getAccounts } from "@/lib/accounts";
import { EDITABLE_FIELD_KEYS } from "@/lib/constants";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { Select } from "@/components/Select";
import { Avatar } from "@/components/Avatar";
import { RenameBoardForm } from "@/components/board/RenameBoardForm";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { StatusList } from "@/components/board/StatusList";
import { CardFieldsForm } from "@/components/board/CardFieldsForm";
import { BoardNumberingForm } from "@/components/board/BoardNumberingForm";
import { SelectSaveForm } from "@/components/SelectSaveForm";
import { ArchiveSettings } from "@/components/board/ArchiveSettings";
import { DoneColumnForm } from "@/components/board/DoneColumnForm";
import { TransferOwnerForm } from "@/components/admin/TransferOwnerForm";
import {
  addAccessGroupAction,
  addAccessUserAction,
  addStatusAction,
  deleteBoardConfirmedAction,
  removeAccessAction,
  setArchiveTriggerAction,
  setInstructionTriggerAction,
  setResubmitStatusAction,
  setReceiptFromStatusAction,
  setReceiptToStatusAction,
  setDefaultAccountAction,
  transferOwnerAction,
} from "./actions";

export default async function BoardSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const boardId = Number(id);
  const { board } = await requireBoardManage(boardId);

  const statuses = await db
    .select()
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId))
    .orderBy(asc(boardStatuses.position));
  const accounts = await getAccounts();

  const fieldRows = await db
    .select()
    .from(boardCardFields)
    .where(eq(boardCardFields.boardId, boardId))
    .orderBy(asc(boardCardFields.position));
  const visibility: Record<string, boolean> = {};
  for (const f of fieldRows) visibility[f.fieldKey] = f.visible;
  // Editierbare Felder in gespeicherter Reihenfolge; fehlende (z.B. neu
  // hinzugekommene) hinten anhängen.
  const stored = fieldRows
    .map((f) => f.fieldKey)
    .filter((k) => EDITABLE_FIELD_KEYS.includes(k as (typeof EDITABLE_FIELD_KEYS)[number]));
  const fieldOrder = [
    ...stored,
    ...EDITABLE_FIELD_KEYS.filter((k) => !stored.includes(k)),
  ];

  const [numberingRow] = await db
    .select()
    .from(boardNumbering)
    .where(eq(boardNumbering.boardId, boardId))
    .limit(1);
  const numbering = {
    enabled: numberingRow?.enabled ?? false,
    prefix: numberingRow?.prefix ?? "",
    year: numberingRow?.year ?? "",
    code: numberingRow?.code ?? "",
    separator: numberingRow?.separator ?? "_",
    padding: numberingRow?.padding ?? 0,
    next: numberingRow?.next ?? 1,
  };

  const access = await db
    .select({
      id: boardAccess.id,
      userId: boardAccess.userId,
      groupId: boardAccess.groupId,
      userName: users.username,
      avatarPath: users.avatarPath,
      groupName: groups.name,
    })
    .from(boardAccess)
    .leftJoin(users, eq(users.id, boardAccess.userId))
    .leftJoin(groups, eq(groups.id, boardAccess.groupId))
    .where(eq(boardAccess.boardId, boardId));

  const allUsers = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.username);
  const allGroups = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .orderBy(groups.name);

  const triggerId = statuses.find((s) => s.isArchiveTrigger)?.id ?? "";
  const instrTriggerId =
    statuses.find((s) => s.isInstructionTrigger)?.id ?? "";

  const [archiveCfg] = await db
    .select()
    .from(boardArchive)
    .where(eq(boardArchive.boardId, boardId))
    .limit(1);

  return (
    <div className="mx-auto max-w-5xl space-y-8 py-2">
      <div>
        <Link href={`/intern/board/${boardId}`} className="text-sm text-brand-600">
          ← Zurück zum Board
        </Link>
        <h1 className="text-2xl font-bold">Board-Einstellungen</h1>
      </div>

      {/* 1. Allgemein */}
      <CollapsibleSection title="Allgemein">
        <RenameBoardForm
          boardId={boardId}
          name={board.name}
          description={board.description}
        />
      </CollapsibleSection>

      {/* 2. Freigaben */}
      <CollapsibleSection title="Freigaben">
        <p className="mb-3 text-sm text-slate-500">
          Lege fest, welche Nutzer und Gruppen dieses Board sehen und Karten
          bearbeiten dürfen. Eigentümer und Admins haben immer Zugriff.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <form
            action={addAccessUserAction.bind(null, boardId)}
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
            action={addAccessGroupAction.bind(null, boardId)}
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
              <form action={removeAccessAction.bind(null, boardId, a.id)}>
                <SubmitButton className="btn-secondary px-2 py-1">
                  Entfernen
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* 3. Spalten */}
      <CollapsibleSection title="Spalten">
        <p className="mb-2 text-xs text-slate-500">
          Spalten anlegen, umbenennen, löschen und am Griff (⠿) sortieren.
          Trigger-Funktionen einzelner Spalten findest du unter „Trigger-Spalten".
        </p>
        <StatusList
          boardId={boardId}
          statuses={statuses.map((s) => ({
            id: s.id,
            name: s.name,
            isArchiveTrigger: s.isArchiveTrigger,
          }))}
        />
        <form
          action={addStatusAction.bind(null, boardId)}
          className="mt-3 flex items-end gap-2"
        >
          <div className="flex-1">
            <label className="label">Neue Spalte</label>
            <input name="name" className="input" placeholder="Spaltenname" />
          </div>
          <SubmitButton className="btn-primary">Hinzufügen</SubmitButton>
        </form>
      </CollapsibleSection>

      {/* 4. Kartenfelder */}
      <CollapsibleSection title="Kartenfelder">
        <p className="mb-3 text-sm text-slate-500">
          Lege fest, welche Felder auf den Karten dieses Boards sichtbar sind und
          in welcher Reihenfolge.
        </p>
        <CardFieldsForm
          boardId={boardId}
          visibility={visibility}
          fieldOrder={fieldOrder}
        />
      </CollapsibleSection>

      {/* 5. Automatische Antragsnummer */}
      <CollapsibleSection title="Automatische Antragsnummer">
        <BoardNumberingForm boardId={boardId} config={numbering} />
      </CollapsibleSection>

      {/* 6. Trigger-Spalten (Anweisungsdatum, Nachreichung, Quittung, Done) */}
      <CollapsibleSection title="Trigger-Spalten">
        <p className="mb-4 text-sm text-slate-500">
          Diese Spalten lösen beim Erreichen automatische Aktionen aus oder
          schalten Funktionen frei. Ohne Auswahl ist die jeweilige Funktion
          deaktiviert.
        </p>

        {/* Anweisungsdatum */}
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-700">
            Anweisungsdatum automatisch setzen
          </h3>
          <p className="text-xs text-slate-500">
            Erreicht eine Karte diese Spalte, wird ihr Anweisungsdatum
            automatisch auf den heutigen Tag gesetzt.
          </p>
          <SelectSaveForm
            action={setInstructionTriggerAction.bind(null, boardId)}
            name="statusId"
            label="Auslösende Spalte"
            submitLabel="Setzen"
            initial={instrTriggerId ? String(instrTriggerId) : ""}
            options={[
              { value: "", label: "— keine —" },
              ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        </div>

        {/* Nachreichung */}
        <div className="mt-4 space-y-1 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Nachreichung (öffentlicher Status-Link)
          </h3>
          <p className="text-xs text-slate-500">
            Ab dieser Spalte können Antragsteller über den Status-Link Dateien
            nachreichen. Die Karte bleibt in der Spalte und wird farblich
            markiert.
          </p>
          <SelectSaveForm
            action={setResubmitStatusAction.bind(null, boardId)}
            name="statusId"
            label="Spalte, ab der nachgereicht werden kann"
            submitLabel="Setzen"
            initial={board.resubmitStatusId ? String(board.resubmitStatusId) : ""}
            options={[
              { value: "", label: "— deaktiviert —" },
              ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        </div>

        {/* Quittung */}
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Quittung (öffentlicher Status-Link)
          </h3>
          <p className="text-xs text-slate-500">
            Ab der Quell-Spalte können Antragsteller einreichen; nach dem
            Einreichen springt die Karte automatisch in die Zielspalte.
          </p>
          <SelectSaveForm
            action={setReceiptFromStatusAction.bind(null, boardId)}
            name="statusId"
            label="Quell-Spalte (ab hier einreichbar)"
            submitLabel="Setzen"
            initial={
              board.receiptFromStatusId ? String(board.receiptFromStatusId) : ""
            }
            options={[
              { value: "", label: "— deaktiviert —" },
              ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
          <SelectSaveForm
            action={setReceiptToStatusAction.bind(null, boardId)}
            name="statusId"
            label="Zielspalte (nach dem Einreichen)"
            submitLabel="Setzen"
            initial={
              board.receiptToStatusId ? String(board.receiptToStatusId) : ""
            }
            options={[
              { value: "", label: "— keine —" },
              ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        </div>

        {/* Done-Spalte */}
        <div className="mt-4 space-y-1 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Done-Spalte (Erledigt-Archiv)
          </h3>
          <DoneColumnForm
            boardId={boardId}
            statuses={statuses.map((s) => ({ id: s.id, name: s.name }))}
            config={{
              doneStatusId: board.doneStatusId,
              doneSweepTime: board.doneSweepTime,
            }}
          />
        </div>
      </CollapsibleSection>

      {/* 7. Standardkonto */}
      <CollapsibleSection title="Standardkonto">
        <p className="mb-3 text-sm text-slate-500">
          Wird bei neuen Karten dieses Boards automatisch als „Konto"
          vorausgewählt (beim Bearbeiten änderbar).
        </p>
        <SelectSaveForm
          action={setDefaultAccountAction.bind(null, boardId)}
          name="accountId"
          label="Konto"
          submitClassName="btn-primary"
          initial={board.defaultAccountId ? String(board.defaultAccountId) : ""}
          options={[
            { value: "", label: "— kein Standardkonto —" },
            ...accounts.map((a) => ({ value: String(a.id), label: a.name })),
          ]}
        />
      </CollapsibleSection>

      {/* 8. Nextcloud-Archiv (inkl. Trigger-Spalte) */}
      <CollapsibleSection title="Nextcloud-Archiv">
        <div className="mb-4 space-y-1 border-b border-slate-100 pb-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Nextcloud-Trigger-Spalte
          </h3>
          <p className="text-xs text-slate-500">
            Erreicht ein Antrag diese Spalte und ist die Archivierung unten
            aktiv, werden alle Anhänge automatisch hochgeladen.
          </p>
          <SelectSaveForm
            action={setArchiveTriggerAction.bind(null, boardId)}
            name="statusId"
            label="Auslösende Spalte"
            submitLabel="Setzen"
            initial={triggerId ? String(triggerId) : ""}
            options={[
              { value: "", label: "— keine —" },
              ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        </div>
        <ArchiveSettings
          boardId={boardId}
          config={{
            enabled: archiveCfg?.enabled ?? false,
            ncUrl: archiveCfg?.ncUrl ?? null,
            ncUsername: archiveCfg?.ncUsername ?? null,
            targetFolder: archiveCfg?.targetFolder ?? null,
            hasPassword: !!archiveCfg?.ncPasswordEnc,
            folderFields: (archiveCfg?.folderFields ?? "number,title")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            folderSeparator: archiveCfg?.folderSeparator ?? " ",
          }}
        />
      </CollapsibleSection>

      {/* 9. Eigentum & Löschen */}
      <CollapsibleSection title="Eigentum & Löschen" className="border-red-200">
        <div className="mb-4">
          <label className="label">Eigentum übertragen an</label>
          <p className="mb-2 text-xs text-slate-500">
            Zum Schutz erst „ÜBERTRAGEN" eingeben; danach bestätigen.
          </p>
          <TransferOwnerForm
            action={transferOwnerAction.bind(null, boardId)}
            options={allUsers.map((u) => ({
              value: String(u.id),
              label: u.username,
            }))}
            currentOwnerId={String(board.ownerId)}
            entityLabel={`Board „${board.name}"`}
            requireTyped="ÜBERTRAGEN"
          />
        </div>
        <DeleteConfirm
          action={deleteBoardConfirmedAction.bind(null, boardId)}
          buttonLabel="Board löschen"
          title={`Board „${board.name}" löschen`}
          message="Das Board wird inkl. aller Anträge, Karten und Anhänge unwiderruflich gelöscht."
        />
      </CollapsibleSection>
    </div>
  );
}
