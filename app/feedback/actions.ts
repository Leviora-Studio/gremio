// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { redirect } from "next/navigation";
import {
  checkFormTiming,
  FORM_GUARD_EXPIRED_MESSAGE,
  isHoneypotFilled,
  makeFormGuard,
} from "@/lib/antispam";
import { allowFormRequest, FEEDBACK_FORM_RATE_LIMIT } from "@/lib/rate-limit";
import { submitPublicFeedback } from "@/lib/public-feedback-submission";
import { publicBaseUrl } from "@/lib/public-api";

export type FeedbackValues = {
  areaId: string;
  submitterName: string;
  feedback: string;
};
// Eingaben werden bei einem Fehler zurückgegeben, damit das Formular sie behält
// (ein langer Freitext soll nie verloren gehen). `guard` ist ein FRISCHES
// Zeitfallen-Token: Ohne das behielte das Formular sein abgelaufenes Token, und
// der zweite Versuch scheiterte genauso — der Hinweis „bitte erneut absenden"
// wäre eine Sackgasse.
export type FeedbackState = {
  error?: string;
  ok?: boolean;
  values?: FeedbackValues;
  guard?: { ts: string; sig: string };
};

/**
 * Öffentliche Feedback-Einreichung über das Browserformular.
 *
 * Enthält NUR das Formularspezifische — Rate-Limit, Honeypot, signierte
 * Zeitfalle und Redirect. Die Fachlogik liegt in `submitPublicFeedback()` und
 * wird identisch von der öffentlichen API genutzt.
 */
export async function submitFeedbackAction(
  _prev: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const values: FeedbackValues = {
    areaId: String(formData.get("areaId") ?? ""),
    submitterName: String(formData.get("submitterName") ?? ""),
    feedback: String(formData.get("feedback") ?? ""),
  };

  // Eigener Scope: beeinflusst weder das Antragsformular ("submit") noch die
  // öffentliche API ("public-api-*"). Feedback hat ein höheres Limit als die
  // übrigen Formulare — identisch zum API-Weg.
  if (!(await allowFormRequest("feedback-submit", FEEDBACK_FORM_RATE_LIMIT))) {
    return {
      error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
      values,
    };
  }

  // Spam-Schutz wie beim Antragsformular. Honeypot und „zu schnell ausgefüllt"
  // werden still verworfen (gefälschte „Danke"-Bestätigung), ohne dass etwas
  // angelegt wird — der Bot soll nicht lernen, woran er scheitert.
  const timing = await checkFormTiming(formData.get("ts"), formData.get("sig"));
  if (isHoneypotFilled(formData.get("website")) || timing === "too_fast") {
    return { ok: true };
  }
  // Abgelaufenes/fremdes Token trifft dagegen auch echte Nutzer (zu lange
  // offener Tab, Netzwechsel). Hier wäre eine stille Fake-Bestätigung fatal:
  // Sie würfe den getippten Freitext weg und behauptete, er sei angekommen.
  if (timing === "invalid") {
    return {
      error: FORM_GUARD_EXPIRED_MESSAGE,
      values,
      guard: await makeFormGuard(),
    };
  }

  const result = await submitPublicFeedback(values, {
    activityDetail: "Feedback über das öffentliche Formular eingereicht",
  });

  if (!result.ok) {
    // `aborted` kann hier nicht auftreten (das Formular nutzt keine Hooks).
    return {
      error: result.reason === "aborted" ? "Ungültige Eingabe." : result.message,
      values,
    };
  }

  redirect(`${publicBaseUrl()}/feedback/status/${result.token}`);
}
