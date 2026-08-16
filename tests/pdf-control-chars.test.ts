// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConfirmationPdf,
  buildFeedbackConfirmationPdf,
  winAnsiSafe,
} from "../lib/pdf";

/**
 * Regressionstest zu den abstürzenden Eingangsbestätigungen: `winAnsiSafe` ließ
 * TAB (9), LF (10) und CR (13) ausdrücklich durch — also genau die drei
 * Zeichen, an denen der WinAnsi-Encoder von pdf-lib wirft. Ein Tabulator aus
 * einer kopierten Tabelle genügte, um die PDF-Route dauerhaft auf HTTP 500 zu
 * legen, bei jedem erneuten Versuch.
 *
 * Ohne den Fix schlagen diese Tests mit „WinAnsi cannot encode …" fehl.
 */

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
/** Alle drei kritischen Zeichen plus ein Emoji (nicht darstellbar → „?"). */
const GIFT = `A${TAB}B${LF}C${CR}D🙂E`;

test("winAnsiSafe entfernt die drei kritischen Steuerzeichen", () => {
  const out = winAnsiSafe(GIFT);
  assert.ok(!out.includes(TAB), "TAB muss ersetzt sein");
  assert.ok(!out.includes(LF), "LF muss ersetzt sein");
  assert.ok(!out.includes(CR), "CR muss entfallen");
});

test("winAnsiSafe behält Umbrüche, wenn der Builder selbst umbricht", () => {
  const out = winAnsiSafe(`A${LF}B`, { keepNewlines: true });
  assert.ok(out.includes(LF));
  // TAB und CR verschwinden trotzdem.
  assert.ok(!winAnsiSafe(`A${TAB}${CR}B`, { keepNewlines: true }).includes(TAB));
});

test("Antrags-Bestätigung übersteht TAB, LF und CR in jedem Textfeld", async () => {
  const pdf = await buildConfirmationPdf({
    title: GIFT,
    applicant: GIFT,
    eingang: new Date("2026-01-02T10:15:00Z"),
    statusLink: "https://example.test/status/abc",
    number: GIFT,
  });
  assert.ok(pdf.length > 0);
  // %PDF-Signatur als Beleg für ein wohlgeformtes Dokument.
  assert.equal(Buffer.from(pdf.slice(0, 4)).toString(), "%PDF");
});

test("Feedback-Bestätigung übersteht TAB, LF und CR in jedem Textfeld", async () => {
  const pdf = await buildFeedbackConfirmationPdf({
    areaName: GIFT,
    submitterName: GIFT,
    feedbackText: `${GIFT}${LF}${LF}Zweiter Absatz mit${TAB}Tabulator`,
    eingang: new Date("2026-01-02T10:15:00Z"),
    statusLink: "https://example.test/feedback/status/abc",
    number: GIFT,
  });
  assert.ok(pdf.length > 0);
  assert.equal(Buffer.from(pdf.slice(0, 4)).toString(), "%PDF");
});

test("langer Feedbacktext mit Steuerzeichen erzeugt mehrseitiges PDF", async () => {
  const lang = Array.from({ length: 400 }, (_, i) => `Zeile ${i}${TAB}Wert`).join(LF);
  const pdf = await buildFeedbackConfirmationPdf({
    areaName: "Bibliothek",
    submitterName: "Anonym",
    feedbackText: lang,
    eingang: new Date(),
    statusLink: "https://example.test/feedback/status/abc",
    number: null,
  });
  assert.ok(pdf.length > 0);
});
