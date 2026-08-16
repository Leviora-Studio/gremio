// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import {
  checkFormTiming,
  FORM_GUARD_EXPIRED_MESSAGE,
  isHoneypotFilled,
  makeFormGuard,
} from "@/lib/antispam";
import { allowFormRequest } from "@/lib/rate-limit";
import { submitPublicApplication } from "@/lib/public-application-submission";

// `guard` ist ein FRISCHES Zeitfallen-Token. Das Formular behält seine Eingaben
// und Dateien über einen Fehler hinweg (siehe PublicAntragForm) — ohne neues
// Token behielte es aber auch das abgelaufene, und der zweite Versuch
// scheiterte genauso.
export type SubmitState = {
  error?: string;
  ok?: boolean;
  guard?: { ts: string; sig: string };
};

/**
 * Öffentliches Antragsformular (Browser).
 *
 * Die FACHLICHE Einreichung liegt in `lib/public-application-submission.ts` und
 * wird mit der öffentlichen API geteilt. Hier bleiben nur die formularspezifi-
 * schen Schutzmaßnahmen: Rate-Limit, Honeypot, signierte Zeitfalle — und der
 * Redirect auf die Statusseite.
 */
export async function submitAntragAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  // Ratenbegrenzung pro Client (gegen Massen-Einreichungen / Disk-Fill).
  // Eigener Scope — die öffentliche API nutzt bewusst getrennte Buckets.
  if (!(await allowFormRequest("submit"))) {
    return { error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut." };
  }
  // Spam-Schutz: Honeypot + signierte Zeitfalle. Honeypot und „zu schnell
  // ausgefüllt" werden still verworfen (gefälschte „Danke"-Bestätigung), ohne
  // dass etwas angelegt wird.
  const timing = await checkFormTiming(formData.get("ts"), formData.get("sig"));
  if (isHoneypotFilled(formData.get("website")) || timing === "too_fast") {
    return { ok: true };
  }
  // Abgelaufenes/fremdes Token trifft dagegen auch echte Nutzer (zu lange
  // offener Tab, Netzwechsel). Sichtbare Meldung statt stiller Fake-Bestätigung:
  // Sonst hielte der Antragsteller einen nie angelegten Antrag für eingereicht.
  if (timing === "invalid") {
    return { error: FORM_GUARD_EXPIRED_MESSAGE, guard: await makeFormGuard() };
  }

  const result = await submitPublicApplication(
    {
      locationId: formData.get("locationId"),
      title: formData.get("title"),
      applicant: formData.get("applicant"),
      files: {
        finance_request: formData.get("finance_request"),
        student_card: formData.get("student_card"),
        annex_a: formData.get("annex_a"),
        annex_b: formData.get("annex_b"),
      },
    },
    { activityDetail: "Antrag über das öffentliche Formular eingereicht" },
  );

  if (!result.ok) {
    // `aborted` kann hier nicht auftreten (kein preflightTx übergeben).
    return { error: "message" in result ? result.message : "Ungültige Eingabe." };
  }

  redirect(`/status/${result.token}`);
}
