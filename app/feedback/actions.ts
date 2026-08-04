// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { isHoneypotFilled, isHumanTiming } from "@/lib/antispam";
import { allowRequest } from "@/lib/rate-limit";
import { submitPublicFeedback } from "@/lib/public-feedback-submission";

export type FeedbackValues = {
  areaId: string;
  submitterName: string;
  feedback: string;
};
// Eingaben werden bei einem Fehler zurückgegeben, damit das Formular sie behält
// (ein langer Freitext soll nie verloren gehen).
export type FeedbackState = { error?: string; ok?: boolean; values?: FeedbackValues };

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
  // öffentliche API ("public-api-*").
  if (!(await allowRequest("feedback-submit", 10, 60_000))) {
    return {
      error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
      values,
    };
  }

  // Spam-Schutz wie beim Antragsformular: Bots werden still verworfen
  // (gefälschte „Danke"-Bestätigung), ohne dass etwas angelegt wird.
  if (
    isHoneypotFilled(formData.get("website")) ||
    !isHumanTiming(formData.get("ts"), formData.get("sig"))
  ) {
    return { ok: true };
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

  redirect(`/feedback/status/${result.token}`);
}
