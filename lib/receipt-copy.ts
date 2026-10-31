// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
/** Shared student-facing wording for PDF, plain-text and HTML receipts. */
export function receiptCopy(kind:"application"|"inventory"|"feedback"){
  return {
    headline:kind==="inventory"?"Deine Inventaranfrage ist angekommen":kind==="feedback"?"Dein Feedback ist angekommen":"Dein Antrag ist angekommen",
    greeting:"Hallo!",
    introduction:kind==="inventory"?"Danke für deine Inventaranfrage! Wir haben sie erhalten und schauen sie uns an.":kind==="feedback"?"Danke für dein Feedback! Schön, dass du deine Ideen und Anliegen mit uns teilst. Deine Nachricht ist bei uns angekommen.":"Danke für deinen Antrag! Wir haben ihn erhalten und schauen ihn uns an.",
    statusHeading:"So geht es weiter",
    statusText:"Mit deinem persönlichen Status-Link kannst du nachsehen, wie der aktuelle Stand ist:",
    attachmentText:"Deine Empfangsbestätigung findest du als PDF im Anhang.",
    privacyText:"Behalte den Link bitte für dich, denn damit lässt sich deine Einreichung aufrufen.",
    closing:"Viele Grüße",
    disclaimer:"Diese Bestätigung zeigt dir, dass deine Einreichung angekommen ist. Über den Inhalt ist damit noch nicht entschieden.",
  };
}
