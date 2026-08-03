// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { MAX_IDEMPOTENCY_KEY_LENGTH } from "@/lib/public-api-idempotency";
import {
  RL_LOCATIONS,
  RL_SUBMIT_BURST,
  RL_SUBMIT_DAY,
} from "@/lib/public-api";

/**
 * OpenAPI 3.1 der ÖFFENTLICHEN API — EINZIGE Quelle.
 *
 * `GET /api/public/v1/openapi.json` liefert dieses Dokument direkt aus;
 * `docs/openapi-public.yaml` wird daraus per `npm run openapi:yaml` erzeugt.
 * So gibt es keine zwei getrennt gepflegten Definitionen, und Grenzwerte
 * (Uploadlimit, Rate-Limits, Key-Länge) stammen aus denselben Konstanten wie
 * die Implementierung.
 *
 * Hier stehen AUSSCHLIESSLICH die öffentlichen Endpunkte — die
 * Bearer-Token-API unter /api/v1 gehört bewusst nicht hinein.
 */

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

const IDEMPOTENCY_DESCRIPTION = `Pflicht. Eindeutiger Schlüssel dieser Einreichung — empfohlen ist eine UUID v4.

* Für **jeden neuen Antrag** einen **neuen** Schlüssel erzeugen.
* Bei einem **Retry** (Timeout, Netzwerkfehler) denselben Schlüssel mit **identischen Daten** erneut senden — die Antwort ist dann \`200\` mit \`Idempotency-Replayed: true\` und es entsteht **keine** zweite Karte.
* Derselbe Schlüssel mit **veränderten Daten** führt zu \`409 Conflict\`.

Zulässig ist druckbares ASCII mit 16–${MAX_IDEMPOTENCY_KEY_LENGTH} Zeichen. Gespeichert wird nur ein SHA-256-Hash, nie der Klartext.`;

const rateLimitResponse = {
  description: `Rate-Limit erreicht. Grenzen: ${RL_SUBMIT_BURST.limit} Einreichungen pro IP und Minute, ${RL_SUBMIT_DAY.limit} pro IP und 24 h, ${RL_LOCATIONS.limit} Standort-Abrufe pro IP und Minute. Getrennte Buckets; das Limit des Browserformulars bleibt davon unberührt.`,
  headers: {
    "Retry-After": {
      description: "Sekunden bis zum nächsten zulässigen Versuch.",
      schema: { type: "integer" },
    },
  },
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
  },
} as const;

const errorResponse = (description: string) =>
  ({
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
      },
    },
  }) as const;

export const openApiPublicSpec = {
  openapi: "3.1.0",
  info: {
    title: "Gremio — Öffentliche API",
    version: "1.0.0",
    summary: "Antragseinreichung für native Android-/iOS-Clients.",
    description: `Öffentliche, **nicht authentifizierte** API zum Einreichen von Anträgen.

Sie ist für **direkte native Clients** (Android/iOS) gedacht — es gibt keinen zwischengeschalteten Backend-Server und keine API-Authentifizierung. Native Clients unterliegen keinem Browser-CORS, deshalb setzt diese API **bewusst keine CORS-Header**. Aus einem Webbrowser heraus ist sie damit nicht cross-origin nutzbar.

**Status-Link:** Die Antwort enthält \`statusUrl\` — einen geheimen Link, der wie ein Bearer-Token wirkt. Wer ihn besitzt, sieht den öffentlichen Antragsstatus. Die App muss ihn lokal speichern und vertraulich behandeln (nicht loggen, nicht teilen). Er wird nicht per E-Mail verschickt und lässt sich nicht wiederherstellen.

**Uploads:** max. ${MAX_UPLOAD_MB} MB pro Datei. Der Studierendenausweis wird ausschließlich intern verarbeitet und ist über die öffentliche Statusseite nicht abrufbar.`,
    license: {
      name: "AGPL-3.0-or-later",
      identifier: "AGPL-3.0-or-later",
    },
  },
  servers: [
    { url: "/", description: "Diese Instanz" },
  ],
  tags: [
    {
      name: "Öffentliche Antragstellung",
      description: "Standorte abrufen und Anträge einreichen.",
    },
  ],
  paths: {
    "/api/public/v1/locations": {
      get: {
        tags: ["Öffentliche Antragstellung"],
        summary: "Auswählbare Standorte abrufen",
        description:
          "Liefert genau die Standorte, die auch im öffentlichen Formular zur Auswahl stehen: aktiviert und vollständig geroutet (Ziel-Board und Zielspalte vorhanden, Zielspalte gehört zum Ziel-Board). Reihenfolge wie im Formular.",
        operationId: "listPublicLocations",
        security: [],
        responses: {
          "200": {
            description: "Liste der auswählbaren Standorte.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PublicLocationsResponse",
                },
                examples: {
                  standard: {
                    value: {
                      locations: [
                        { id: 1, name: "Standort A" },
                        { id: 4, name: "Zentrale" },
                      ],
                    },
                  },
                },
              },
            },
          },
          "429": rateLimitResponse,
          "500": errorResponse("Unerwarteter interner Fehler."),
        },
      },
    },
    "/api/public/v1/applications": {
      post: {
        tags: ["Öffentliche Antragstellung"],
        summary: "Antrag einreichen",
        description: `Reicht einen Antrag als \`multipart/form-data\` ein und legt ihn im Ziel-Board des gewählten Standorts an.

**Empfohlener Ablauf in der App**

1. Für einen neuen Antragsentwurf eine UUID als \`Idempotency-Key\` erzeugen.
2. Key und Entwurf lokal auf dem Gerät speichern.
3. Antrag absenden.
4. Bei Timeout oder Netzwerkfehler denselben Key und dieselben Daten erneut senden.
5. Erst nach erfolgreicher Antwort den Status-Link speichern und den Entwurf als abgeschlossen markieren.
6. Für einen wirklich neuen Antrag einen neuen Key erzeugen.
7. Niemals denselben Key für unterschiedliche Anträge verwenden.`,
        operationId: "createPublicApplication",
        security: [],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description: IDEMPOTENCY_DESCRIPTION,
            schema: {
              type: "string",
              minLength: 16,
              maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
              examples: ["550e8400-e29b-41d4-a716-446655440000"],
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                $ref: "#/components/schemas/PublicApplicationRequest",
              },
              encoding: {
                finance_request: { contentType: "application/pdf" },
                student_card: {
                  contentType: "application/pdf, image/png, image/jpeg",
                },
                annex_a: { contentType: "application/pdf" },
                annex_b: { contentType: "application/pdf" },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Antrag wurde neu angelegt.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PublicApplicationResponse",
                },
                examples: {
                  standard: {
                    value: {
                      statusUrl: "https://gremio.example/status/abc123",
                      receiptPdfUrl: "https://gremio.example/status/abc123/pdf",
                      number: "A_0042_2026",
                    },
                  },
                },
              },
            },
          },
          "200": {
            description:
              "Idempotenz-Replay: derselbe Key mit identischen Daten. Es wurde nichts erneut angelegt; die Antwort entspricht der ursprünglichen Einreichung.",
            headers: {
              "Idempotency-Replayed": {
                description:
                  "Immer `true` — die Antwort stammt aus einer früheren Einreichung.",
                schema: { type: "string", enum: ["true"] },
              },
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PublicApplicationResponse",
                },
              },
            },
          },
          "400": {
            description:
              "Ungültige Eingabe, fehlende Pflichtdatei, unzulässiger Dateityp oder fehlender/ungültiger `Idempotency-Key`.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ValidationError" },
                examples: {
                  feld: {
                    value: {
                      error: "Bitte einen Antragsgegenstand angeben.",
                      issues: [
                        {
                          field: "title",
                          message: "Bitte einen Antragsgegenstand angeben.",
                        },
                      ],
                    },
                  },
                  idempotencyKey: {
                    value: {
                      error:
                        "Header 'Idempotency-Key' fehlt oder ist ungültig (druckbares ASCII, 16–128 Zeichen; empfohlen: UUID v4).",
                    },
                  },
                },
              },
            },
          },
          "404": errorResponse(
            "Der gewählte Standort existiert nicht, ist deaktiviert oder nicht vollständig geroutet.",
          ),
          "409": {
            description:
              "Der `Idempotency-Key` wurde bereits für eine andere Einreichung verwendet (abweichende Daten).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  standard: {
                    value: {
                      error:
                        "Der Idempotency-Key wurde bereits für eine andere Einreichung verwendet.",
                    },
                  },
                },
              },
            },
          },
          "413": errorResponse(
            `Eine Datei überschreitet ${MAX_UPLOAD_MB} MB oder der Gesamt-Request ist zu groß.`,
          ),
          "415": errorResponse(
            "Falscher Content-Type — erforderlich ist `multipart/form-data`.",
          ),
          "429": rateLimitResponse,
          "500": errorResponse(
            "Unerwarteter interner Fehler. Die Meldung ist bewusst generisch.",
          ),
        },
      },
    },
  },
  components: {
    schemas: {
      PublicLocation: {
        type: "object",
        description: "Ein auswählbarer Standort.",
        required: ["id", "name"],
        properties: {
          id: {
            type: "integer",
            description: "Wird als `locationId` beim Einreichen übergeben.",
            examples: [1],
          },
          name: { type: "string", examples: ["Standort A"] },
        },
      },
      PublicLocationsResponse: {
        type: "object",
        required: ["locations"],
        properties: {
          locations: {
            type: "array",
            items: { $ref: "#/components/schemas/PublicLocation" },
          },
        },
      },
      PublicApplicationRequest: {
        type: "object",
        required: ["locationId", "title", "applicant", "finance_request", "student_card"],
        properties: {
          locationId: {
            type: "integer",
            description:
              "ID eines Standorts aus `GET /api/public/v1/locations`.",
            examples: [1],
          },
          title: {
            type: "string",
            maxLength: 200,
            description: "Antragsgegenstand.",
            examples: ["Grillabend am FB5"],
          },
          applicant: {
            type: "string",
            maxLength: 200,
            description: "Name des Antragstellers.",
            examples: ["Max Mustermann"],
          },
          finance_request: {
            type: "string",
            format: "binary",
            description: `Finanzantrag. **Pflicht.** Nur PDF, max. ${MAX_UPLOAD_MB} MB.`,
          },
          student_card: {
            type: "string",
            format: "binary",
            description: `Studierendenausweis. **Pflicht.** PDF, PNG oder JPG, max. ${MAX_UPLOAD_MB} MB. Wird ausschließlich intern verarbeitet und ist über die öffentliche Statusseite nicht abrufbar.`,
          },
          annex_a: {
            type: "string",
            format: "binary",
            description: `Anlage A. Optional. Nur PDF, max. ${MAX_UPLOAD_MB} MB.`,
          },
          annex_b: {
            type: "string",
            format: "binary",
            description: `Anlage B. Optional. Nur PDF, max. ${MAX_UPLOAD_MB} MB.`,
          },
        },
      },
      PublicApplicationResponse: {
        type: "object",
        required: ["statusUrl", "receiptPdfUrl", "number"],
        properties: {
          statusUrl: {
            type: "string",
            format: "uri",
            description:
              "Geheimer öffentlicher Status-Link. Lokal speichern, vertraulich behandeln, nicht loggen — er ist der einzige Zugang zum Antrag.",
            examples: ["https://gremio.example/status/abc123"],
          },
          receiptPdfUrl: {
            type: "string",
            format: "uri",
            description: "Eingangsbestätigung als PDF (enthält denselben Token).",
            examples: ["https://gremio.example/status/abc123/pdf"],
          },
          number: {
            type: ["string", "null"],
            description:
              "Vergebene Antragsnummer, oder `null`, wenn die Nummerierung des Ziel-Boards deaktiviert ist.",
            examples: ["A_0042_2026"],
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "string",
            description: "Lesbare Fehlermeldung.",
          },
        },
      },
      ValidationError: {
        type: "object",
        required: ["error"],
        description:
          "Wie `ErrorResponse`, zusätzlich mit feldbezogenen Hinweisen.",
        properties: {
          error: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              required: ["field", "message"],
              properties: {
                field: { type: "string", examples: ["title"] },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type OpenApiPublicSpec = typeof openApiPublicSpec;
