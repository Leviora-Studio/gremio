// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { allowRequest } from "@/lib/rate-limit";
import { AUSWEIS_MIME } from "@/lib/constants";
import { validateUpload } from "@/lib/attachments";
import {
  getLoanByToken,
  submitLoanContract,
  withdrawLoan,
} from "@/lib/inventory-loans";
import {
  addInventoryAttachment,
  listLoanAttachments,
} from "@/lib/inventory-attachments";

export type PublicContractState = { error?: string; ok?: boolean };

const MAX_SIGNED_UPLOADS = 5;

/**
 * Entleiher lädt den unterschriebenen Leihvertrag (Scan/Foto) hoch. Append-only,
 * landet intern am Vorgang (loanId), uploadedBy NULL (= vom Entleiher).
 */
export async function uploadSignedContractAction(
  token: string,
  _prev: PublicContractState,
  formData: FormData,
): Promise<PublicContractState> {
  if (!(await allowRequest("inventory-contract", 10, 60_000))) {
    return {
      error: "Zu viele Uploads. Bitte versuche es in einer Minute erneut.",
    };
  }
  const loan = await getLoanByToken(token);
  if (!loan) return { error: "Vorgang nicht gefunden." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Keine Datei ausgewählt." };
  // Unterschriebener Vertrag als PDF oder Scan/Foto (PNG/JPG).
  const err = validateUpload(file, AUSWEIS_MIME);
  if (err) return { error: err };

  const existing = await listLoanAttachments(loan.id);
  const signed = existing.filter(
    (a) => a.kind === "loan_contract" && a.uploadedBy === null,
  );
  if (signed.length >= MAX_SIGNED_UPLOADS) {
    return { error: "Maximale Anzahl erreicht." };
  }

  await addInventoryAttachment(loan.itemId, "loan_contract", file, null, loan.id);
  // Nur anhängen — den Status stellt der Entleiher bewusst per „Vertrag
  // einsenden" weiter (submitContractAction), nicht schon beim Hochladen.
  revalidatePath(`/inventar/status/${token}`);
  return { ok: true };
}

/**
 * Entleiher bestätigt „Vertrag einsenden": alle Unterlagen sind angefügt →
 * Vorgang auf „Vertrag unterschrieben" stellen (und die Tracking-Karte in die
 * passende Spalte bewegen). Verlangt mind. ein hochgeladenes Dokument.
 */
export async function submitContractAction(
  token: string,
  _prev: PublicContractState,
  _formData: FormData,
): Promise<PublicContractState> {
  if (!(await allowRequest("inventory-contract", 10, 60_000))) {
    return {
      error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
    };
  }
  const loan = await getLoanByToken(token);
  if (!loan) return { error: "Vorgang nicht gefunden." };
  if (loan.status !== "requested" && loan.status !== "contract_provided") {
    return { error: "Der Vertrag wurde bereits eingesendet." };
  }
  const existing = await listLoanAttachments(loan.id);
  const uploaded = existing.filter(
    (a) => a.kind === "loan_contract" && a.uploadedBy === null,
  );
  if (uploaded.length === 0) {
    return { error: "Bitte lade zuerst deine unterschriebenen Dokumente hoch." };
  }
  await submitLoanContract(loan.id);
  revalidatePath(`/inventar/status/${token}`);
  return { ok: true };
}

/** Einreicher zieht seine Anfrage zurück (nur solange noch nicht angenommen). */
export async function withdrawRequestAction(token: string): Promise<void> {
  const loan = await getLoanByToken(token);
  if (!loan) return;
  await withdrawLoan(loan.id);
  revalidatePath(`/inventar/status/${token}`);
}
