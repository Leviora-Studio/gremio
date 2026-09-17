// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

// Extension contracts are composed into the canonical internal OpenAPI document.
const integerId = { type: "integer", minimum: 1, maximum: 2147483647 } as const;
const pathId = (name = "id") => ({
  name,
  in: "path",
  required: true,
  schema: integerId,
});
const query = (name: string, schema: object, description?: string) => ({
  name,
  in: "query",
  required: false,
  schema,
  ...(description ? { description } : {}),
});
export const pageParameters = [
  query("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 }),
  query("offset", {
    type: "integer",
    minimum: 0,
    maximum: 1000000,
    default: 0,
  }),
];
export const cardSearchParameters = [
  ...pageParameters,
  query(
    "q",
    { type: "string", maxLength: 200 },
    "Literal substring search (case-insensitive) in title and visible number, applicant, notes and budget title; % and _ are literal.",
  ),
  ...["boardId", "statusId", "priorityId", "accountId", "assigneeUserId"].map(
    (n) => query(n, integerId),
  ),
  query("archived", {
    type: "string",
    enum: ["false", "true", "all"],
    default: "false",
  }),
  query("unassigned", { type: "boolean" }),
  query(
    "overdue",
    { type: "boolean" },
    "Deadline before today's date in Europe/Berlin, not in the board's done column and not archived. Hidden deadlines never match.",
  ),
  query(
    "deadlineBefore",
    { type: "string", format: "date" },
    "Exclusive upper bound.",
  ),
  query(
    "deadlineAfter",
    { type: "string", format: "date" },
    "Exclusive lower bound.",
  ),
  query(
    "sort",
    {
      type: "string",
      enum: ["position", "updated", "deadline"],
      default: "position",
    },
    "Position ascending, updated descending, or visible deadline ascending with nulls last. Stable ID tie-breaker.",
  ),
];
export const paginationSchema = {
  type: "object",
  required: ["limit", "offset", "hasMore"],
  properties: {
    limit: { type: "integer" },
    offset: { type: "integer" },
    hasMore: { type: "boolean" },
  },
} as const;
const json = (schema: object, description = "Erfolgreich.") => ({
  description,
  content: { "application/json": { schema } },
});
const error = json(
  { $ref: "#/components/schemas/ErrorResponse" },
  "Ungültige Eingabe, fehlende Berechtigung oder nicht gefunden.",
);
const responses = (schema: object, created = false) => ({
  [created ? 201 : 200]: json(schema),
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
});
const list = (key: string, schema: object) => ({
  type: "object",
  required: [key, "pagination"],
  properties: {
    [key]: { type: "array", items: schema },
    pagination: paginationSchema,
  },
});
const envelope = (key: string, schema: object) => ({
  type: "object",
  required: [key],
  properties: { [key]: schema },
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const commentWrite = {
  type: "object",
  additionalProperties: false,
  required: ["body"],
  properties: { body: { type: "string", minLength: 1, maxLength: 5000 } },
};
const body = (schema: object) => ({
  required: true,
  content: { "application/json": { schema } },
});
export const extraSchemas = {
  AttachmentText: {
    type: "object",
    required: ["attachmentId", "filename", "totalPages", "pages", "text", "nextPage", "truncated", "warnings"],
    properties: {
      attachmentId: integerId, filename: { type: "string" }, totalPages: { type: "integer" },
      text: { type: "string", description: "Selected page text plus saved form-field names and values." },
      nextPage: { type: ["integer", "null"] }, truncated: { type: "boolean" },
      warnings: { type: "array", items: { type: "string" } },
      pages: { type: "array", items: {
        type: "object", required: ["page", "text", "formFields", "hasText"],
        properties: {
          page: { type: "integer", minimum: 1 }, text: { type: "string" }, hasText: { type: "boolean" },
          formFields: { type: "array", items: { type: "object", required: ["name", "type", "value"],
            properties: { name: { type: "string" }, type: { type: "string", enum: ["text", "choice", "radio", "checkbox"] }, value: { type: "string" } } } },
        },
      } },
    },
  },
  Pagination: paginationSchema,
  Comment: {
    type: "object",
    required: ["id", "body", "userId", "createdAt"],
    properties: {
      id: integerId,
      cardId: integerId,
      body: { type: "string" },
      userId: { type: ["integer", "null"] },
      authorName: { type: ["string", "null"] },
      authorUsername: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  Activity: {
    type: "object",
    required: ["id", "userId", "type", "detail", "createdAt"],
    properties: {
      id: integerId,
      userId: { type: ["integer", "null"] },
      type: { type: "string" },
      detail: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  Attachment: {
    type: "object",
    required: [
      "id",
      "cardId",
      "kind",
      "filename",
      "mime",
      "size",
      "uploadedAt",
      "uploadedBy",
      "downloadPath",
    ],
    properties: {
      id: integerId,
      cardId: integerId,
      kind: {
        type: "string",
        enum: [
          "finance_request",
          "annex_a",
          "annex_b",
          "student_card",
          "other",
        ],
      },
      filename: { type: "string" },
      mime: { type: "string" },
      size: { type: "integer" },
      uploadedAt: { type: "string", format: "date-time" },
      uploadedBy: { type: ["integer", "null"] },
      downloadPath: {
        type: "string",
        description:
          "Bearer-protected relative API download path; not a public URL.",
      },
    },
  },
} as const;
export const extraPaths = {
  "/api/v1/cards": {
    get: {
      tags: ["Karten"],
      operationId: "searchCards",
      summary: "Karten boardübergreifend suchen",
      description:
        "Only live accessible and token-allowed boards. Always paginated. Hidden fields cannot match searches, filters or deadline sorting. accountId also matches budget positions. Unknown query parameters return 400.",
      parameters: cardSearchParameters,
      responses: responses(ref("CardList")),
    },
  },
  "/api/v1/boards/{id}/users": {
    get: {
      tags: ["Boards"],
      operationId: "listAssignableUsers",
      summary: "Zuweisbare Nutzer nachschlagen",
      description:
        "Requires visible assignee or creator field. Only active users with board access; no email, avatar paths or credentials.",
      parameters: [
        pathId(),
        ...pageParameters,
        query("q", { type: "string", maxLength: 200 }),
      ],
      responses: responses(
        list("users", {
          type: "object",
          required: ["id", "username", "name"],
          properties: {
            id: integerId,
            username: { type: "string" },
            name: { type: ["string", "null"] },
          },
        }),
      ),
    },
  },
  "/api/v1/boards/{id}/accounts": {
    get: {
      tags: ["Boards"],
      operationId: "listBoardAccounts",
      summary: "Kontenauswahl nachschlagen",
      description:
        "Requires enabled account field. Returns the shared selectable catalog, not balances or finance-board data.",
      parameters: [pathId()],
      responses: responses(
        envelope("accounts", {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: integerId,
              name: { type: "string" },
              position: { type: "integer" },
            },
          },
        }),
      ),
    },
  },
  "/api/v1/boards/{id}/priorities": {
    get: {
      tags: ["Boards"],
      operationId: "listBoardPriorities",
      summary: "Prioritäten nachschlagen",
      description: "Requires enabled priority field.",
      parameters: [pathId()],
      responses: responses(
        envelope("priorities", {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: integerId,
              label: { type: "string" },
              color: { type: "string" },
              position: { type: "integer" },
            },
          },
        }),
      ),
    },
  },
  "/api/v1/cards/{id}/comments": {
    get: {
      tags: ["Kommentare"],
      operationId: "listCardComments",
      summary: "Kommentare lesen",
      parameters: [pathId(), ...pageParameters],
      responses: responses(list("comments", ref("Comment"))),
    },
    post: {
      tags: ["Kommentare"],
      operationId: "addCardComment",
      summary: "Kommentar hinzufügen",
      parameters: [pathId()],
      requestBody: body(commentWrite),
      responses: responses(envelope("comment", ref("Comment")), true),
    },
  },
  "/api/v1/cards/{id}/comments/{commentId}": {
    patch: {
      tags: ["Kommentare"],
      operationId: "editCardComment",
      summary: "Eigenen Kommentar bearbeiten",
      description:
        "Author only, even for administrators. Requires write scope. Does not change the original creation time.",
      parameters: [pathId(), pathId("commentId")],
      requestBody: body(commentWrite),
      responses: responses(envelope("comment", ref("Comment"))),
    },
    delete: {
      tags: ["Kommentare"],
      operationId: "deleteCardComment",
      summary: "Kommentar löschen",
      description: "Author or board manager, plus write scope.",
      parameters: [pathId(), pathId("commentId")],
      responses: responses({
        type: "object",
        properties: { ok: { const: true } },
      }),
    },
  },
  "/api/v1/cards/{id}/activity": {
    get: {
      tags: ["Karten"],
      operationId: "listCardActivity",
      summary: "Unveränderlichen Aktivitätsverlauf lesen",
      description:
        "Newest first. Hidden assignment/deadline details are null. File and archive events use generic labels; never expose historical filenames, archive paths or unknown raw details.",
      parameters: [pathId(), ...pageParameters],
      responses: responses(list("activity", ref("Activity"))),
    },
  },
  "/api/v1/cards/{id}/attachments": {
    get: {
      tags: ["Anhänge"],
      operationId: "listCardAttachments",
      summary: "Sichtbare Anhänge auflisten",
      parameters: [pathId(), ...pageParameters],
      responses: responses(list("attachments", ref("Attachment"))),
    },
    post: {
      tags: ["Anhänge"],
      operationId: "uploadCardAttachment",
      summary: "Anhang hochladen",
      description:
        "Write scope; enabled attachment field. Exactly one file and kind. Max 25 MiB, PDF except student_card also PNG/JPEG. Named slots replace existing files; other appends. Storage and rollback cleanup follow the card lock. Inventory system boards are read-only.",
      parameters: [pathId()],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["file", "kind"],
              properties: {
                file: { type: "string", format: "binary" },
                kind: {
                  type: "string",
                  enum: [
                    "finance_request",
                    "annex_a",
                    "annex_b",
                    "student_card",
                    "other",
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        ...responses(envelope("attachment", ref("Attachment")), true),
        413: error,
      },
    },
  },
  "/api/v1/cards/{id}/attachments/{attachmentId}": {
    get: {
      tags: ["Anhänge"],
      operationId: "downloadCardAttachment",
      summary: "Sichtbaren Anhang herunterladen",
      parameters: [pathId(), pathId("attachmentId")],
      responses: {
        200: {
          description:
            "Binary attachment with no-store and safe Content-Disposition.",
          content: Object.fromEntries(
            ["application/pdf", "image/png", "image/jpeg"].map((mime) => [
              mime,
              { schema: { type: "string", format: "binary" } },
            ]),
          ),
        },
        401: error,
        404: error,
      },
    },
  },
  "/api/v1/cards/{id}/attachments/{attachmentId}/text": {
    get: {
      tags: ["Anhänge"], operationId: "readCardAttachmentText", summary: "PDF-Text einschließlich Formularwerten lesen",
      description: "Reads stored PDF bytes locally without modifying the file. No OCR. Default 10, maximum 20 pages; follow nextPage. At most 200,000 extracted characters and 500 fields per page; truncation is explicit. Password-protected, pure XFA or unreadable PDFs return 422. Processing is limited to 15 seconds, two concurrent extractions per process and 30 requests per user per minute.",
      parameters: [pathId(), pathId("attachmentId"), query("startPage", { type: "integer", minimum: 1, maximum: 1000000, default: 1 }), query("pageLimit", { type: "integer", minimum: 1, maximum: 20, default: 10 })],
      responses: { ...responses(ref("AttachmentText")), 413: error, 415: error, 422: error, 429: error },
    },
  },
} as const;
