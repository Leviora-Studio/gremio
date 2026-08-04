/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false, // kein "X-Powered-By: Next.js"-Leak
  // node-forge / @signpdf NICHT bundlen: gebündelt bricht node-forge zur
  // Laufzeit (Signieren schlägt fehl), obwohl der Build durchläuft. Als externe
  // Pakete werden sie im Standalone-Server normal aus node_modules geladen.
  serverExternalPackages: [
    "pg",
    "node-forge",
    // pdf-lib MUSS extern sein: @signpdf/placeholder-pdf-lib nutzt sein eigenes
    // pdf-lib aus node_modules. Würde unser pdf-lib gebündelt, gäbe es ZWEI
    // pdf-lib-Instanzen → der Signatur-Platzhalter passt nicht zusammen
    // ("No ByteRangeStrings found"). Extern = eine gemeinsame Instanz.
    "pdf-lib",
    "@signpdf/signpdf",
    "@signpdf/signer-p12",
    "@signpdf/placeholder-pdf-lib",
    "@signpdf/utils",
  ],
  // Swagger-UI-Assets werden zur Laufzeit aus node_modules gelesen (Route
  // /api/public/docs/assets/[file]). Ohne diesen Hinweis nimmt der
  // Standalone-Output sie nicht mit, weil sie nirgends importiert werden.
  outputFileTracingIncludes: {
    // Swagger-Assets stehen nicht im Import-Graph (werden zur Laufzeit gelesen)
    // — beide Asset-Routen brauchen sie deshalb explizit im Standalone-Output.
    "/api/docs/assets/[file]": [
      "./node_modules/swagger-ui-dist/swagger-ui.css",
      "./node_modules/swagger-ui-dist/swagger-ui-bundle.js",
      "./node_modules/swagger-ui-dist/swagger-ui-standalone-preset.js",
    ],
    "/api/public/docs/assets/[file]": [
      "./node_modules/swagger-ui-dist/swagger-ui.css",
      "./node_modules/swagger-ui-dist/swagger-ui-bundle.js",
      "./node_modules/swagger-ui-dist/swagger-ui-standalone-preset.js",
    ],
  },
  experimental: {
    serverActions: {
      // Einzige bewusste Grenze ist MAX_UPLOAD_BYTES (25 MB pro Datei). Das
      // öffentliche Formular sendet bis zu 4 Dateien in EINER Server-Action;
      // das Body-Limit muss die Summe großzügig abdecken, sonst würde Next.js
      // die Anfrage VOR dem Action-Code abweisen (generischer Abbruch statt
      // freundlicher Pro-Datei-Meldung). Bewusst hoch gewählt (≫ 4×25 MB), damit
      // praktisch kein Gesamtlimit greift.
      bodySizeLimit: "150mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Clickjacking-Schutz (interne Seiten mit sensiblen Daten).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Kein MIME-Sniffing (greift auch für ausgelieferte Anhänge).
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
