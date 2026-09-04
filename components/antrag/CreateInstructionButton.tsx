// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState } from "react";
import { PdfViewerModal } from "@/components/pdf/PdfViewerModal";
import { createInstructionPdfAction } from "@/app/intern/card/[id]/instruction-form-actions";

export function CreateInstructionButton({
  cardId,
  boardId,
  templateVersion,
  hasCert,
}: {
  cardId: number;
  boardId: number;
  templateVersion: string;
  hasCert: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Neue Anweisung erstellen
      </button>
      <PdfViewerModal
        open={open}
        onClose={() => setOpen(false)}
        src={`/api/board/${boardId}/instruction-template`}
        fieldsUrl={`/api/board/${boardId}/instruction-template/fields`}
        filename="Neue Anweisung"
        mime="application/pdf"
        attachmentId={cardId}
        editable
        hasCert={hasCert}
        sourceVersion={templateVersion}
        saveButtonLabel="Anweisung speichern"
        saveButtonTitle="Speichert die ausgefüllte Anweisung als neue Kartendatei"
        saveAction={createInstructionPdfAction.bind(null, cardId)}
      />
    </>
  );
}
