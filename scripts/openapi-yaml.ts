// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { openApiPublicSpec } from "../lib/openapi-public";

// ---------------------------------------------------------------------------
// Schreibt docs/openapi-public.yaml aus der EINZIGEN Quelle lib/openapi-public.ts.
// Die YAML-Datei ist damit versioniert im Repo, wird aber nicht von Hand
// gepflegt — so können Spezifikation und Implementierung nicht auseinanderlaufen.
//
//   npm run openapi:yaml
// ---------------------------------------------------------------------------

const target = join(process.cwd(), "docs", "openapi-public.yaml");
const header =
  "# GENERIERT — nicht von Hand bearbeiten.\n" +
  "# Quelle: lib/openapi-public.ts · neu erzeugen mit `npm run openapi:yaml`\n";

writeFileSync(
  target,
  header + stringify(openApiPublicSpec, { lineWidth: 100 }),
  "utf8",
);
console.log(`✅ ${target} geschrieben.`);
