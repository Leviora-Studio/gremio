// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

/**
 * Gemeinsame Bausteine für die Swagger-UIs (öffentlich UND intern).
 *
 * Beide Oberflächen teilen sich Seitengerüst und Asset-Auslieferung; nur Titel,
 * Spezifikations-URL und Zugriffsschutz unterscheiden sich. Die Assets kommen
 * aus der Projektabhängigkeit `swagger-ui-dist` — bewusst KEIN CDN, damit die
 * Doku ohne externe Anfragen funktioniert (und die CSP nichts durchlassen muss).
 */

/** Neutrale, von beiden UIs nutzbare Asset-Basis. */
export const SWAGGER_ASSET_BASE = "/api/docs/assets";

/**
 * Erlaubte Asset-Dateien als feste Whitelist: der Pfadparameter ist
 * nutzerkontrolliert, und ein freier Pfad erlaubte beliebiges Lesen unterhalb
 * von node_modules (Path Traversal).
 */
const ALLOWED_ASSETS: Record<string, string> = {
  "swagger-ui.css": "text/css; charset=utf-8",
  "swagger-ui-bundle.js": "application/javascript; charset=utf-8",
  "swagger-ui-standalone-preset.js": "application/javascript; charset=utf-8",
};

/**
 * Kandidaten für das Paketverzeichnis. Im Standalone-Output liegen dank
 * `outputFileTracingIncludes` nur die drei Asset-Dateien unter
 * `node_modules/swagger-ui-dist` — OHNE die package.json des Pakets. Deshalb
 * zuerst der direkte Pfad relativ zum Arbeitsverzeichnis; `require.resolve`
 * (das die package.json bräuchte) bleibt nur Rückfallebene.
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

/**
 * Liefert eine Swagger-UI-Asset-Datei aus. Enthält selbst KEINE Spezifikation
 * und keine internen Daten — deshalb darf sie ohne Anmeldung abrufbar sein
 * (die interne Doku-Seite und die interne openapi.json sind es nicht).
 */
export async function serveSwaggerAsset(file: string): Promise<Response> {
  // `Object.hasOwn` statt Index-Zugriff: Ein Objektliteral erbt von
  // Object.prototype, `ALLOWED_ASSETS["constructor"]` lieferte also den
  // Function-Konstruktor — ein wahrheitswerter Treffer, der als Content-Type
  // weiterverwendet worden wäre. Dasselbe gilt für "toString", "valueOf" und
  // die übrigen geerbten Namen; der Pfadparameter ist nutzerkontrolliert.
  if (!Object.hasOwn(ALLOWED_ASSETS, file)) {
    return new Response("Not found", { status: 404 });
  }
  const contentType = ALLOWED_ASSETS[file];

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

/** Kleines HTML-Escaping für die wenigen eingesetzten Werte. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wert für die Einbettung in einen `<script>`-Block.
 *
 * `JSON.stringify` allein genügt dafür NICHT: Es lässt `<` unverändert, und ein
 * enthaltenes `</script>` beendet den Block mitten im String — der Rest wäre
 * Markup. Die Werte hier stammen zwar aus dem Code und nicht von außen, aber
 * eine Einbettung, die nur wegen ihrer Aufrufer sicher ist, bleibt eine
 * Stolperfalle für die nächste Änderung.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Seitengerüst der Swagger UI. `specUrl` wird von der Oberfläche per fetch
 * geladen — same-origin, sodass die Session-Cookies der internen Doku
 * automatisch mitgehen.
 *
 * `persistAuthorization` hält den im „Authorize"-Dialog eingegebenen API-Token
 * nur im localStorage des Browsers. Serverseitig wird NIE ein Token erzeugt,
 * eingebettet oder gespeichert.
 */
export function swaggerHtml(opts: {
  title: string;
  specUrl: string;
  /** Optionaler Hinweisstreifen über der Oberfläche (z. B. „intern"). */
  notice?: string;
}): string {
  const notice = opts.notice
    ? `<div class="notice">${esc(opts.notice)}</div>`
    : "";
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(opts.title)}</title>
    <link rel="stylesheet" href="${SWAGGER_ASSET_BASE}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
      .notice {
        background: #1e293b; color: #e2e8f0; padding: .6rem 1rem;
        font: 500 .875rem/1.4 system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    ${notice}
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_ASSET_BASE}/swagger-ui-bundle.js"></script>
    <script src="${SWAGGER_ASSET_BASE}/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${jsonForScript(opts.specUrl)},
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout",
        tryItOutEnabled: true,
        defaultModelsExpandDepth: 1,
        persistAuthorization: true,
      });
    </script>
  </body>
</html>`;
}
