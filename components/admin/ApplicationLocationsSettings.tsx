// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import {APPLICATION_REQUIRED_CARD_FIELD_KEYS,CARD_FIELD_LABELS,type CardFieldKey} from "@/lib/constants";
import {ReceiptBrandingForm} from "@/components/admin/ReceiptBrandingForm";
import {logoVersion} from "@/lib/receipt-branding";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { boardCardFields, boards, boardStatuses, locations } from "@/lib/db/schema";
import { LocationEditor } from "@/components/admin/LocationEditor";
import { CreateLocationForm } from "@/components/admin/CreateLocationForm";

import {getApplicationModuleState,type ApplicationModule} from "@/lib/application-form-modules";
import {ApplicationModuleControl} from "@/components/admin/ApplicationModuleControl";

export async function ApplicationLocationsSettings({module}:{module:ApplicationModule}) {
  // Nicht nur im Layout: Guard in JEDEM Handler (CLAUDE.md) — Layout-Guards
  // greifen bei segmentgenauen RSC-Navigationsrequests nicht zwingend.
  await requireAdmin();

  const allLocations = await db
    .select()
    .from(locations)
    .where(trashAnd(activeRows.locations, eq(locations.module,module)))
    .orderBy(locations.position);

  // Leih-System-Boards sind kein zulässiges Ziel (siehe setLocationTargetAction)
  // — gar nicht erst anbieten, statt die Auswahl erst beim Speichern abzuweisen.
  const allBoards = await db
    .select()
    .from(boards)
    .where(trashAnd(activeRows.boards, and(isNull(boards.inventoryBoardId),module==="finance"?eq(boards.isApplicationBoard,true):undefined)))
    .orderBy(boards.name);
  const allStatuses = await db
    .select()
    .from(boardStatuses).where(activeRows.boardStatuses)
    .orderBy(boardStatuses.position);

  const fieldRows=await db.select().from(boardCardFields);
  const boardsWithStatuses = allBoards.map((b) => ({
    id: b.id,
    name: b.name,
    missingRequiredFields:APPLICATION_REQUIRED_CARD_FIELD_KEYS.filter(key=>module!=="finance"||!["finance_request","student_card"].includes(key)||b.attachmentFields==null||b.attachmentFields.includes(key)).filter(key=>!fieldRows.some(field=>field.boardId===b.id&&field.fieldKey===key&&field.visible)).map(key=>CARD_FIELD_LABELS[key as CardFieldKey]),
    statuses: allStatuses
      .filter((s) => s.boardId === b.id)
      .map((s) => ({ id: s.id, name: s.name })),
  }));

  const state=await getApplicationModuleState();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{module==="finance"?"Finanzanträge-Formular":"Standorte & Formular-Routing"}</h2>
        <p className="text-sm text-slate-500">
          Pro Standort Ziel-Board und Spalte festlegen. Nur aktivierte Standorte
          erscheinen im öffentlichen Formular; aktivieren ist erst mit gültigem
          Ziel möglich.
        </p>
      </div>

      <ApplicationModuleControl module={module} activeModule={state.activeModule} revision={state.revision}/>
      <CreateLocationForm module={module}/>

      {allBoards.length === 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-700">
          {module==="finance"?"Es gibt noch keine Antragsboards. Erstelle zuerst ein Antragsboard im Admin Panel.":"Es gibt noch keine Boards. Lege zuerst ein Board an, um Standorte darauf zu routen."}
        </p>
      )}
      {allLocations.map((loc) => (
        <LocationEditor
          key={loc.id}
          moduleActive={state.activeModule===module}
          location={{
            id: loc.id,
            name: loc.name,
            enabled: loc.enabled,
            targetBoardId: loc.targetBoardId,
            targetStatusId: loc.targetStatusId,
          }}
          boards={boardsWithStatuses}
          receiptSettings={<ReceiptBrandingForm scope={{kind:"location",id:loc.id}} enabled={loc.receiptBrandingEnabled} organization={loc.receiptOrganization} hasLogo={!!loc.receiptLogoPng} version={logoVersion(loc.receiptLogoPng)} resourceName={loc.name}/>}
        />
      ))}
    </div>
  );
}
