// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { CardEditor } from "@/components/antrag/CardEditor";
import {
  AttachmentSlot,
  WeitereAttachments,
} from "@/components/antrag/Attachments";
import {
  createBlankCardAction,
  finalizeNewCardAction,
} from "@/app/intern/board/actions";
import { discardCardAction } from "@/app/intern/card/[id]/actions";
import type { PriorityOption } from "@/lib/priorities";
import type { AccountOption } from "@/lib/accounts";

export function NewCardButton({
  boardId,
  visible,
  priorities,
  accounts,
  defaultAccountId,
  currentUser,
  canManage,
}: {
  boardId: number;
  visible: string[];
  priorities: PriorityOption[];
  accounts: AccountOption[];
  defaultAccountId: number | null;
  currentUser: {
    id: number;
    username: string;
    name: string | null;
    avatarPath: string | null;
  };
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cardId, setCardId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Verhindert ein Rennen zwischen Verwerfen und Behalten (z.B. Escape/Backdrop
  // während des Verwerfen-Awaits): Sobald einer der beiden Wege startet, ist der
  // andere gesperrt – sonst könnte eine gerade verworfene Karte über onClose
  // doch noch finalisiert werden und eine Antragsnummer verbrauchen.
  const closing = useRef(false);

  async function start() {
    setBusy(true);
    const res = await createBlankCardAction(boardId);
    setBusy(false);
    if (res.id) {
      closing.current = false;
      setCardId(res.id);
      setOpen(true);
    }
  }

  // Behalten (Fertig/Schließen): hier wird – falls aktiv – die Antragsnummer
  // vergeben. Verwerfen läuft NICHT hier durch → verbraucht keine Nummer.
  async function keep() {
    if (closing.current) return;
    closing.current = true;
    const id = cardId;
    setOpen(false);
    setCardId(null);
    if (id) await finalizeNewCardAction(id);
    router.refresh();
  }

  async function discard() {
    if (closing.current) return;
    closing.current = true;
    const id = cardId;
    setOpen(false);
    setCardId(null);
    if (id) await discardCardAction(id);
    router.refresh();
  }

  const has = (k: string) => visible.includes(k);

  return (
    <>
      <button
        onClick={start}
        disabled={busy}
        className="btn-primary flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
      >
        {"+ Neue Karte"}
      </button>

      {/* Kein X-Button: Die Karte existiert bereits (Auto-Speichern), deshalb
          gibt es hier nur die eindeutigen Wege „Verwerfen" (löscht) und
          „Fertig" (behält). Escape und Backdrop laufen über onClose → keep,
          also denselben Behalten-Pfad wie „Fertig". */}
      <Modal
        open={open && cardId !== null}
        onClose={keep}
        showCloseButton={false}
        title="Neue Karte"
        headerActions={
          <>
            <button onClick={discard} className="btn-danger btn-sm">
              Verwerfen
            </button>
            <button onClick={keep} className="btn-primary btn-sm">
              Fertig
            </button>
          </>
        }
      >
        {cardId !== null && (
          <div className="space-y-6">
            <CardEditor
              cardId={cardId}
              boardId={boardId}
              visible={visible}
              initial={{
                title: "",
                applicant: "",
                budgetTitle: null,
                number: null,
                deadline: null,
                meeting: null,
                decisionRef: null,
                instructionDate: null,
                transferDate: null,
                approvedAmount: null,
                actualAmount: null,
                priorityId: null,
                accountId: defaultAccountId,
                notes: null,
                applicantNote: null,
              }}
              creator={currentUser}
              assignees={[]}
              priorities={priorities}
              accounts={accounts}
              canManage={canManage}
            />

            {(has("finance_request") ||
              has("student_card") ||
              has("annex_a") ||
              has("annex_b") ||
              has("other_pdfs")) && (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-700">Anhänge</h3>
                {has("finance_request") && (
                  <AttachmentSlot
                    cardId={cardId}
                    kind="finance_request"
                    label="Finanzantrag (PDF)"
                    accept="application/pdf,.pdf"
                    current={null}
                  />
                )}
                {has("student_card") && (
                  <AttachmentSlot
                    cardId={cardId}
                    kind="student_card"
                    label="Studierendenausweis (PDF/PNG/JPG)"
                    accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                    current={null}
                  />
                )}
                {has("annex_a") && (
                  <AttachmentSlot
                    cardId={cardId}
                    kind="annex_a"
                    label="Anlage A (PDF)"
                    accept="application/pdf,.pdf"
                    current={null}
                  />
                )}
                {has("annex_b") && (
                  <AttachmentSlot
                    cardId={cardId}
                    kind="annex_b"
                    label="Anlage B (PDF)"
                    accept="application/pdf,.pdf"
                    current={null}
                  />
                )}
                {has("other_pdfs") && (
                  <WeitereAttachments cardId={cardId} items={[]} />
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
