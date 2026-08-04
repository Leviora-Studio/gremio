// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { API_TOKEN_PREFIX } from "@/lib/api-token";
import { CARD_FIELD_KEYS } from "@/lib/constants";

/**
 * OpenAPI 3.1 der INTERNEN API (`/api/v1`) — EINZIGE Quelle.
 *
 * `GET /api/v1/openapi.json` liefert dieses Dokument aus (nur mit Web-Session);
 * `docs/openapi-v1.yaml` wird daraus per `npm run openapi:internal:yaml`
 * erzeugt.
 *
 * Bewusst STRIKT getrennt von `lib/openapi-public.ts`: Die öffentliche
 * Spezifikation beschreibt die unauthentifizierten Endpunkte für native Apps,
 * diese hier die token-geschützte interne API. Kein Pfad steht in beiden
 * Dokumenten, und öffentliche Clients sehen keine internen Modelle.
 *
 * Die Angaben sind aus dem Code abgeleitet (Route-Handler, `lib/api.ts`,
 * `lib/api-cards.ts`, `lib/api-token.ts`); es werden weder Endpunkte erfunden
 * noch Berechtigungen beschönigt.
 */

// Kartenfeld-Schlüssel, wie sie `visibleFields` ausgibt — direkt aus der
// Implementierung, damit die Doku nicht veraltet.
const FIELD_KEYS = [...CARD_FIELD_KEYS];

const AUTH_DESCRIPTION = `Alle Endpunkte verlangen einen persönlichen API-Token:

\`\`\`
Authorization: Bearer ${API_TOKEN_PREFIX}…
\`\`\`

Tokens werden unter **Mein Konto → API-Tokens** (\`/intern/konto\`) erstellt. Ein Token ist an **einen Nutzer** gebunden und erbt dessen Rechte — er ist **keine** pauschale Administratorberechtigung.

**Rechtestufe (\`scope\`)**: \`write\` erlaubt lesende und schreibende Zugriffe, \`read\` nur \`GET\` (sonst \`403\`).

**Board-Beschränkung**: Ein Token kann auf bestimmte Boards begrenzt werden. Die Beschränkung wirkt **zusätzlich** zur Live-Zugriffsprüfung des Nutzers und kann nur einschränken, nie erweitern. Nicht erlaubte Boards verhalten sich wie nicht vorhanden (\`404\`).`;

/** 401 — kein/ungültiger Token. */
const unauthorized = {
  description:
    "Kein oder ungültiger API-Token. Der Header `Authorization: Bearer …` fehlt, ist fehlerhaft, der Token wurde widerrufen oder das Konto ist deaktiviert.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
      example: {
        error: "Ungültiger oder fehlender API-Token.",
        hint: "Header 'Authorization: Bearer grm_…' setzen.",
      },
    },
  },
} as const;

/** 404 — auch bei fehlendem Zugriff (die Existenz wird nicht preisgegeben). */
const notFoundBoard = {
  description:
    "Board nicht gefunden — **oder** der Nutzer hat keinen Zugriff darauf, **oder** der Token ist auf andere Boards beschränkt. Bewusst identisch, damit die Existenz fremder Boards nicht preisgegeben wird.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
      example: { error: "Board nicht gefunden." },
    },
  },
} as const;

const notFoundCard = {
  description:
    "Karte nicht gefunden — **oder** kein Zugriff auf ihr Board, **oder** der Token ist auf andere Boards beschränkt.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
      example: { error: "Karte nicht gefunden." },
    },
  },
} as const;

/** 403 — Token nur lesend, oder verwalter-exklusives Feld. */
const forbiddenWrite = {
  description:
    "Schreibzugriff verweigert: Der Token hat nur Lese-Rechte (`scope=read`), **oder** es wurde ein verwalter-exklusives Feld gesetzt (`number`, `instructionDate`, `transferDate`) ohne Board-Verwaltungsrecht.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
      examples: {
        readOnly: {
          summary: "Token nur lesend",
          value: { error: "Dieser Token hat nur Lese-Rechte (scope=read)." },
        },
        managerOnly: {
          summary: "Verwalter-exklusives Feld",
          value: { error: "Feld 'number' darf nur ein Board-Verwalter setzen." },
        },
      },
    },
  },
} as const;

const badRequest = {
  description:
    "Ungültige Eingabe: kaputtes JSON, unbekanntes Body-Feld, Schema-Verstoß, ein am Board **deaktiviertes** Feld, eine nicht zum Board gehörende `statusId`, eine unbekannte `priorityId`/`accountId`, ein Nutzer ohne Board-Zugriff oder `archived: true` (manuelles Archivieren gibt es nicht).",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ValidationError" },
      examples: {
        schema: {
          summary: "Schema-Verstoß",
          value: {
            error: "Ungültige Eingabe.",
            issues: [{ path: "title", message: "String must contain at least 1 character(s)" }],
          },
        },
        fieldDisabled: {
          summary: "Feld am Board deaktiviert",
          value: { error: "Feld 'budgetTitle' ist auf diesem Board nicht aktiviert." },
        },
      },
    },
  },
} as const;

const conflictLoanBoard = {
  description:
    "Leihvorgang-Board: Dessen Karten werden ausschließlich über das Inventar verwaltet, die API ist dort nur lesend.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
      example: {
        error:
          "Leihvorgang-Board: Karten werden über das Inventar verwaltet (API nur lesend).",
      },
    },
  },
} as const;

const archivedParam = {
  name: "archived",
  in: "query",
  required: false,
  description:
    "Archivierte (weggeräumte) Karten. Ohne Angabe werden **nur aktive** Karten geliefert; `true` liefert **nur** archivierte, `all` beide.",
  schema: { type: "string", enum: ["true", "all"] },
} as const;

const cardExample = {
  id: 42,
  boardId: 1,
  statusId: 10,
  statusName: "Eingegangen",
  position: 0,
  title: "Grillabend am FB5",
  locationId: 4,
  archivedAt: null,
  createdAt: "2026-01-02T10:15:00.000Z",
  updatedAt: "2026-01-02T10:15:00.000Z",
  applicant: "Max Mustermann",
  number: "A_0042_2026",
  priorityId: 3,
  assigneeUserIds: [7],
  deadline: "2026-02-01",
  approvedAmountCents: 25000,
  notes: null,
};

export const openApiV1Spec = {
  openapi: "3.1.0",
  info: {
    title: "Gremio Internal API",
    // Version des DOKUMENTS (semver) — gleiche Konvention wie in
    // lib/openapi-public.ts. NICHT die Pfad-Version: die steckt im Namespace
    // `/api/v1` und im Feld `version` der Discovery-Antwort und bleibt `v1`.
    version: "1.0.0",
    summary: "Token-geschützte API für Boards und Karten.",
    description: `Interne REST-API von Gremio für **eigene Werkzeuge und Integrationen**.

${AUTH_DESCRIPTION}

**Diese Dokumentation und die Spezifikation sind selbst anmeldepflichtig** (Gremio-Web-Session). Die Anmeldung dient nur dem Öffnen der Doku — für „Try it out" wird zusätzlich ein API-Token über **Authorize** benötigt, und die aufgerufene Route prüft ihn unabhängig davon erneut.

Die **öffentliche** API für native Apps ist getrennt dokumentiert unter \`/api/public/docs\`.`,
    license: { name: "AGPL-3.0-or-later" },
  },
  servers: [{ url: "/", description: "Diese Instanz" }],
  tags: [
    { name: "Allgemein", description: "Token prüfen und Endpunkte entdecken." },
    { name: "Boards", description: "Zugängliche Boards, Spalten und Feldkonfiguration." },
    { name: "Karten", description: "Karten lesen, anlegen, ändern, verschieben und löschen." },
  ],
  // Gilt für ALLE Operationen; keine Ausnahme, jeder /api/v1-Endpunkt
  // authentifiziert über authApi().
  security: [{ BearerAuth: [] }],
  paths: {
    "/api/v1": {
      get: {
        tags: ["Allgemein"],
        operationId: "getApiInfo",
        summary: "API-Information",
        description:
          "Bestätigt den Token und listet die verfügbaren Endpunkte. Nützlich, um Token, Rechtestufe und Board-Beschränkung zu prüfen.\n\n**Berechtigung:** jeder gültige Token.",
        responses: {
          200: {
            description: "Token gültig.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiInfo" },
              },
            },
          },
          401: unauthorized,
        },
      },
    },
    "/api/v1/boards": {
      get: {
        tags: ["Boards"],
        operationId: "listBoards",
        summary: "Zugängliche Boards auflisten",
        description:
          "Alle Boards, die der Token-Nutzer sehen darf: eigene Boards, direkte Freigaben, Freigaben über eine Gruppe und — bei Administratoren — alle Boards. Ein auf bestimmte Boards beschränkter Token sieht nur die Schnittmenge.\n\n**Berechtigung:** Board-Zugriff des Nutzers (`canAccessBoard`).",
        responses: {
          200: {
            description: "Liste der zugänglichen Boards.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["boards"],
                  properties: {
                    boards: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Board" },
                    },
                  },
                },
              },
            },
          },
          401: unauthorized,
        },
      },
    },
    "/api/v1/boards/{id}": {
      get: {
        tags: ["Boards"],
        operationId: "getBoard",
        summary: "Board mit Spalten und sichtbaren Feldern",
        description:
          "Board, seine Status-Spalten (nach `position`) und die am Board **aktivierten** Kartenfelder.\n\n**Berechtigung:** Board-Zugriff. `isInstructionTrigger` an den Spalten und `ownerId` am Board erscheinen nur für Board-Verwalter (Eigentümer oder Administrator) — genau wie in der Weboberfläche.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Board-ID.",
            schema: { type: "integer", format: "int32", minimum: 1 },
          },
        ],
        responses: {
          200: {
            description: "Board, Spalten und aktivierte Kartenfelder.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BoardDetail" },
              },
            },
          },
          401: unauthorized,
          404: notFoundBoard,
        },
      },
    },
    "/api/v1/boards/{id}/cards": {
      get: {
        tags: ["Karten"],
        operationId: "listBoardCards",
        summary: "Karten eines Boards auflisten",
        description:
          "Karten des Boards, sortiert nach Spalten- und Kartenposition. Am Board **deaktivierte** Felder werden nicht ausgeliefert — die API zeigt nie mehr als die Weboberfläche.\n\n**Berechtigung:** Board-Zugriff.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Board-ID.",
            schema: { type: "integer", format: "int32", minimum: 1 },
          },
          {
            name: "statusId",
            in: "query",
            required: false,
            description: "Nur Karten dieser Spalte. Nicht-numerische Werte werden ignoriert.",
            schema: { type: "integer", format: "int32", minimum: 1 },
          },
          archivedParam,
        ],
        responses: {
          200: {
            description: "Karten des Boards.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CardList" },
                example: { cards: [cardExample] },
              },
            },
          },
          401: unauthorized,
          404: notFoundBoard,
        },
      },
      post: {
        tags: ["Karten"],
        operationId: "createCard",
        summary: "Karte auf einem Board anlegen",
        description:
          "Legt eine Karte an. Pflichtfeld ist `title`. Ohne `statusId` landet sie in der **ersten** Spalte, ohne `position` am Ende der Spalte. Ist die Board-Nummerierung aktiv, wird automatisch eine Antragsnummer vergeben.\n\n**Berechtigung:** Board-Zugriff **und** Token mit `scope=write`. Die Felder `number`, `instructionDate` und `transferDate` setzen nur Board-Verwalter. Am Board deaktivierte Felder werden abgelehnt.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CardWrite" },
              examples: {
                minimal: {
                  summary: "Nur Titel",
                  value: { title: "Grillabend am FB5" },
                },
                mitFeldern: {
                  summary: "Mit weiteren Feldern",
                  value: {
                    title: "Grillabend am FB5",
                    applicant: "Max Mustermann",
                    priorityId: 3,
                    deadline: "2026-02-01",
                    approvedAmountCents: 25000,
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Karte angelegt.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CardEnvelope" },
                example: { card: cardExample },
              },
            },
          },
          400: badRequest,
          401: unauthorized,
          403: forbiddenWrite,
          404: notFoundBoard,
          409: conflictLoanBoard,
        },
      },
    },
    "/api/v1/me/cards": {
      get: {
        tags: ["Karten"],
        operationId: "listMyCards",
        summary: "Mir zugewiesene Karten auflisten",
        description:
          "Alle dem Token-Nutzer **zugewiesenen** Karten board-übergreifend, inklusive `boardName` und `statusName`. Beschränkt auf die zugänglichen (und vom Token erlaubten) Boards; deaktivierte Felder werden je Board ausgeblendet.\n\n**Berechtigung:** jeder gültige Token; die Ergebnismenge folgt den Board-Zugriffen des Nutzers.",
        parameters: [archivedParam],
        responses: {
          200: {
            description: "Zugewiesene Karten.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CardList" },
                example: {
                  cards: [{ ...cardExample, boardName: "Antragsboard" }],
                },
              },
            },
          },
          401: unauthorized,
        },
      },
    },
    "/api/v1/cards/{id}": {
      get: {
        tags: ["Karten"],
        operationId: "getCard",
        summary: "Karte abrufen",
        description:
          "Einzelne Karte inklusive `statusName` und `boardName`.\n\n**Berechtigung:** Zugriff auf das Board der Karte.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Karten-ID.",
            schema: { type: "integer", format: "int32", minimum: 1 },
          },
        ],
        responses: {
          200: {
            description: "Karte.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CardEnvelope" },
                example: { card: { ...cardExample, boardName: "Antragsboard" } },
              },
            },
          },
          401: unauthorized,
          404: notFoundCard,
        },
      },
      patch: {
        tags: ["Karten"],
        operationId: "updateCard",
        summary: "Karte ändern oder verschieben",
        description:
          "Ändert die übergebenen Felder; nicht übergebene bleiben unberührt, `null` löscht ein Feld.\n\n**Verschieben:** `statusId` setzen — die Karte landet am Ende der Zielspalte, ein Aktivitätseintrag entsteht und die Trigger (Anweisungsdatum, Nextcloud-Archiv) greifen wie in der Oberfläche. Mit zusätzlichem `position` wird an eine bestimmte Stelle einsortiert.\n\n**Wiederherstellen:** `archived: false` holt eine weggeräumte Karte zurück. `archived: true` wird mit `400` abgelehnt — manuelles Archivieren gibt es auch im Web nicht.\n\n**Berechtigung:** Board-Zugriff **und** `scope=write`; `number`, `instructionDate` und `transferDate` nur für Board-Verwalter.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Karten-ID.",
            schema: { type: "integer", format: "int32", minimum: 1 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CardWrite" },
              examples: {
                verschieben: {
                  summary: "In Spalte 12 an zweite Position",
                  value: { statusId: 12, position: 1 },
                },
                feldLoeschen: {
                  summary: "Deadline entfernen",
                  value: { deadline: null },
                },
                wiederherstellen: {
                  summary: "Archivierte Karte zurückholen",
                  value: { archived: false },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Karte geändert.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CardEnvelope" },
                example: { card: cardExample },
              },
            },
          },
          400: badRequest,
          401: unauthorized,
          403: forbiddenWrite,
          404: notFoundCard,
          409: conflictLoanBoard,
        },
      },
      delete: {
        tags: ["Karten"],
        operationId: "deleteCard",
        summary: "Karte löschen",
        description:
          "Löscht die Karte und ihre Anhänge (Dateien inklusive). Unwiderruflich.\n\n**Berechtigung:** Board-Zugriff **und** `scope=write`. Das Zugriffsmodell ist binär — jedes Board-Mitglied darf löschen, ein gesondertes Löschrecht gibt es nicht.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Karten-ID.",
            schema: { type: "integer", format: "int32", minimum: 1 },
          },
        ],
        responses: {
          200: {
            description: "Karte gelöscht.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["ok"],
                  properties: { ok: { type: "boolean", const: true } },
                },
                example: { ok: true },
              },
            },
          },
          401: unauthorized,
          403: forbiddenWrite,
          404: notFoundCard,
          409: conflictLoanBoard,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API-Token",
        description: `Persönlicher API-Token aus **Mein Konto → API-Tokens**, gesendet als \`Authorization: Bearer ${API_TOKEN_PREFIX}…\`.

Der Token gilt nur im Rahmen der Rechte seines Nutzers. Die Anmeldung an dieser Dokumentationsseite ersetzt ihn **nicht**.`,
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", description: "Lesbare Fehlermeldung." },
          hint: {
            type: "string",
            description: "Optionaler Hinweis zur Behebung (nur bei 401).",
          },
        },
      },
      ValidationError: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          issues: {
            type: "array",
            description: "Feldbezogene Verstöße (nur bei Schema-Fehlern).",
            items: {
              type: "object",
              required: ["path", "message"],
              properties: {
                path: {
                  type: "string",
                  description: "Punktnotation des Feldes, z. B. `title`.",
                },
                message: { type: "string" },
              },
            },
          },
        },
      },
      ApiInfo: {
        type: "object",
        required: ["api", "version", "authenticatedAs", "token", "endpoints"],
        properties: {
          api: { type: "string", examples: ["Gremio API"] },
          version: { type: "string", examples: ["v1"] },
          authenticatedAs: {
            type: "object",
            required: ["id", "username", "role"],
            properties: {
              id: { type: "integer", format: "int32" },
              username: { type: "string" },
              role: {
                type: "string",
                enum: ["admin", "template_manager", "user"],
              },
            },
          },
          token: {
            type: "object",
            required: ["scope", "boards"],
            properties: {
              scope: {
                type: "string",
                enum: ["read", "write"],
                description: "Rechtestufe des Tokens.",
              },
              boards: {
                description:
                  "Board-Beschränkung: Liste der erlaubten IDs oder der Text `all`.",
                oneOf: [
                  { type: "array", items: { type: "integer", format: "int32" } },
                  { type: "string", const: "all" },
                ],
              },
            },
          },
          endpoints: {
            type: "object",
            description: "Pfad → Kurzbeschreibung.",
            additionalProperties: { type: "string" },
          },
        },
      },
      Board: {
        type: "object",
        required: ["id", "name", "description", "role", "doneStatusId", "createdAt"],
        properties: {
          id: { type: "integer", format: "int32" },
          name: { type: "string" },
          description: { type: ["string", "null"] },
          ownerId: {
            type: "integer",
            format: "int32",
            description:
              "Nur für Board-Verwalter (Eigentümer/Administrator) enthalten — sonst fehlt das Feld ganz.",
          },
          role: {
            type: "string",
            enum: ["owner", "admin", "member"],
            description: "Rolle des Token-Nutzers bezogen auf dieses Board.",
          },
          doneStatusId: {
            type: ["integer", "null"],
            format: "int32",
            description: "Spalte, die vom Done-Sweep archiviert wird (null = aus).",
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      BoardStatus: {
        type: "object",
        required: ["id", "name", "position", "isArchiveTrigger"],
        properties: {
          id: { type: "integer", format: "int32" },
          name: { type: "string" },
          position: { type: "integer", format: "int32" },
          isArchiveTrigger: {
            type: "boolean",
            description: "Erreicht eine Karte diese Spalte, greift die Nextcloud-Archivierung.",
          },
          isInstructionTrigger: {
            type: "boolean",
            description:
              "Setzt beim Erreichen das Anweisungsdatum. Nur für Board-Verwalter enthalten.",
          },
        },
      },
      BoardDetail: {
        type: "object",
        required: ["board", "statuses", "visibleFields"],
        properties: {
          board: { $ref: "#/components/schemas/Board" },
          statuses: {
            type: "array",
            items: { $ref: "#/components/schemas/BoardStatus" },
          },
          visibleFields: {
            type: "array",
            description:
              "Am Board aktivierte Kartenfelder. Nicht enthaltene Felder werden weder gelesen noch geschrieben.",
            items: { type: "string", enum: FIELD_KEYS },
          },
        },
      },
      Card: {
        type: "object",
        description:
          "Karte. **Optionale Felder erscheinen nur, wenn sie am Board aktiviert sind** — die Liste unten zeigt alle möglichen. Beträge sind Integer in **Cent**, Datumsfelder `YYYY-MM-DD`.",
        required: [
          "id",
          "boardId",
          "statusId",
          "position",
          "title",
          "locationId",
          "archivedAt",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "integer", format: "int32" },
          boardId: { type: "integer", format: "int32" },
          statusId: { type: "integer", format: "int32" },
          statusName: { type: "string" },
          boardName: {
            type: "string",
            description: "Nur bei `GET /cards/{id}` und `GET /me/cards`.",
          },
          position: { type: "integer", format: "int32" },
          title: { type: "string" },
          locationId: {
            type: ["integer", "null"],
            format: "int32",
            description:
              "Herkunfts-Standort aus dem öffentlichen Antragsformular; null bei manuell angelegten Karten.",
          },
          archivedAt: {
            type: ["string", "null"],
            format: "date-time",
            description: "Zeitpunkt der Archivierung; null = aktiv.",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          applicant: { type: ["string", "null"] },
          number: { type: ["string", "null"], description: "Antragsnummer." },
          budgetTitle: { type: ["string", "null"] },
          priorityId: { type: ["integer", "null"], format: "int32" },
          accountId: { type: ["integer", "null"], format: "int32" },
          assigneeUserIds: {
            type: "array",
            items: { type: "integer", format: "int32" },
          },
          creatorUserId: { type: ["integer", "null"], format: "int32" },
          deadline: { type: ["string", "null"], format: "date" },
          meeting: { type: ["string", "null"], format: "date" },
          decisionRef: { type: ["string", "null"] },
          instructionDate: { type: ["string", "null"], format: "date" },
          transferDate: { type: ["string", "null"], format: "date" },
          approvedAmountCents: { type: ["integer", "null"] },
          actualAmountCents: { type: ["integer", "null"] },
          notes: { type: ["string", "null"] },
          applicantNote: {
            type: ["string", "null"],
            description: "Öffentlicher Hinweis, sichtbar auf der Statusseite des Antragstellers.",
          },
        },
      },
      CardEnvelope: {
        type: "object",
        required: ["card"],
        properties: { card: { $ref: "#/components/schemas/Card" } },
      },
      CardList: {
        type: "object",
        required: ["cards"],
        properties: {
          cards: { type: "array", items: { $ref: "#/components/schemas/Card" } },
        },
      },
      CardWrite: {
        type: "object",
        description:
          "Schreibbare Kartenfelder. **Unbekannte Felder werden mit `400` abgelehnt** (Tippfehler-Schutz). Bei `PATCH` sind alle Felder optional; bei `POST` ist `title` erforderlich. `null` löscht ein Feld.",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          applicant: { type: ["string", "null"], maxLength: 200 },
          budgetTitle: { type: ["string", "null"], maxLength: 200 },
          number: {
            type: ["string", "null"],
            maxLength: 100,
            description: "Nur für Board-Verwalter.",
          },
          statusId: {
            type: "integer",
            format: "int32",
            minimum: 1,
            description: "Zielspalte; muss zum Board der Karte gehören.",
          },
          position: {
            type: "integer",
            format: "int32",
            minimum: 0,
            description: "0-basierte Position in der Spalte.",
          },
          priorityId: { type: ["integer", "null"], format: "int32", minimum: 1 },
          accountId: { type: ["integer", "null"], format: "int32", minimum: 1 },
          assigneeUserIds: {
            type: "array",
            maxItems: 50,
            items: { type: "integer", format: "int32", minimum: 1 },
            description: "Ersetzt die Zuweisungen vollständig. Alle Nutzer brauchen Board-Zugriff.",
          },
          creatorUserId: {
            type: ["integer", "null"],
            format: "int32",
            minimum: 1,
            description: "Muss Board-Zugriff haben.",
          },
          deadline: { type: ["string", "null"], format: "date" },
          meeting: { type: ["string", "null"], format: "date" },
          decisionRef: { type: ["string", "null"], maxLength: 200 },
          instructionDate: {
            type: ["string", "null"],
            format: "date",
            description: "Nur für Board-Verwalter.",
          },
          transferDate: {
            type: ["string", "null"],
            format: "date",
            description: "Nur für Board-Verwalter.",
          },
          approvedAmountCents: { type: ["integer", "null"], minimum: 0 },
          actualAmountCents: { type: ["integer", "null"], minimum: 0 },
          notes: { type: ["string", "null"], maxLength: 20000 },
          applicantNote: { type: ["string", "null"], maxLength: 20000 },
          archived: {
            type: "boolean",
            description:
              "Nur `false` (Wiederherstellen) ist zulässig; `true` wird mit `400` abgelehnt.",
          },
        },
      },
    },
  },
} as const;
