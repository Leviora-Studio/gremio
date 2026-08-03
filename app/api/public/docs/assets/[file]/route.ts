// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Liefert die Swagger-UI-Assets aus der Projektabhängigkeit `swagger-ui-dist`
 * aus — bewusst KEIN CDN, damit die Doku ohne externe Anfragen funktioniert.
 *
 * Die erlaubten Dateien sind eine feste Whitelist: `[file]` ist nutzerkontrol-
 * liert, und ein freier Pfad würde beliebiges Lesen unterhalb von node_modules
 * erlauben (Path Traversal).
 */
const ALLOWED: Record<string, string> = {
  "swagger-ui.css": "text/css; charset=utf-8",
  "swagger-ui-bundle.js": "application/javascript; charset=utf-8",
  "swagger-ui-standalone-preset.js": "application/javascript; charset=utf-8",
};

/**
 * Kandidaten für das Paketverzeichnis. Im Standalone-Output liegen dank
 * `outputFileTracingIncludes` nur die drei Asset-Dateien unter
 * `node_modules/swagger-ui-dist` — OHNE die package.json des Pakets. Deshalb
 * zuerst der direkte Pfad relativ zum Arbeitsverzeichnis; `require.resolve`
 * (das die package.json bräuchte) bleibt nur Rückfallebene für ungewöhnliche
 * Layouts.
 */
function swaggerDistDirs(): string[] {
  const dirs = [join(process.cwd(), "node_modules", "swagger-ui-dist")];
  try {
    const require = createRequire(import.meta.url);
    dirs.push(dirname(require.resolve("swagger-ui-dist/package.json")));
  } catch {
    /* Paket nicht auflösbar — der direkte Pfad greift. */
  }
  return dirs;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const contentType = ALLOWED[file];
  if (!contentType) return new Response("Not found", { status: 404 });

  let buf: Buffer | null = null;
  for (const dir of swaggerDistDirs()) {
    try {
      buf = await readFile(join(dir, file));
      break;
    } catch {
      /* nächsten Kandidaten probieren */
    }
  }
  if (!buf) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.length),
      "X-Content-Type-Options": "nosniff",
      // Versionierte Abhängigkeit — darf lange gecacht werden.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
