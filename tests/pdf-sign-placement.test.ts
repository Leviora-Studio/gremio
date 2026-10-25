// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import { placeVisibleBox } from "../lib/pdf-edit";
import { drawSignatureBox } from "../lib/sign";

/**
 * Regression: Die Signatur-Box wurde in ungedrehten Seitenkoordinaten berechnet
 * und gezeichnet. Auf um 90°/180°/270° gedrehten Seiten landete sie an einer
 * anderen Stelle als im Browser aufgezogen, und Name/Datum standen seitlich.
 */

const apply = (m: number[], x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

async function rotatedPage(rotation: number) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.setRotation(degrees(rotation));
  return { doc, page };
}

// Erwartung je Drehung für eine 100×40-pt-Box oben links auf der SICHTBAREN Seite:
// Annotations-Rechteck sowie Richtung von „rechts" und „oben" der Box im PDF.
const cases = [
  { rotation: 0, visible: [600, 800], rect: { x: 0, y: 760, width: 100, height: 40 }, right: { x: 1, y: 0 }, up: { x: 0, y: 1 } },
  { rotation: 90, visible: [800, 600], rect: { x: 0, y: 0, width: 40, height: 100 }, right: { x: 0, y: 1 }, up: { x: -1, y: 0 } },
  { rotation: 180, visible: [600, 800], rect: { x: 500, y: 0, width: 100, height: 40 }, right: { x: -1, y: 0 }, up: { x: 0, y: -1 } },
  { rotation: 270, visible: [800, 600], rect: { x: 560, y: 700, width: 40, height: 100 }, right: { x: 0, y: -1 }, up: { x: 1, y: 0 } },
];

for (const c of cases) {
  test(`signature box lands where it was drawn and reads upright (rotation ${c.rotation}°)`, async () => {
    const { page } = await rotatedPage(c.rotation);
    const placement = { xRatio: 0, yRatio: 0, wRatio: 100 / c.visible[0], hRatio: 40 / c.visible[1] };
    const box = placeVisibleBox(page, placement, { width: 60, height: 28 });
    for (const k of ["x", "y", "width", "height"] as const) {
      assert.ok(Math.abs(box.rect[k] - c.rect[k]) < 1e-6, `${k}: ${box.rect[k]} ≠ ${c.rect[k]}`);
    }
    const o = apply(box.matrix, 0, 0);
    const right = apply(box.matrix, 1, 0);
    const up = apply(box.matrix, 0, 1);
    assert.deepEqual([Math.round(right.x - o.x), Math.round(right.y - o.y)], [c.right.x, c.right.y]);
    assert.deepEqual([Math.round(up.x - o.x), Math.round(up.y - o.y)], [c.up.x, c.up.y]);
    // Gegenüberliegende Ecke der lokalen Box liegt im Annotations-Rechteck.
    const far = apply(box.matrix, box.width, box.height);
    assert.ok(far.x >= box.rect.x - 1e-6 && far.x <= box.rect.x + box.rect.width + 1e-6);
    assert.ok(far.y >= box.rect.y - 1e-6 && far.y <= box.rect.y + box.rect.height + 1e-6);
  });
}

test("signature box follows the CropBox and stays on the visible page", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.setCropBox(100, 50, 400, 600);
  const rect = await drawSignatureBox(doc, page, { page: 0, xRatio: 0.95, yRatio: 0.98, wRatio: 0.25, hRatio: 0.1 }, {
    signerName: "Łukasz Müller", dateLabel: "25.10.2026, 10:00 Uhr", reason: "Freigabe\nZeile 2",
  });
  const [x1, y1, x2, y2] = rect;
  assert.ok(x1 >= 100 && x2 <= 500 + 1e-6, "inside the CropBox horizontally");
  assert.ok(y1 >= 50 - 1e-6 && y2 <= 650, "inside the CropBox vertically");
  assert.ok((await doc.save()).length > 0, "drawing with non-Latin-1 names and line breaks succeeds");
});
