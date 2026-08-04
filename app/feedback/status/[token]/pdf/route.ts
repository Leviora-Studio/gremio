// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { env } from "@/lib/env";
import { buildFeedbackConfirmationPdf } from "@/lib/pdf";
import { getFeedbackByToken } from "@/lib/public-feedback-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Eingangsbestätigung eines Feedbacks. Nutzt ausschließlich die unveränderlichen
 * Snapshot-Daten aus `feedback_submissions` — spätere interne Änderungen an der
 * Karte verändern die bereits ausgestellte Bestätigung also nicht.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const fb = await getFeedbackByToken(token);
  // Kein Feedback zu diesem Token (oder ein Antrags-Token) → 404.
  if (!fb) return new Response("Not found", { status: 404 });

  const pdf = await buildFeedbackConfirmationPdf({
    areaName: fb.areaName,
    submitterName: fb.submitterName,
    feedbackText: fb.feedbackText,
    eingang: fb.createdAt,
    statusLink: `${env.APP_BASE_URL}/feedback/status/${token}`,
    number: fb.number,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="feedback-eingangsbestaetigung.pdf"`,
      // Enthält Name und Feedbacktext — nicht in Caches ablegen.
      "Cache-Control": "private, no-store",
    },
  });
}
