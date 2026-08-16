// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use server";

import { join } from "node:path";
import { redirect } from "next/navigation";
import {
  checkFormTiming,
  FORM_GUARD_EXPIRED_MESSAGE,
  isHoneypotFilled,
  makeFormGuard,
} from "@/lib/antispam";
import { allowFormRequest } from "@/lib/rate-limit";
import {
  getAvailableGroupUnits,
  getAvailableItemQuantity,
  getInventoryItemById,
} from "@/lib/inventory-items";
import { getPublicInventoryBoardById } from "@/lib/inventory-public";
import {
  createLoanRequest,
  LoanCapacityError,
  type LoanUnit,
} from "@/lib/inventory-loans";
import { saveNamedFile, validateUpload } from "@/lib/attachments";
import { STUDENT_CARD_MIME } from "@/lib/inventory-attachment-kinds";
import { sanitizeSingleLine } from "@/lib/text";

// Eingaben werden bei einem Fehler zurückgegeben, damit das Formular sie behält.
export type RequestValues = {
  borrower: string;
  email: string;
  startDate: string;
  endDate: string;
  purpose: string;
  quantity: string;
};
// `guard` ist ein FRISCHES Zeitfallen-Token: Ohne das behielte das Formular sein
// abgelaufenes und der zweite Versuch scheiterte genauso. `ok` deckt die still
// verworfenen Bot-Einsendungen ab (gefälschte Bestätigung) — wie bei Antrag und
// Feedback, siehe app/actions.ts bzw. app/feedback/actions.ts.
export type RequestState = {
  error?: string;
  ok?: boolean;
  values?: RequestValues;
  guard?: { ts: string; sig: string };
};

// Datum + Uhrzeit (datetime-local) — Pflicht.
const isDateTime = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);

/** Öffentliche Entleih-Anfrage zu einem Gegenstand. Leitet zur Statusseite weiter. */
export async function createInventoryLoanRequestAction(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  // Freitexte an der EINGANGSGRENZE bereinigen (`lib/text.ts`), wie bei den
  // übrigen öffentlichen Formularen: NUL lehnt PostgreSQL ab (der Insert warf
  // sonst einen von außen auslösbaren 500), und ein Name nur aus Steuer-/
  // Zero-Width-Zeichen überlebte die Pflichtfeld-Prüfung, obwohl er leer ist.
  const values: RequestValues = {
    borrower: sanitizeSingleLine(formData.get("borrower")),
    email: sanitizeSingleLine(formData.get("email")),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    purpose: sanitizeSingleLine(formData.get("purpose")),
    quantity: String(formData.get("quantity") ?? "1"),
  };

  if (!(await allowFormRequest("inventory-request"))) {
    return {
      error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
      values,
    };
  }

  // Spam-Schutz wie beim Antrags- und Feedback-Formular: Honeypot + signierte
  // Zeitfalle. Bewusst VOR jeder fachlichen Prüfung und vor jedem Datei-/
  // Datenbankzugriff — eine still verworfene Einsendung darf weder eine Datei
  // schreiben noch einen Vorgang anlegen.
  //
  // Honeypot und „zu schnell ausgefüllt" täuschen eine Bestätigung vor, ohne
  // etwas anzulegen: Der Bot soll nicht lernen, woran er scheitert. Für einen
  // Menschen sind die 3 Sekunden hier ohnehin unerreichbar (Name, E-Mail, zwei
  // Zeitpunkte, Zweck und ein Datei-Upload).
  const timing = await checkFormTiming(formData.get("ts"), formData.get("sig"));
  if (isHoneypotFilled(formData.get("website")) || timing === "too_fast") {
    return { ok: true };
  }
  // Abgelaufenes/fremdes Token trifft dagegen auch echte Nutzer (zu lange
  // offener Tab, Netzwechsel). Hier wäre eine stille Fake-Bestätigung besonders
  // fatal: Der Entleiher hielte die Anfrage für gestellt und wartete auf eine
  // Rückmeldung, die nie kommt. Also sichtbare Meldung samt frischem Token; die
  // Eingaben und die gewählte Ausweis-Datei bleiben im Formular erhalten.
  if (timing === "invalid") {
    return {
      error: FORM_GUARD_EXPIRED_MESSAGE,
      values,
      guard: await makeFormGuard(),
    };
  }

  // Alle Felder sind Pflicht — fehlende/ungültige sammeln (Eingaben bleiben).
  const missing: string[] = [];
  if (!values.borrower) missing.push("Name");
  if (!values.email) missing.push("E-Mail");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email))
    missing.push("gültige E-Mail-Adresse");
  if (!values.purpose) missing.push("Verwendungsort / Zweck");
  if (!isDateTime(values.startDate)) missing.push("Von (Datum + Uhrzeit)");
  if (!isDateTime(values.endDate)) missing.push("Bis (Datum + Uhrzeit)");
  if (missing.length) {
    return { error: `Bitte ergänze: ${missing.join(", ")}.`, values };
  }

  // Studierendenausweis ist PFLICHT — serverseitig geprüft (das HTML-`required`
  // ist nur Komfort und lässt sich umgehen). Vor jedem DB-Zugriff prüfen, damit
  // eine unzulässige Datei gar nicht erst zu einem Vorgang führt.
  const studentCardFile = formData.get("studentCard");
  if (!(studentCardFile instanceof File) || studentCardFile.size === 0) {
    return {
      error: "Bitte lade deinen Studierendenausweis hoch (PDF, PNG oder JPG).",
      values,
    };
  }
  const fileError = validateUpload(studentCardFile, STUDENT_CARD_MIME);
  if (fileError) {
    return {
      error: `Studierendenausweis: ${fileError} Erlaubt sind PDF, PNG und JPG.`,
      values,
    };
  }

  // Drei Varianten: (a) Stückzahl aus einer Obergruppe (mehrere Stücke),
  // (b) Mengen-Gegenstand (eine Nummer, gewünschte Menge), (c) Einzel-Gegenstand.
  const groupName = String(formData.get("groupName") ?? "").trim();
  let units: LoanUnit[];

  if (groupName) {
    const boardId = Number(formData.get("boardId"));
    const board = await getPublicInventoryBoardById(boardId);
    if (!board)
      return { error: "Dieses Inventar ist nicht öffentlich.", values };
    const quantity = Math.floor(Number(values.quantity));
    if (!Number.isFinite(quantity) || quantity < 1)
      return { error: "Bitte eine gültige Stückzahl wählen.", values };
    // Einheiten (nicht Datensätze!): ein Gruppenmitglied mit quantity > 1 kann
    // mehrere Einheiten beisteuern.
    const { units: groupUnits, available } = await getAvailableGroupUnits(
      board.id,
      groupName,
      quantity,
    );
    if (available < quantity) {
      return {
        error:
          available === 0
            ? "Von diesem Artikel ist aktuell nichts verfügbar."
            : `Aktuell sind nur ${available} Stück verfügbar.`,
        values,
      };
    }
    units = groupUnits;
  } else {
    const itemId = Number(formData.get("itemId"));
    const item = await getInventoryItemById(itemId);
    if (!item) return { error: "Gegenstand nicht gefunden.", values };
    const board = await getPublicInventoryBoardById(item.boardId);
    if (!board)
      return { error: "Dieses Inventar ist nicht öffentlich.", values };
    if (!item.lendable || item.condition !== "active")
      return { error: "Dieser Gegenstand ist nicht verfügbar.", values };
    if (item.quantity > 1) {
      // Mengen-Gegenstand: gewünschte Menge gegen die Verfügbarkeit prüfen.
      const avail = await getAvailableItemQuantity(item.id);
      const q = Math.floor(Number(values.quantity));
      if (!Number.isFinite(q) || q < 1)
        return { error: "Bitte eine gültige Stückzahl wählen.", values };
      if (q > avail) {
        return {
          error:
            avail === 0
              ? "Von diesem Gegenstand ist aktuell nichts verfügbar."
              : `Aktuell sind nur ${avail} Stück verfügbar.`,
          values,
        };
      }
      units = [{ itemId: item.id, quantity: q }];
    } else {
      units = [{ itemId: item.id, quantity: 1 }];
    }
  }

  // Datei erst jetzt schreiben (alle fachlichen Prüfungen sind durch). Schlägt
  // das Anlegen des Vorgangs fehl, räumt createLoanRequest die Datei wieder weg
  // — es bleibt keine halbfertige Anfrage ohne Ausweis zurück.
  let token: string;
  try {
    const saved = await saveNamedFile(
      join("inventory", String(units[0].itemId)),
      studentCardFile,
    );
    ({ token } = await createLoanRequest(
      units,
      {
        borrower: values.borrower,
        borrowerEmail: values.email,
        purpose: values.purpose || null,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
        notes: null,
      },
      saved,
    ));
  } catch (e) {
    if (e instanceof LoanCapacityError) {
      return {
        error:
          "Die gewünschte Menge wurde gerade vergeben. Bitte lade die Seite neu.",
        values,
      };
    }
    throw e;
  }

  // Außerhalb des try/catch: redirect() signalisiert über eine Exception.
  redirect(`/inventar/status/${token}`);
}
