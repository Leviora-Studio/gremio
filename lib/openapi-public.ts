// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { ATTACHMENT_KIND_LABELS, MAX_UPLOAD_BYTES } from "@/lib/constants";
import {
  IDEMPOTENCY_TTL_DAYS,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "@/lib/public-api-idempotency";
import {
  RL_FEEDBACK_AREAS,
  RL_FEEDBACK_BURST,
  RL_FEEDBACK_DAY,
  RL_LOCATIONS,
  RL_STATUS,
  RL_SUBMIT_BURST,
  RL_SUBMIT_DAY,
} from "@/lib/public-api";
import { MAX_STATUS_URL_LENGTH } from "@/lib/public-status-url";
import {
  ANONYMOUS_SUBMITTER,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_TITLE_MAX_LENGTH,
  SUBMITTER_NAME_MAX_LENGTH,
} from "@/lib/feedback-constants";

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
/** Body-Grenze des Feedback-Endpunkts — spiegelt MAX_BODY_BYTES der Route. */
const FEEDBACK_MAX_BODY_KIB = 32;

const IDEMPOTENCY_DESCRIPTION = `Pflicht. Eindeutiger Schlüssel dieser Einreichung — empfohlen ist eine UUID v4.

* Für **jeden neuen Antrag** einen **neuen** Schlüssel erzeugen.
* Bei einem **Retry** (Timeout, Netzwerkfehler) denselben Schlüssel mit **identischen Daten** erneut senden — die Antwort ist dann \`200\` mit \`Idempotency-Replayed: true\` und es entsteht **keine** zweite Karte.
* Derselbe Schlüssel mit **veränderten Daten** führt zu \`409 Conflict\`.

Zulässig ist druckbares ASCII mit 16–${MAX_IDEMPOTENCY_KEY_LENGTH} Zeichen. Gespeichert wird nur ein SHA-256-Hash, nie der Klartext.

Ein Schlüssel wird **${IDEMPOTENCY_TTL_DAYS} Tage** aufbewahrt. Danach verhält er sich wie ein neuer: Ein Retry nach Ablauf der Frist legt eine **zweite** Einreichung an (\`201\` statt \`200\`).`;

const rateLimitResponse = {
  description: `Rate-Limit erreicht. Grenzen: ${RL_SUBMIT_BURST.limit} Einreichungen pro IP und Minute, ${RL_SUBMIT_DAY.limit} pro IP und Stunde, ${RL_LOCATIONS.limit} Standort-Abrufe pro IP und Minute. Getrennte Buckets; das Limit des Browserformulars bleibt davon unberührt.`,
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

// Eigene Beschreibung: Feedback hat eigene Buckets und eigene Grenzen.
const feedbackRateLimitResponse = {
  description: `Rate-Limit erreicht. Grenzen: ${RL_FEEDBACK_BURST.limit} Einreichungen pro IP und Minute, ${RL_FEEDBACK_DAY.limit} pro IP und Stunde, ${RL_FEEDBACK_AREAS.limit} Bereichs-Abrufe pro IP und Minute. Vollständig getrennte Buckets — die Antrags-API und das Browserformular bleiben davon unberührt.`,
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

// Statusabfrage: eigener, großzügiger Bucket fürs Polling nativer Apps.
// Bewusst OHNE Tageslimit — viele Geräte teilen sich eine Carrier-NAT-IP.
const statusRateLimitResponse = {
  description: `Rate-Limit erreicht: ${RL_STATUS.limit} Statusabfragen pro IP und Minute. Eigener Bucket — Einreichungen und Bereichs-/Standortabrufe bleiben davon unberührt. Es gibt bewusst kein zusätzliches Tageslimit.`,
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
    // 1.1.0: rückwärtskompatible Erweiterung um POST /status (Minor).
    version: "1.1.0",
    summary:
      "Antrags- und Feedback-Einreichung für native Android-/iOS-Clients.",
    description: `Öffentliche, **nicht authentifizierte** API zum Einreichen von **Anträgen** und **Feedback**.

Sie ist für **direkte native Clients** (Android/iOS) gedacht — es gibt keinen zwischengeschalteten Backend-Server und keine API-Authentifizierung. Native Clients unterliegen keinem Browser-CORS, deshalb setzt diese API **bewusst keine CORS-Header**. Aus einem Webbrowser heraus ist sie damit nicht cross-origin nutzbar.

**Status-Link:** Die Antwort enthält \`statusUrl\` — einen geheimen Link, der wie ein Bearer-Token wirkt. Wer ihn besitzt, sieht die zugehörige öffentliche Statusansicht. Die App muss ihn lokal speichern und vertraulich behandeln (nicht loggen, nicht teilen). Er wird nicht per E-Mail verschickt und lässt sich nicht wiederherstellen. Anträge und Feedback haben getrennte Statusrouten (\`/status/…\` bzw. \`/feedback/status/…\`).

**Rate-Limits:** Anträge und Feedback haben vollständig getrennte Kontingente; das Browserformular wiederum ein eigenes.

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
    {
      name: "Öffentliches Feedback",
      description: "Feedback-Bereiche abrufen und Feedback einreichen.",
    },
    {
      name: "Öffentlicher Status",
      description:
        "Status eines Antrags oder Feedbacks anhand des Status-Links abrufen.",
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
    "/api/public/v1/feedback-areas": {
      get: {
        tags: ["Öffentliches Feedback"],
        summary: "Auswählbare Feedback-Bereiche abrufen",
        description:
          "Liefert genau die Bereiche, die auch im öffentlichen Feedback-Formular zur Auswahl stehen: aktiviert und vollständig geroutet (Ziel-Board und Zielspalte vorhanden, Zielspalte gehört zum Ziel-Board). Sortiert nach `position` aufsteigend.",
        operationId: "listPublicFeedbackAreas",
        security: [],
        responses: {
          "200": {
            description: "Liste der auswählbaren Bereiche.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FeedbackAreasResponse" },
                examples: {
                  standard: {
                    value: {
                      areas: [
                        { id: 1, name: "Bibliothek" },
                        { id: 2, name: "Mensa" },
                      ],
                    },
                  },
                },
              },
            },
          },
          "429": feedbackRateLimitResponse,
          "500": errorResponse("Unerwarteter interner Fehler."),
        },
      },
    },
    "/api/public/v1/feedback": {
      post: {
        tags: ["Öffentliches Feedback"],
        summary: "Feedback einreichen",
        description: `Reicht Feedback als \`application/json\` ein und legt es als Karte im Ziel-Board des gewählten Bereichs an.

Der Kartentitel wird automatisch aus dem Feedbacktext abgeleitet (gekürzt auf ${FEEDBACK_TITLE_MAX_LENGTH} Zeichen); der **vollständige** Text steht im Kartenfeld „Notizen" und unverändert in der öffentlichen Statusansicht.

**Empfohlener Ablauf in der App**

1. Bereiche über \`GET /api/public/v1/feedback-areas\` abrufen.
2. Für einen neuen Feedback-Entwurf eine UUID als \`Idempotency-Key\` erzeugen.
3. Key und Entwurf lokal auf dem Gerät speichern.
4. Feedback absenden.
5. Bei Timeout oder Netzwerkfehler denselben Key und dieselben Daten erneut senden.
6. Erst nach erfolgreicher Antwort den Status-Link speichern und den Entwurf als abgeschlossen markieren.
7. Für ein wirklich neues Feedback einen neuen Key erzeugen.
8. Niemals denselben Key für unterschiedliches Feedback verwenden.`,
        operationId: "createPublicFeedback",
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
            "application/json": {
              schema: { $ref: "#/components/schemas/FeedbackSubmissionRequest" },
              examples: {
                standard: {
                  summary: "Mit Namen",
                  value: {
                    areaId: 1,
                    submitterName: "Max Mustermann",
                    feedback: "Die Öffnungszeiten sollten verlängert werden.",
                  },
                },
                anonym: {
                  summary: `Ohne Namen (wird zu „${ANONYMOUS_SUBMITTER}")`,
                  value: {
                    areaId: 1,
                    feedback: "Die Öffnungszeiten sollten verlängert werden.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Feedback wurde neu angelegt.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/FeedbackSubmissionResponse",
                },
                examples: {
                  standard: {
                    value: {
                      statusUrl: "https://gremio.example/feedback/status/abc123",
                      receiptPdfUrl:
                        "https://gremio.example/feedback/status/abc123/pdf",
                      number: "F_0042_2026",
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
                  $ref: "#/components/schemas/FeedbackSubmissionResponse",
                },
              },
            },
          },
          "400": {
            description:
              "Ungültige Eingabe (fehlende Felder, zu lange Werte, kein JSON-Objekt) oder fehlender/ungültiger `Idempotency-Key`.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ValidationError" },
                examples: {
                  feld: {
                    value: {
                      error: "Bitte Feedback eingeben.",
                      issues: [
                        { field: "feedback", message: "Bitte Feedback eingeben." },
                      ],
                    },
                  },
                },
              },
            },
          },
          "404": errorResponse(
            "Der gewählte Bereich existiert nicht, ist deaktiviert oder nicht vollständig geroutet.",
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
            `Der Request-Body überschreitet ${FEEDBACK_MAX_BODY_KIB} KiB.`,
          ),
          "415": errorResponse(
            "Falscher Content-Type — erforderlich ist `application/json`.",
          ),
          "429": feedbackRateLimitResponse,
          "500": errorResponse(
            "Unerwarteter interner Fehler. Die Meldung ist bewusst generisch.",
          ),
        },
      },
    },
    "/api/public/v1/status": {
      post: {
        tags: ["Öffentlicher Status"],
        operationId: "resolvePublicStatus",
        summary: "Status per Status-Link abrufen",
        security: [],
        description: `Liefert den aktuellen Stand eines Antrags oder Feedbacks anhand des Status-Links, den die App beim Einreichen erhalten hat.

**Warum POST für einen lesenden Abruf?** Der Status-Link ist ein Geheimnis. Als Query-Parameter (\`?statusUrl=…\`) landete er in Browser-Historien, Proxy- und Access-Logs, Monitoring und Referrer-Headern. Im JSON-Body bleibt er davon verschont.

Der Endpunkt **verändert nichts**: keine Karte, kein Zeitstempel, keine Aktivität, keine Datei. Er braucht deshalb **keinen \`Idempotency-Key\`** — beliebig oft aufrufbar.

**Unterstützte Links** (beide nur auf dieser Instanz):
* \`{APP_BASE_URL}/status/{token}\` → Antrag
* \`{APP_BASE_URL}/feedback/status/{token}\` → Feedback

**Nicht unterstützt:** Ausleih-/Inventarstatus (\`/inventar/status/…\`), PDF-Links, Attachment- und Stream-URLs sowie interne Kartenlinks. Solche Eingaben ergeben \`400\`.

**Sicherheit:** Der Link wird ausschließlich lokal geprüft und **niemals vom Server abgerufen**. Behandle ihn wie ein Bearer-Credential: nicht loggen, nicht an Analytics geben, nicht teilen.

**Umfang:** Ausgegeben wird ausschließlich, was auch die öffentliche Webansicht zeigt — keine internen IDs, Notizen, Kommentare oder Dateipfade. Der **Studierendenausweis** erscheint nie.

**Polling:** Die App darf regelmäßig abfragen. Bei \`429\` den Header \`Retry-After\` beachten.`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicStatusRequest" },
              examples: {
                antrag: {
                  summary: "Antrag",
                  value: { statusUrl: "https://gremio.example/status/abc123" },
                },
                feedback: {
                  summary: "Feedback",
                  value: {
                    statusUrl:
                      "https://gremio.example/feedback/status/xyz789",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Aktueller Status. Der Typ steht in `type` — `application` oder `feedback`.",
            headers: {
              "Cache-Control": {
                description: "Immer `no-store`.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      $ref: "#/components/schemas/PublicApplicationStatusResponse",
                    },
                    {
                      $ref: "#/components/schemas/PublicFeedbackStatusResponse",
                    },
                  ],
                  discriminator: {
                    propertyName: "type",
                    mapping: {
                      application:
                        "#/components/schemas/PublicApplicationStatusResponse",
                      feedback:
                        "#/components/schemas/PublicFeedbackStatusResponse",
                    },
                  },
                },
                examples: {
                  antrag: {
                    summary: "Antrag",
                    value: {
                      type: "application",
                      statusUrl: "https://gremio.example/status/abc123",
                      receiptPdfUrl:
                        "https://gremio.example/status/abc123/pdf",
                      number: "A_0042_2026",
                      submittedAt: "2026-08-04T10:15:00.000Z",
                      updatedAt: "2026-08-05T08:30:00.000Z",
                      application: {
                        title: "Grillabend am FB5",
                        applicant: "Max Mustermann",
                      },
                      status: {
                        name: "In Bearbeitung",
                        resubmittedAt: null,
                        archived: false,
                      },
                      publicNote: "Bitte reiche noch eine Quittung nach.",
                      documents: [
                        {
                          kind: "finance_request",
                          // Aus der gemeinsamen Label-Quelle — das Beispiel
                          // veraltet damit nicht bei einer Umbenennung.
                          label: ATTACHMENT_KIND_LABELS.finance_request,
                          filename: "Finanzantrag.pdf",
                          mimeType: "application/pdf",
                          downloadUrl:
                            "https://gremio.example/api/status/abc123/attachment/12",
                        },
                      ],
                      availableActions: {
                        canUploadDocuments: true,
                        submitMode: "receipt",
                      },
                    },
                  },
                  feedback: {
                    summary: "Feedback",
                    value: {
                      type: "feedback",
                      statusUrl:
                        "https://gremio.example/feedback/status/xyz789",
                      receiptPdfUrl:
                        "https://gremio.example/feedback/status/xyz789/pdf",
                      number: "F_0042_2026",
                      submittedAt: "2026-08-04T10:15:00.000Z",
                      updatedAt: "2026-08-05T08:30:00.000Z",
                      feedback: {
                        area: "Bibliothek",
                        submitterName: "Max Mustermann",
                        text: "Die Öffnungszeiten sollten verlängert werden.",
                      },
                      status: { name: "In Bearbeitung" },
                      publicNote: null,
                      documents: [],
                      availableActions: {
                        canUploadDocuments: false,
                        submitMode: null,
                      },
                    },
                  },
                },
              },
            },
          },
          "400": errorResponse(
            "Fehlender, formal ungültiger oder nicht unterstützter Status-Link (fremder Origin, Query/Fragment, PDF-/Attachment-/Inventarpfad, unbekanntes Feld oder ungültiges JSON).",
          ),
          "404": errorResponse(
            "Der Vorgang wurde nicht gefunden. Bewusst identisch für unbekannten Token, gelöschten Vorgang und Token des falschen Typs (z. B. Feedback-Token auf dem Antragspfad).",
          ),
          "413": errorResponse("Der Body ist größer als 8 KiB."),
          "415": errorResponse("Content-Type ist nicht application/json."),
          "429": statusRateLimitResponse,
          "500": errorResponse(
            "Unerwarteter interner Fehler. Die Meldung ist bewusst generisch.",
          ),
        },
      },
    },
  },
  components: {
    schemas: {
      PublicStatusRequest: {
        type: "object",
        description: "Der Status-Link, den die App beim Einreichen erhalten hat.",
        required: ["statusUrl"],
        additionalProperties: false,
        properties: {
          statusUrl: {
            type: "string",
            format: "uri",
            maxLength: MAX_STATUS_URL_LENGTH,
            description:
              "Vollständiger Status-Link dieser Instanz — `/status/{token}` (Antrag) oder `/feedback/status/{token}` (Feedback). Query-Parameter, Fragmente, Zugangsdaten in der URL sowie PDF-, Attachment-, Stream-, Inventar- und interne Pfade werden abgelehnt.",
            examples: ["https://gremio.example/status/abc123"],
          },
        },
      },
      PublicStatusDocument: {
        type: "object",
        description:
          "Ein öffentlich sichtbares Dokument des Vorgangs — exakt die Dateien, die auch die Webansicht anbietet. Der Studierendenausweis ist NIE enthalten.",
        required: ["kind", "label", "filename", "mimeType", "downloadUrl"],
        properties: {
          kind: {
            type: "string",
            enum: ["finance_request", "annex_a", "annex_b", "other"],
            description: "`other` = öffentlich nachgereichte Datei bzw. Quittung.",
          },
          label: {
            type: "string",
            description:
              "Anzeigename wie in der Webansicht; bei nachgereichten Dateien der Dateiname.",
          },
          filename: { type: "string" },
          mimeType: { type: "string", examples: ["application/pdf"] },
          downloadUrl: {
            type: "string",
            format: "uri",
            description:
              "Absoluter Download-Link über die token-geschützte Route. Enthält keine Dateisystem- oder Nextcloud-Pfade; die Zuordnung von Token und Anhang wird serverseitig weiterhin geprüft.",
          },
        },
      },
      PublicStatusActions: {
        type: "object",
        description:
          "Welche Aktionen die öffentliche Webansicht gerade anbietet. Dieser Endpunkt stellt nur den Status bereit — die Aktionen selbst laufen über die Weboberfläche.",
        required: ["canUploadDocuments", "submitMode"],
        properties: {
          canUploadDocuments: {
            type: "boolean",
            description:
              "Dürfen weitere Dateien hinzugefügt werden? Bei archivierten Vorgängen `false`. Für Feedback immer `false`.",
          },
          submitMode: {
            type: ["string", "null"],
            enum: ["resubmission", "receipt", null],
            description:
              "`resubmission` = Nachreichung einreichbar, `receipt` = Quittung einreichbar, `null` = kein Einreichen-Knopf. Ergibt sich aus den Board-Gates und dem aktuellen Stand; die Zielspalte wird bewusst nicht ausgegeben.",
          },
        },
      },
      PublicApplicationStatusResponse: {
        type: "object",
        description: "Status eines Antrags.",
        required: [
          "type",
          "statusUrl",
          "receiptPdfUrl",
          "number",
          "submittedAt",
          "updatedAt",
          "application",
          "status",
          "publicNote",
          "documents",
          "availableActions",
        ],
        properties: {
          type: { type: "string", const: "application" },
          statusUrl: {
            type: "string",
            format: "uri",
            description:
              "Kanonischer Status-Link, aus `APP_BASE_URL` erzeugt (nicht aus der Eingabe übernommen).",
          },
          receiptPdfUrl: { type: "string", format: "uri" },
          number: {
            type: ["string", "null"],
            description: "Antragsnummer; `null`, wenn die Board-Nummerierung aus ist.",
          },
          submittedAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          application: {
            type: "object",
            required: ["title", "applicant"],
            properties: {
              title: { type: "string", description: "Antragsgegenstand." },
              applicant: { type: ["string", "null"] },
            },
          },
          status: {
            type: "object",
            required: ["name", "resubmittedAt", "archived"],
            properties: {
              name: {
                type: ["string", "null"],
                description: "Öffentlicher Name der aktuellen Spalte.",
              },
              resubmittedAt: {
                type: ["string", "null"],
                format: "date-time",
                description: "Zeitpunkt einer öffentlichen Nachreichung.",
              },
              archived: {
                type: "boolean",
                description:
                  "Vorgang liegt in der Archiv-Spalte und ist damit öffentlich abgeschlossen.",
              },
            },
          },
          publicNote: {
            type: ["string", "null"],
            description:
              "Bewusst öffentlicher Hinweis des Gremiums. Interne Notizen erscheinen NIE.",
          },
          documents: {
            type: "array",
            items: { $ref: "#/components/schemas/PublicStatusDocument" },
          },
          availableActions: {
            $ref: "#/components/schemas/PublicStatusActions",
          },
        },
      },
      PublicFeedbackStatusResponse: {
        type: "object",
        description:
          "Status eines Feedbacks. Bereich, Name und Text stammen aus dem unveränderlichen Snapshot der Einreichung — spätere interne Änderungen wirken sich nicht aus.",
        required: [
          "type",
          "statusUrl",
          "receiptPdfUrl",
          "number",
          "submittedAt",
          "updatedAt",
          "feedback",
          "status",
          "publicNote",
          "documents",
          "availableActions",
        ],
        properties: {
          type: { type: "string", const: "feedback" },
          statusUrl: { type: "string", format: "uri" },
          receiptPdfUrl: { type: "string", format: "uri" },
          number: { type: ["string", "null"] },
          submittedAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          feedback: {
            type: "object",
            required: ["area", "submitterName", "text"],
            properties: {
              area: { type: "string", description: "Bereich zum Zeitpunkt der Einreichung." },
              submitterName: {
                type: "string",
                description: `Name des Einreichers; ohne Angabe „${ANONYMOUS_SUBMITTER}".`,
              },
              text: { type: "string", description: "Ursprünglicher Feedbacktext." },
            },
          },
          status: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: ["string", "null"] },
            },
          },
          publicNote: { type: ["string", "null"] },
          documents: {
            type: "array",
            description: "Für Feedback immer leer.",
            items: { $ref: "#/components/schemas/PublicStatusDocument" },
          },
          availableActions: {
            $ref: "#/components/schemas/PublicStatusActions",
          },
        },
      },
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
      FeedbackArea: {
        type: "object",
        description: "Ein auswählbarer Feedback-Bereich.",
        required: ["id", "name"],
        properties: {
          id: {
            type: "integer",
            description: "Wird als `areaId` beim Einreichen übergeben.",
            examples: [1],
          },
          name: { type: "string", examples: ["Bibliothek"] },
        },
      },
      FeedbackAreasResponse: {
        type: "object",
        required: ["areas"],
        properties: {
          areas: {
            type: "array",
            items: { $ref: "#/components/schemas/FeedbackArea" },
          },
        },
      },
      FeedbackSubmissionRequest: {
        type: "object",
        required: ["areaId", "feedback"],
        properties: {
          areaId: {
            type: "integer",
            description:
              "ID eines Bereichs aus `GET /api/public/v1/feedback-areas`.",
            examples: [1],
          },
          submitterName: {
            type: "string",
            maxLength: SUBMITTER_NAME_MAX_LENGTH,
            description:
              `OPTIONAL. Name des Einreichers (wird getrimmt). Fehlt das Feld ` +
              `oder ist es leer, wird „${ANONYMOUS_SUBMITTER}" gespeichert — ` +
              `Feedback ist also auch anonym möglich. Für die Idempotenz sind ` +
              `ein fehlender Name und „${ANONYMOUS_SUBMITTER}" derselbe Request ` +
              `(kein 409 beim Retry).`,
            examples: ["Max Mustermann"],
          },
          feedback: {
            type: "string",
            minLength: 1,
            maxLength: FEEDBACK_MAX_LENGTH,
            description: `Der Feedbacktext (wird getrimmt, Zeilenenden werden auf \`\\n\` normalisiert). Innere Absätze bleiben erhalten. Maximal ${FEEDBACK_MAX_LENGTH} Zeichen.`,
            examples: ["Die Öffnungszeiten sollten verlängert werden."],
          },
        },
      },
      FeedbackSubmissionResponse: {
        type: "object",
        description:
          "Enthält bewusst nur die öffentlichen Links und die Nummer — keine Karten-ID, kein Board, keine Spalte, keine internen Notizen.",
        required: ["statusUrl", "receiptPdfUrl", "number"],
        properties: {
          statusUrl: {
            type: "string",
            format: "uri",
            description:
              "Geheimer öffentlicher Status-Link. Lokal speichern, vertraulich behandeln, nicht loggen.",
            examples: ["https://gremio.example/feedback/status/abc123"],
          },
          receiptPdfUrl: {
            type: "string",
            format: "uri",
            description: "Eingangsbestätigung als PDF (gleicher Token).",
            examples: ["https://gremio.example/feedback/status/abc123/pdf"],
          },
          number: {
            type: ["string", "null"],
            description:
              "Kartennummer, falls die Board-Nummerierung aktiv ist — sonst `null`.",
            examples: ["F_0042_2026"],
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
