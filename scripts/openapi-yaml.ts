// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { openApiPublicSpec } from "../lib/openapi-public";
import { openApiV1Spec } from "../lib/openapi-v1";

// ---------------------------------------------------------------------------
// Schreibt die versionierten YAML-Dateien aus den EINZIGEN Quellen
// lib/openapi-public.ts bzw. lib/openapi-v1.ts. Die YAML-Dateien liegen im
// Repo, werden aber nicht von Hand gepflegt — so können Spezifikation,
// ausgelieferte JSON und Implementierung nicht auseinanderlaufen.
//
//   npm run openapi:yaml            → beide
//   npm run openapi:public:yaml     → nur die öffentliche
//   npm run openapi:internal:yaml   → nur die interne
//
// Öffentliche und interne Spezifikation bleiben bewusst GETRENNTE Dokumente:
// Öffentliche Clients sollen keine internen Routen oder Modelle sehen.
// ---------------------------------------------------------------------------

type Target = { key: "public" | "internal"; file: string; source: string; spec: unknown };

const TARGETS: Target[] = [
  {
    key: "public",
    file: "openapi-public.yaml",
    source: "lib/openapi-public.ts",
    spec: openApiPublicSpec,
  },
  {
    key: "internal",
    file: "openapi-v1.yaml",
    source: "lib/openapi-v1.ts",
    spec: openApiV1Spec,
  },
];

// Ohne Argument beide; sonst nur die genannten (public|internal).
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const selected = wanted.length
  ? TARGETS.filter((t) => wanted.includes(t.key))
  : TARGETS;

if (!selected.length) {
  console.error(
    `Unbekanntes Ziel: ${wanted.join(", ")}. Erlaubt: public, internal.`,
  );
  process.exit(1);
}

for (const t of selected) {
  const target = join(process.cwd(), "docs", t.file);
  const header =
    "# GENERIERT — nicht von Hand bearbeiten.\n" +
    `# Quelle: ${t.source} · neu erzeugen mit \`npm run openapi:yaml\`\n`;
  // `stringify` ist für dieselbe Eingabe deterministisch (Schlüsselreihenfolge
  // aus dem Objekt) — wiederholte Läufe erzeugen also identische Dateien.
  writeFileSync(target, header + stringify(t.spec, { lineWidth: 100 }), "utf8");
  console.log(`✅ ${target} geschrieben.`);
}
