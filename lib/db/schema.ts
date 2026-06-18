// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    // OIDC-Subject (stabile, immutable ID des SSO); Verknüpfung zum SSO-Konto.
    sub: text("sub").unique(),
    name: text("name"), // Anzeigename aus dem SSO
    email: text("email"), // E-Mail aus dem SSO (email-Scope), optional
    // Wird seit der SSO-Umstellung nicht mehr verwendet (Login läuft über OIDC).
    passwordHash: text("password_hash"),
    // template_manager: wie user, darf zusätzlich Board-/Finanz-Templates verwalten.
    role: text("role", { enum: ["admin", "template_manager", "user"] })
      .notNull()
      .default("user"),
    isActive: boolean("is_active").notNull().default(true),
    avatarPath: text("avatar_path"),
    // Persönliches Signatur-Zertifikat (PKCS#12 / .p12) für die PDF-Signierung.
    // p12-Bytes (base64) UND Passphrase liegen AES-256-GCM-verschlüsselt
    // (ENCRYPTION_KEY) in der DB — nie im Klartext. Metadaten nur zur Anzeige.
    certP12Enc: text("cert_p12_enc"),
    certPassEnc: text("cert_pass_enc"),
    certSubject: text("cert_subject"), // Inhaber (CN) — Anzeige
    certNotAfter: timestamp("cert_not_after", { withTimezone: true }), // Gültig bis
    certUploadedAt: timestamp("cert_uploaded_at", { withTimezone: true }),
    // Optionales Unterschriftsbild (PNG) — rein optisch in der Signatur-Box.
    signaturePath: text("signature_path"),
    createdAt: createdAt(),
  },
  (t) => ({
    roleCheck: check(
      "users_role_check",
      sql`${t.role} in ('admin','template_manager','user')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// groups + user_groups (n:m)
// ---------------------------------------------------------------------------
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: createdAt(),
});

export const userGroups = pgTable(
  "user_groups",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.groupId] }) }),
);

// ---------------------------------------------------------------------------
// boards (owner_id NICHT cascade — beim Löschen des Eigentümers umhängen)
// ---------------------------------------------------------------------------
export const boards = pgTable("boards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  // Standardkonto: wird bei neuen Karten automatisch vorausgewählt.
  defaultAccountId: integer("default_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  // Öffentliches Einreichen — Gate 1 „Nachreichung": Spalte, ab der der
  // Antragsteller über den Status-Link einreichen kann. Beim Einreichen bleibt
  // die Karte in dieser Spalte liegen, wird aber farblich markiert
  // (cards.resubmitted_at) — keine eigene „Nachgereicht"-Spalte nötig.
  resubmitStatusId: integer("resubmit_status_id").references(
    (): AnyPgColumn => boardStatuses.id,
    { onDelete: "set null" },
  ),
  // Gate 2 „Quittung": Spalte, ab der eingereicht werden kann (from), + Ziel-
  // spalte, in die die Karte nach dem Einreichen verschoben wird (to).
  receiptFromStatusId: integer("receipt_from_status_id").references(
    (): AnyPgColumn => boardStatuses.id,
    { onDelete: "set null" },
  ),
  receiptToStatusId: integer("receipt_to_status_id").references(
    (): AnyPgColumn => boardStatuses.id,
    { onDelete: "set null" },
  ),
  // „Done"-Spalte: Karten hier werden täglich zur Uhrzeit doneSweepTime
  // archiviert (ausgeblendet). NULL = Funktion aus.
  doneStatusId: integer("done_status_id").references(
    (): AnyPgColumn => boardStatuses.id,
    { onDelete: "set null" },
  ),
  doneSweepTime: text("done_sweep_time"), // "HH:MM" (lokale Zeit), NULL = aus
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// board_access — Freigabe an genau einen Nutzer ODER eine Gruppe
// ---------------------------------------------------------------------------
export const boardAccess = pgTable(
  "board_access",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    groupId: integer("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
  },
  (t) => ({
    oneSubject: check(
      "board_access_one_subject",
      sql`(${t.userId} is null) <> (${t.groupId} is null)`,
    ),
    uqUser: uniqueIndex("board_access_board_user_uq").on(t.boardId, t.userId),
    uqGroup: uniqueIndex("board_access_board_group_uq").on(t.boardId, t.groupId),
  }),
);

// ---------------------------------------------------------------------------
// board_statuses — Spalten pro Board, max. ein Archiv-Trigger
// ---------------------------------------------------------------------------
export const boardStatuses = pgTable(
  "board_statuses",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    isArchiveTrigger: boolean("is_archive_trigger").notNull().default(false),
    // Erreicht eine Karte diese Spalte, wird das Anweisungsdatum auto-gesetzt.
    isInstructionTrigger: boolean("is_instruction_trigger")
      .notNull()
      .default(false),
    // Erreicht eine Karte diese Spalte, wird das Überweisungsdatum auto-gesetzt.
    isTransferTrigger: boolean("is_transfer_trigger").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    // Archiv-Trigger: bewusst KEIN Unique-Index mehr — pro Board sind bis zu
    // ZWEI Trigger-Spalten erlaubt (App-Logik begrenzt auf max. 2).
    oneInstrTrigger: uniqueIndex("board_statuses_one_instr_trigger")
      .on(t.boardId)
      .where(sql`${t.isInstructionTrigger} = true`),
    oneTransferTrigger: uniqueIndex("board_statuses_one_transfer_trigger")
      .on(t.boardId)
      .where(sql`${t.isTransferTrigger} = true`),
  }),
);

// ---------------------------------------------------------------------------
// board_archive — Nextcloud-Verbindung pro Board (1:1)
// ---------------------------------------------------------------------------
export const boardArchive = pgTable("board_archive", {
  boardId: integer("board_id")
    .primaryKey()
    .references(() => boards.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  ncUrl: text("nc_url"),
  ncUsername: text("nc_username"),
  ncPasswordEnc: text("nc_password_enc"),
  targetFolder: text("target_folder"),
  // Ordnername-Konfiguration: CSV der Feld-Keys (Reihenfolge zählt) + Trennzeichen
  // (leer = Leerzeichen).
  folderFields: text("folder_fields").notNull().default("number,title"),
  folderSeparator: text("folder_separator").notNull().default(" "),
});

// Antragsnummern-Konfiguration pro Board (1:1).
export const boardNumbering = pgTable("board_numbering", {
  boardId: integer("board_id")
    .primaryKey()
    .references(() => boards.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  prefix: text("prefix").notNull().default(""),
  year: text("year").notNull().default(""),
  code: text("code").notNull().default(""),
  separator: text("separator").notNull().default("_"),
  padding: integer("padding").notNull().default(0),
  next: integer("next").notNull().default(1), // nächste zu vergebende Nummer
});

// ---------------------------------------------------------------------------
// locations — Standorte & Formular-Routing (target_* NICHT cascade)
// ---------------------------------------------------------------------------
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  position: integer("position").notNull().default(0),
  targetBoardId: integer("target_board_id").references(() => boards.id, {
    onDelete: "restrict",
  }),
  targetStatusId: integer("target_status_id").references(
    () => boardStatuses.id,
    { onDelete: "restrict" },
  ),
});

// ---------------------------------------------------------------------------
// cards (vormals "cards") — Karten
// ---------------------------------------------------------------------------
export const cards = pgTable(
  "cards",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    statusId: integer("status_id")
      .notNull()
      .references(() => boardStatuses.id, { onDelete: "restrict" }),
    locationId: integer("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    applicant: text("applicant").notNull(),
    budgetTitle: text("budget_title"), // optionaler "Haushaltstitel"
    number: text("number"), // Antragsnummer (board-spezifisch, optional)
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    creatorUserId: integer("creator_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assigneeUserId: integer("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    deadline: text("deadline"), // YYYY-MM-DD
    meeting: text("meeting"), // YYYY-MM-DD
    // Freitext-Referenz auf den Gremienbeschluss (z. B. "Beschluss 12/2026").
    decisionRef: text("decision_ref"),
    instructionDate: text("instruction_date"), // YYYY-MM-DD, auto bei Trigger-Spalte
    transferDate: text("transfer_date"), // YYYY-MM-DD, auto bei Überweisungs-Trigger-Spalte
    approvedAmount: integer("approved_amount"), // Genehmigter Betrag in Cent
    actualAmount: integer("actual_amount"), // Tatsächliche Ausgaben in Cent
    priorityId: integer("priority_id").references(() => priorities.id, {
      onDelete: "set null",
    }),
    accountId: integer("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    // Hinweis für den Antragsteller — auch öffentlich über den Status-Link sichtbar.
    applicantNote: text("applicant_note"),
    nextcloudLink: text("nextcloud_link"),
    // Gesetzt, wenn der Antragsteller über den Status-Link eine „Nachreichung"
    // eingereicht hat (Gate 1). Markiert die Karte farblich; wird bei jedem
    // Statuswechsel wieder geleert.
    resubmittedAt: timestamp("resubmitted_at", { withTimezone: true }),
    position: integer("position").notNull().default(0), // Reihenfolge in der Spalte
    // „Done"-Archiv: gesetzt → Karte ist erledigt & ausgeblendet (nicht gelöscht).
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Zeitpunkt, seit dem die Karte in der Done-Spalte liegt (für den Sweep).
    doneSince: timestamp("done_since", { withTimezone: true }),
    // Nextcloud-Archiv-Retry: schlägt die Archivierung in der Trigger-Spalte fehl
    // (Nextcloud nicht erreichbar, falsches Passwort …), wird sie periodisch
    // erneut versucht, bis sie klappt. Nach >24 h Dauerfehler erscheint eine
    // Warnung auf dem Dashboard. nextcloudLink != NULL = endgültig erledigt.
    archivePending: boolean("archive_pending").notNull().default(false),
    archiveFirstFailedAt: timestamp("archive_first_failed_at", {
      withTimezone: true,
    }),
    archiveLastAttemptAt: timestamp("archive_last_attempt_at", {
      withTimezone: true,
    }),
    archiveLastError: text("archive_last_error"),
  },
);

// ---------------------------------------------------------------------------
// attachments — benannte Slots (je max. 1) + "other" (unbegrenzt)
// ---------------------------------------------------------------------------
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "finance_request",
        "annex_a",
        "annex_b",
        "student_card",
        "other",
      ],
    }).notNull(),
    filename: text("filename").notNull(),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedBy: integer("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    slotUnique: uniqueIndex("attachments_slot_uq")
      .on(t.cardId, t.kind)
      .where(sql`${t.kind} <> 'other'`),
  }),
);

// ---------------------------------------------------------------------------
// board_card_fields — Sichtbarkeit pro Board
// ---------------------------------------------------------------------------
export const boardCardFields = pgTable(
  "board_card_fields",
  {
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    visible: boolean("visible").notNull().default(true),
    position: integer("position").notNull().default(0), // Reihenfolge der Felder
  },
  (t) => ({ pk: primaryKey({ columns: [t.boardId, t.fieldKey] }) }),
);

// ---------------------------------------------------------------------------
// board_templates — Vorlagen für neue Boards (vom Admin verwaltet)
// ---------------------------------------------------------------------------
export const boardTemplates = pgTable("board_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: createdAt(),
});

export const boardTemplateStatuses = pgTable(
  "board_template_statuses",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => boardTemplates.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    isArchiveTrigger: boolean("is_archive_trigger").notNull().default(false),
  },
  (t) => ({
    oneTrigger: uniqueIndex("board_template_statuses_one_trigger")
      .on(t.templateId)
      .where(sql`${t.isArchiveTrigger} = true`),
  }),
);

// ---------------------------------------------------------------------------
// Kommentare & Aktivität pro Karte (rein intern)
// ---------------------------------------------------------------------------
export const cardComments = pgTable("card_comments", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const cardActivity = pgTable("card_activity", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(), // created|status|assignee|attachment_added|attachment_removed
  detail: text("detail"), // vorgerenderter deutscher Text
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Konten (frei vom Admin verwaltbare Auswahloptionen für das Kartenfeld "Konto")
// ---------------------------------------------------------------------------
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Prioritäten — frei im Admin-Panel verwaltbare Auswahloptionen (Anzahl,
// Bezeichnung und Farbe). cards.priority_id verweist hierauf (SET NULL).
// ---------------------------------------------------------------------------
export const priorities = pgTable("priorities", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  color: text("color").notNull().default("slate"),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Finanzübersichten ("Finanzboards")
// ---------------------------------------------------------------------------
export const financeBoards = pgTable("finance_boards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
});

// Betroffene Konten (n:m): nur Karten mit EINEM dieser Konten (und aus einem
// Quell-Board, mit gesetztem Haushaltstitel) fließen in die Auswertung ein.
// Maßgeblich für die Antragsübersicht (und Default für die Ausgaben-Berechnung).
export const financeBoardAccounts = pgTable(
  "finance_board_accounts",
  {
    financeBoardId: integer("finance_board_id")
      .notNull()
      .references(() => financeBoards.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.financeBoardId, t.accountId] }) }),
);

// Optionaler Konten-Override für die Ausgaben-Berechnung (Live & Tatsächlich):
// Teilmenge von finance_board_accounts. Leer = alle betroffenen Konten zählen
// (wie bisher); gesetzt = nur diese Konten fließen in die Ausgaben-Views ein.
export const financeBoardExpenseAccounts = pgTable(
  "finance_board_expense_accounts",
  {
    financeBoardId: integer("finance_board_id")
      .notNull()
      .references(() => financeBoards.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.financeBoardId, t.accountId] }) }),
);

// Freigabe an genau einen Nutzer ODER eine Gruppe (wie board_access).
export const financeBoardAccess = pgTable(
  "finance_board_access",
  {
    id: serial("id").primaryKey(),
    financeBoardId: integer("finance_board_id")
      .notNull()
      .references(() => financeBoards.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
  },
  (t) => ({
    oneSubject: check(
      "finance_board_access_one_subject",
      sql`(${t.userId} is null) <> (${t.groupId} is null)`,
    ),
    uqUser: uniqueIndex("finance_board_access_user_uq").on(
      t.financeBoardId,
      t.userId,
    ),
    uqGroup: uniqueIndex("finance_board_access_group_uq").on(
      t.financeBoardId,
      t.groupId,
    ),
  }),
);

// Quell-Boards (n:m) — aus diesen werden Karten gezogen.
export const financeBoardSources = pgTable(
  "finance_board_sources",
  {
    financeBoardId: integer("finance_board_id")
      .notNull()
      .references(() => financeBoards.id, { onDelete: "cascade" }),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.financeBoardId, t.boardId] }) }),
);

// Haushaltsplan-Positionen: Ober-/Unterpunkte (parent_id), Beträge in Cent.
export const financePlanItems = pgTable("finance_plan_items", {
  id: serial("id").primaryKey(),
  financeBoardId: integer("finance_board_id")
    .notNull()
    .references(() => financeBoards.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").references(
    (): AnyPgColumn => financePlanItems.id,
    { onDelete: "cascade" },
  ),
  // Einnahme oder Ausgabe — bestimmt die Gruppe in der Übersicht. Nur Ausgaben
  // fließen in die Ausgaben-Auswertungen ein. Für Unterpunkte = Kind des Ober-
  // punkts.
  kind: text("kind", { enum: ["income", "expense"] })
    .notNull()
    .default("expense"),
  haushaltstitel: text("haushaltstitel").notNull().default(""),
  title: text("title").notNull().default(""),
  plannedAmount: integer("planned_amount"), // Cent
  position: integer("position").notNull().default(0),
});

// Finanz-Templates (Haushaltsplan-Vorlagen, vom Admin verwaltet).
export const financeTemplates = pgTable("finance_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: createdAt(),
});

export const financeTemplateItems = pgTable("finance_template_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id")
    .notNull()
    .references(() => financeTemplates.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").references(
    (): AnyPgColumn => financeTemplateItems.id,
    { onDelete: "cascade" },
  ),
  kind: text("kind", { enum: ["income", "expense"] })
    .notNull()
    .default("expense"),
  haushaltstitel: text("haushaltstitel").notNull().default(""),
  title: text("title").notNull().default(""),
  plannedAmount: integer("planned_amount"),
  position: integer("position").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Persönliche Board-Reihenfolge (je Nutzer frei anordnenbar)
// ---------------------------------------------------------------------------
export const userBoardOrder = pgTable(
  "user_board_order",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.boardId] }) }),
);

export const userFinanceBoardOrder = pgTable(
  "user_finance_board_order",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    financeBoardId: integer("finance_board_id")
      .notNull()
      .references(() => financeBoards.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.financeBoardId] }) }),
);

// ---------------------------------------------------------------------------
// api_tokens — persönliche Zugriffstokens für die externe REST-API (/api/v1)
// Ein Token gehört einem Nutzer und erbt dessen Board-Zugriffe (Eigentum +
// Freigaben über Nutzer/Gruppen + Admin). Gespeichert wird nur der SHA-256-Hash;
// der Klartext wird genau einmal bei der Erstellung angezeigt.
// ---------------------------------------------------------------------------
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(), // Anzeige-Präfix (z.B. "grm_ab12cd")
    // Rechtestufe: 'read' = nur GET, 'write' = lesen + schreiben.
    scope: text("scope", { enum: ["read", "write"] })
      .notNull()
      .default("write"),
    // Board-Beschränkung explizit: true = nur die in api_token_boards genannten
    // Boards. Ohne dieses Flag wäre „keine Zeilen" mehrdeutig (nie beschränkt
    // vs. alle Beschränkungs-Boards gelöscht → Token würde unbeabsichtigt alle
    // Boards des Nutzers freigeben).
    restricted: boolean("restricted").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    scopeCheck: check("api_tokens_scope_check", sql`${t.scope} in ('read','write')`),
  }),
);

// Board-Beschränkung eines Tokens (n:m). Maßgeblich ist apiTokens.restricted:
// restricted=false → alle Boards des Nutzers; restricted=true → nur diese Zeilen
// (leere Menge möglich, wenn die Boards gelöscht wurden → kein Zugriff). Immer
// zusätzlich zur Live-Prüfung der Nutzer-Zugriffe — ein Token gewährt nie mehr,
// als der Nutzer selbst aktuell hat.
export const apiTokenBoards = pgTable(
  "api_token_boards",
  {
    tokenId: integer("token_id")
      .notNull()
      .references(() => apiTokens.id, { onDelete: "cascade" }),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tokenId, t.boardId] }) }),
);

// ---------------------------------------------------------------------------
// user_task_prefs — Einstellungen der „Meine Aufgaben"-Übersicht je Nutzer.
// config (jsonb): { boards: { [boardId]: { enabled, excludedStatusIds[], fields[] } } }
// ---------------------------------------------------------------------------
export const userTaskPrefs = pgTable("user_task_prefs", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  config: jsonb("config").notNull().default({}),
});

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type BoardStatus = typeof boardStatuses.$inferSelect;
export type BoardArchive = typeof boardArchive.$inferSelect;
export type BoardNumbering = typeof boardNumbering.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type BoardCardField = typeof boardCardFields.$inferSelect;
export type BoardTemplate = typeof boardTemplates.$inferSelect;
export type BoardTemplateStatus = typeof boardTemplateStatuses.$inferSelect;
export type PriorityRow = typeof priorities.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type CardComment = typeof cardComments.$inferSelect;
export type CardActivity = typeof cardActivity.$inferSelect;
export type FinanceBoard = typeof financeBoards.$inferSelect;
export type FinancePlanItem = typeof financePlanItems.$inferSelect;
export type FinanceTemplate = typeof financeTemplates.$inferSelect;
export type FinanceTemplateItem = typeof financeTemplateItems.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type ApiTokenScope = ApiToken["scope"];
export type UserTaskPrefs = typeof userTaskPrefs.$inferSelect;
