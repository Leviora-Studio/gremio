// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  priorities,
  locations,
  boardTemplates,
  boardTemplateStatuses,
} from "../lib/db/schema";
import { LOCATION_NAMES } from "../lib/constants";

// ---------------------------------------------------------------------------
// Beispiel-Startbestand (frei anpassbar). Legt an: 4 Beispiel-Standorte,
// 3 Prioritäten und das Board-Template "Antragsboard".
// Idempotent — bereits vorhandene Einträge werden übersprungen.
// Standorte werden DEAKTIVIERT und OHNE Ziel angelegt; Ziel-Board/-Spalte
// weist der Admin unter /admin/standorte zu (erst dann aktivierbar).
// ---------------------------------------------------------------------------

// --- Prioritäten: niedrig (grau), mittel (gelb), hoch (rot) ----------------
const PRIORITIES: { label: string; color: string }[] = [
  { label: "Niedrig", color: "slate" }, // grau
  { label: "Mittel", color: "amber" }, // gelb
  { label: "Hoch", color: "red" }, // rot
];

// --- Board-Template "Antragsboard" -----------------------------------------
const ANTRAGSBOARD_COLUMNS: { name: string; isArchiveTrigger?: boolean }[] = [
  { name: "Eingegangen" },
  { name: "Geplant für Sitzung" },
  { name: "Abgelehnt" },
  { name: "Warten auf Nachreichung" },
  { name: "Angenommen" },
  { name: "Quittungen erhalten" },
  { name: "Anweisung erfolgt", isArchiveTrigger: true },
];

async function seedLocations() {
  // Pro-Name idempotent (locations.name ist UNIQUE): nur fehlende anlegen,
  // damit auch ein unvollständiger Bestand sauber ergänzt wird.
  const existing = await db.select({ name: locations.name }).from(locations);
  const have = new Set(existing.map((r) => r.name));
  const missing = LOCATION_NAMES.filter((n) => !have.has(n));
  if (missing.length === 0) {
    console.log("• Standorte existieren bereits — übersprungen.");
    return;
  }
  // enabled = false (Default) und ohne Ziel — Admin weist Ziel-Board/-Spalte zu.
  await db
    .insert(locations)
    .values(missing.map((name, i) => ({ name, position: have.size + i })));
  console.log(
    `✅ ${missing.length} Standort(e) angelegt: ${missing.join(", ")} (deaktiviert, ohne Ziel — im Admin Ziel-Board/-Spalte zuweisen).`,
  );
}

async function seedPriorities() {
  const existing = await db.select({ id: priorities.id }).from(priorities).limit(1);
  if (existing.length) {
    console.log("• Prioritäten existieren bereits — übersprungen.");
    return;
  }
  await db.insert(priorities).values(
    PRIORITIES.map((p, i) => ({ label: p.label, color: p.color, position: i })),
  );
  console.log(`✅ ${PRIORITIES.length} Prioritäten angelegt.`);
}

async function seedAntragsboardTemplate() {
  const existing = await db
    .select({ id: boardTemplates.id })
    .from(boardTemplates)
    .where(eq(boardTemplates.name, "Antragsboard"))
    .limit(1);
  if (existing.length) {
    console.log("• Board-Template 'Antragsboard' existiert bereits — übersprungen.");
    return;
  }
  const [tpl] = await db
    .insert(boardTemplates)
    .values({ name: "Antragsboard", description: "Workflow für Anträge" })
    .returning();
  await db.insert(boardTemplateStatuses).values(
    ANTRAGSBOARD_COLUMNS.map((c, i) => ({
      templateId: tpl.id,
      name: c.name,
      position: i,
      isArchiveTrigger: !!c.isArchiveTrigger,
    })),
  );
  console.log(
    `✅ Board-Template 'Antragsboard' mit ${ANTRAGSBOARD_COLUMNS.length} Spalten angelegt.`,
  );
}

async function main() {
  await seedLocations();
  await seedPriorities();
  await seedAntragsboardTemplate();
  console.log("🌱 Seed abgeschlossen.");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Seed fehlgeschlagen:", err);
  process.exit(1);
});
