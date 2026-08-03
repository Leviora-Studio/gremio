// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Interaktive Swagger UI der öffentlichen API. Darf öffentlich erreichbar sein
 * — die dokumentierten Endpunkte sind es ebenfalls.
 *
 * CSS/JS kommen aus `/api/public/docs/assets/…` (Projektabhängigkeit
 * `swagger-ui-dist`), NICHT von einem CDN. Datei-Uploads über „Try it out"
 * funktionieren, weil das Schema `format: binary` verwendet.
 */
const PAGE = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gremio — Öffentliche API</title>
    <link rel="stylesheet" href="/api/public/docs/assets/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api/public/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/api/public/docs/assets/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/api/public/v1/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout",
        tryItOutEnabled: true,
        defaultModelsExpandDepth: 1,
      });
    </script>
  </body>
</html>`;

export async function GET() {
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
