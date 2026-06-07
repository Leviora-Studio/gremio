/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false, // kein "X-Powered-By: Next.js"-Leak
  serverExternalPackages: ["pg"],
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
