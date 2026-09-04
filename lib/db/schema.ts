// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  index,
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
    // template_manager: wie user, darf zusätzlich Board-/Finanz-/Protokollvorlagen verwalten.
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
  // System-Board: dediziertes Leihvorgang-Board eines Inventars. NULL = normales
  // Kanban-Board. Zugriff/Freigaben spiegeln das Inventar; wird mit ihm gelöscht.
  inventoryBoardId: integer("inventory_board_id").references(
    (): AnyPgColumn => inventoryBoards.id,
    { onDelete: "cascade" },
  ),
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
    requestedAmount: integer("requested_amount"), // Beantragter Betrag in Cent
    number: text("number"), // Antragsnummer (board-spezifisch, optional)
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    creatorUserId: integer("creator_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Zugewiesene Nutzer: n:m über card_assignees (mehrere möglich), NICHT als
    // Spalte hier.
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
// card_assignees — „Zugewiesen zu" (n:m): eine Karte kann mehreren Nutzern
// zugewiesen sein. Mitgliedschaft = Board-Zugriff prüft die App-Logik.
// ---------------------------------------------------------------------------
export const cardAssignees = pgTable(
  "card_assignees",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.userId] }) }),
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
// Antragsformular-Dokumente: vom Admin verwaltete Dateien, die auf der
// öffentlichen Antragsseite unter „Wichtige Dokumente" angezeigt werden.
// ---------------------------------------------------------------------------
export const formDocuments = pgTable("form_documents", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  path: text("path").notNull(), // relativer Pfad im UPLOAD_DIR
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  position: integer("position").notNull().default(0),
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
// Protokolle — Nextcloud ist die einzige Quelle für Protokolldateien. In der
// DB liegen nur Konfiguration, technische Metadaten und Relationen.
// ---------------------------------------------------------------------------
export const protocolTemplates = pgTable("protocol_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  markdown: text("markdown").notNull(),
  createdAt: createdAt(),
});

export const protocolAreas = pgTable("protocol_areas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  ncUrl: text("nc_url").notNull(),
  ncUsername: text("nc_username").notNull(),
  ncPasswordEnc: text("nc_password_enc").notNull(),
  rootPath: text("root_path").notNull(),
  folderPattern: text("folder_pattern").notNull().default("{YYYY}-{MM}-{DD}"),
  filePattern: text("file_pattern").notNull().default("Protokoll.md"),
  templateId: integer("template_id")
    .references(() => protocolTemplates.id, { onDelete: "restrict" }),
  customTemplateMarkdown: text("custom_template_markdown").notNull().default(""),
  financeFields: jsonb("finance_fields").$type<{ key: string; enabled: boolean }[]>().notNull().default([]),
  decisionTemplateEnabled: boolean("decision_template_enabled").notNull().default(false),
  decisionTemplateMarkdown: text("decision_template_markdown").notNull().default(""),
  boardId: integer("board_id").references(() => boards.id, {
    onDelete: "set null",
  }),
  sourceStatusId: integer("source_status_id").references(
    () => boardStatuses.id,
    { onDelete: "set null" },
  ),
  decisionRefPattern: text("decision_ref_pattern")
    .notNull()
    .default("{session}-TOP-{top}"),
  createdAt: createdAt(),
});

export const protocolAreaAccess = pgTable(
  "protocol_area_access",
  {
    id: serial("id").primaryKey(),
    areaId: integer("area_id")
      .notNull()
      .references(() => protocolAreas.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    groupId: integer("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
  },
  (t) => ({
    oneSubject: check(
      "protocol_area_access_one_subject",
      sql`(${t.userId} is null) <> (${t.groupId} is null)`,
    ),
    uqUser: uniqueIndex("protocol_area_access_area_user_uq").on(
      t.areaId,
      t.userId,
    ),
    uqGroup: uniqueIndex("protocol_area_access_area_group_uq").on(
      t.areaId,
      t.groupId,
    ),
  }),
);

export const protocolLogos = pgTable("protocol_logos", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id").notNull().references(() => protocolAreas.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  pngBase64: text("png_base64").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
}, (t) => ({
  areaIndex: index("protocol_logos_area_idx").on(t.areaId, t.id),
  oneDefault: uniqueIndex("protocol_logos_default_uq").on(t.areaId).where(sql`${t.isDefault} = true`),
}));

export const protocolSessions = pgTable(
  "protocol_sessions",
  {
    id: serial("id").primaryKey(),
    areaId: integer("area_id")
      .notNull()
      .references(() => protocolAreas.id, { onDelete: "cascade" }),
    folderName: text("folder_name").notNull(),
    sessionDate: text("session_date"),
    folderFileId: text("folder_file_id"),
    folderEtag: text("folder_etag"),
    protocolPath: text("protocol_path"),
    protocolFileId: text("protocol_file_id"),
    protocolEtag: text("protocol_etag"),
    protocolLastModified: timestamp("protocol_last_modified", {
      withTimezone: true,
    }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => ({
    uqFolder: uniqueIndex("protocol_sessions_area_folder_uq").on(
      t.areaId,
      t.folderName,
    ),
  }),
);

export const protocolCardLinks = pgTable(
  "protocol_card_links",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => protocolSessions.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    top: text("top").notNull(),
    lastAutoDecisionRef: text("last_auto_decision_ref"),
    decisionRefConflict: boolean("decision_ref_conflict")
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqSessionCard: uniqueIndex("protocol_card_links_session_card_uq").on(
      t.sessionId,
      t.cardId,
    ),
  }),
);

export const protocolMembers = pgTable("protocol_members", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id").notNull().references(() => protocolAreas.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
}, (t) => ({
  areaOrder: index("protocol_members_area_order_idx").on(t.areaId, t.position, t.id),
  uniqueName: uniqueIndex("protocol_members_area_name_uq").on(t.areaId, sql`lower(${t.name})`),
  validName: check("protocol_members_name_check", sql`length(trim(${t.name})) between 1 and 200`),
}));

export const protocolAttendance = pgTable("protocol_attendance", {
  sessionId: integer("session_id").notNull().references(() => protocolSessions.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => protocolMembers.id, { onDelete: "cascade" }),
  present: boolean("present").notNull().default(false),
  proxyMemberId: integer("proxy_member_id").references(() => protocolMembers.id, { onDelete: "set null" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.memberId] }),
  memberIndex: index("protocol_attendance_member_idx").on(t.memberId),
  proxyIndex: index("protocol_attendance_proxy_idx").on(t.proxyMemberId),
  noSelfProxy: check("protocol_attendance_no_self_proxy", sql`${t.proxyMemberId} is null or ${t.proxyMemberId} <> ${t.memberId}`),
}));

export const protocolGuests = pgTable("protocol_guests", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => protocolSessions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  affiliation: text("affiliation").notNull().default(""),
  concern: text("concern").notNull().default(""),
}, (t) => ({
  sessionOrder: index("protocol_guests_session_order_idx").on(t.sessionId, t.id),
  validName: check("protocol_guests_name_check", sql`length(trim(${t.name})) between 1 and 200`),
  validFields: check("protocol_guests_fields_check", sql`length(${t.affiliation}) <= 300 and length(${t.concern}) <= 1000`),
}));

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
// Idempotenz öffentlicher API-Schreibzugriffe
// ---------------------------------------------------------------------------
// Native Apps (Mobilfunk, Timeouts) müssen Requests gefahrlos wiederholen
// können. Der Client schickt je Vorgang einen `Idempotency-Key`; hier liegt
// dessen SHA-256-Hash (nie der Klartext) zusammen mit einem kanonischen
// Fingerprint des Requests und der erzeugten Karte.
//
// Bewusst generisch gehalten (`scope`), damit weitere öffentliche Endpunkte
// dieselbe Tabelle nutzen können. Der Datensatz entsteht IMMER in derselben
// Transaktion wie die Karte — es gibt weder einen Eintrag ohne Karte noch eine
// per API erzeugte Karte ohne Eintrag.
export const apiIdempotencyKeys = pgTable(
  "api_idempotency_keys",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(), // z. B. 'public-application'
    keyHash: text("key_hash").notNull(), // SHA-256 des Idempotency-Key (hex)
    requestHash: text("request_hash").notNull(), // kanonischer Request-Fingerprint
    // Pseudonyme Kennung des einreichenden Clients (HMAC der IP, siehe
    // lib/client-ip.ts) — NIE die IP selbst. Ein Replay liefert den geheimen
    // Status-Link zurück; ohne diese Bindung genügte ein erratener/abgefangener
    // Idempotency-Key mit identischen Daten, um an den Vorgang eines FREMDEN
    // Clients zu kommen. Weicht die Kennung ab, wird der Schlüssel wie ein
    // Konflikt behandelt (409) statt als Replay beantwortet.
    // NULL = Altbestand aus der Zeit vor dieser Prüfung; solche Zeilen bleiben
    // replay-fähig und verfallen ohnehin nach IDEMPOTENCY_TTL_DAYS.
    clientHash: text("client_hash"),
    // Wird die Karte gelöscht, verfällt auch der Schlüssel — sonst bliebe ein
    // Eintrag zurück, der auf nichts mehr zeigt.
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => ({
    uq: uniqueIndex("api_idempotency_keys_scope_key_uq").on(t.scope, t.keyHash),
  }),
);

// ---------------------------------------------------------------------------
// Umfragen / Feedback
// ---------------------------------------------------------------------------
// Feedback-Bereiche routen öffentliche Einreichungen — fachlich exakt wie die
// Standorte des Antragsformulars, nur für /feedback. Bewusst eine eigene
// Tabelle statt eines Flags an `locations`: die beiden Formulare haben eigene
// Bereichslisten, und ein Standort soll nicht versehentlich im Feedback
// auftauchen (oder umgekehrt).
export const feedbackAreas = pgTable("feedback_areas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  position: integer("position").notNull().default(0),
  // Wie bei `locations` bewusst RESTRICT statt CASCADE: Ein Board/eine Spalte
  // darf nicht stillschweigend verschwinden, während ein Bereich noch darauf
  // routet — der Admin muss das Routing erst umstellen.
  targetBoardId: integer("target_board_id").references(() => boards.id, {
    onDelete: "restrict",
  }),
  targetStatusId: integer("target_status_id").references(
    () => boardStatuses.id,
    { onDelete: "restrict" },
  ),
  createdAt: createdAt(),
});

// Herkunfts-Snapshot je Feedback-Karte.
//
// Zwei Aufgaben: (1) Feedback-Karten zuverlässig von Antragskarten unterscheiden
// — auch dann noch, wenn der Bereich später gelöscht wurde; (2) die
// ursprüngliche Einreichung unveränderlich festhalten. Intern darf das Gremium
// `cards.applicant`/`cards.notes` bearbeiten; die öffentliche Statusseite und
// die PDF-Eingangsbestätigung zeigen trotzdem weiter das, was eingereicht wurde.
export const feedbackSubmissions = pgTable("feedback_submissions", {
  id: serial("id").primaryKey(),
  // Genau eine Einreichung je Karte; verschwindet die Karte, verschwindet auch
  // der Snapshot.
  cardId: integer("card_id")
    .notNull()
    .unique()
    .references(() => cards.id, { onDelete: "cascade" }),
  // SET NULL: Wird ein Bereich gelöscht, bleiben Karte und Snapshot bestehen —
  // der Name unten trägt die Herkunft weiter.
  areaId: integer("area_id").references(() => feedbackAreas.id, {
    onDelete: "set null",
  }),
  areaName: text("area_name").notNull(), // Snapshot des Bereichsnamens
  submitterName: text("submitter_name").notNull(),
  feedbackText: text("feedback_text").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Inventar- & Entleihsystem
// ---------------------------------------------------------------------------
// Inventar-Boards: eigenständige Listen (z. B. je StuRa-Standort oder Fach-
// bereich). Zugriff intern wie bei Kanban-Boards: Eigentümer + Freigaben
// (inventory_board_access). `isPublic` (nur Admin) steuert, ob das Board im
// öffentlichen Bereich /inventar erscheint.
export const inventoryBoards = pgTable("inventory_boards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  isPublic: boolean("is_public").notNull().default(false),
  // In die board-übergreifende Gesamtübersicht (Anlagenverzeichnis) einbeziehen.
  includeInOverview: boolean("include_in_overview").notNull().default(false),
  // Aufgabentracking: Leihvorgänge landen als Karte auf diesem Kanban-Board.
  // Der Antragsteller sieht die Spalten dieses Boards als Status. NULL = aus.
  loanBoardId: integer("loan_board_id").references(() => boards.id, {
    onDelete: "set null",
  }),
  // Erreicht die Karte diese Spalte → Gegenstand gilt als ausgeliehen (Vorgang
  // active). Erreicht sie die „zurückgegeben"-Spalte → Vorgang returned.
  loanActiveStatusId: integer("loan_active_status_id").references(
    () => boardStatuses.id,
    { onDelete: "set null" },
  ),
  loanReturnedStatusId: integer("loan_returned_status_id").references(
    () => boardStatuses.id,
    { onDelete: "set null" },
  ),
  createdAt: createdAt(),
});

// Einstellungen der Gesamtübersicht (Singleton, id=1): Mindestpreis in Cent.
export const inventoryOverviewConfig = pgTable("inventory_overview_config", {
  id: integer("id").primaryKey().default(1),
  minPrice: integer("min_price").notNull().default(0),
});

// Freigabe eines Inventar-Boards an Nutzer ODER Gruppe (binär), wie board_access.
export const inventoryBoardAccess = pgTable(
  "inventory_board_access",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => inventoryBoards.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    groupId: integer("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
  },
  (t) => ({
    oneSubject: check(
      "inventory_board_access_one_subject",
      sql`(${t.userId} is null) <> (${t.groupId} is null)`,
    ),
    uqUser: uniqueIndex("inventory_board_access_board_user_uq").on(
      t.boardId,
      t.userId,
    ),
    uqGroup: uniqueIndex("inventory_board_access_board_group_uq").on(
      t.boardId,
      t.groupId,
    ),
  }),
);

// Erweiterbare Auswahloptionen je Inventar-Board: Kategorien, Standorte,
// Entleihstatus — eine Tabelle, unterschieden über `kind`. Direkt beim Erfassen
// eines Gegenstands erweiterbar (neue Option anlegen).
export const inventoryOptions = pgTable(
  "inventory_options",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => inventoryBoards.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // category | location | loan_status
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({
    kindCheck: check(
      "inventory_options_kind",
      sql`${t.kind} in ('category','location','loan_status')`,
    ),
    uq: uniqueIndex("inventory_options_board_kind_name_uq").on(
      t.boardId,
      t.kind,
      t.name,
    ),
  }),
);

// Gegenstände eines Inventar-Boards. Entleih-/Mängel-Historie und Belege folgen
// in einer späteren Phase (eigene Tabellen) — hier die Stammdaten.
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id")
    .notNull()
    .references(() => inventoryBoards.id, { onDelete: "cascade" }),
  number: text("number"), // Inventarnummer (board-spezifisch, optional/auto)
  name: text("name").notNull().default(""), // Bezeichnung
  // „Artikel/Gruppe": Stücke mit gleichem groupName bilden eine Gruppe (Stückzahl).
  groupName: text("group_name"),
  // Stückzahl dieses EINEN Gegenstands (eine Nummer, aber mehrere physische
  // Einheiten, z. B. 100 Becher). Standard 1. Verfügbare Menge =
  // quantity − Summe der aktuell verliehenen Mengen.
  quantity: integer("quantity").notNull().default(1),
  // Ist der Gegenstand prinzipiell entleihbar? Nicht-entleihbare sind öffentlich
  // unsichtbar. Der laufende Status (verfügbar/entliehen) ergibt sich automatisch
  // aus den Entleihvorgängen.
  lendable: boolean("lendable").notNull().default(true),
  locationId: integer("location_id").references(() => inventoryOptions.id, {
    onDelete: "set null",
  }),
  // Altes manuelles „Entleihstatus"-Select — wird nicht mehr verwendet (Status
  // ist jetzt automatisch). Spalte bleibt für Bestandsdaten erhalten.
  loanStatusId: integer("loan_status_id").references(() => inventoryOptions.id, {
    onDelete: "set null",
  }),
  price: integer("price"), // Kaufpreis in Cent
  purchaseDate: text("purchase_date"), // YYYY-MM-DD
  vendor: text("vendor"), // Händler
  serialNumber: text("serial_number"), // Seriennummer (nur intern sichtbar)
  // Interner Zustand des einzelnen Stücks. defect/lost landen im Archiv und
  // sind nicht entleihbar / öffentlich unsichtbar.
  condition: text("condition").notNull().default("active"), // active|defect|lost
  conditionNote: text("condition_note"), // Grund/Notiz zum Zustand (Archiv)
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  creatorUserId: integer("creator_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
}, (t) => ({
  conditionCheck: check(
    "inventory_items_condition",
    sql`${t.condition} in ('active','defect','lost')`,
  ),
  quantityCheck: check("inventory_items_quantity", sql`${t.quantity} >= 1`),
}));

// n:m Gegenstand ↔ Kategorie-Option (Multiselect).
export const inventoryItemCategories = pgTable(
  "inventory_item_categories",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    optionId: integer("option_id")
      .notNull()
      .references(() => inventoryOptions.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.itemId, t.optionId] }) }),
);

// Sichtbare/konfigurierbare Felder je Inventar-Board (wie board_card_fields).
export const inventoryBoardFields = pgTable(
  "inventory_board_fields",
  {
    boardId: integer("board_id")
      .notNull()
      .references(() => inventoryBoards.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    visible: boolean("visible").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.boardId, t.fieldKey] }) }),
);

// Auto-Inventarnummer je Board (wie board_numbering).
export const inventoryNumbering = pgTable("inventory_numbering", {
  boardId: integer("board_id")
    .primaryKey()
    .references(() => inventoryBoards.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  prefix: text("prefix").notNull().default(""),
  year: text("year").notNull().default(""),
  code: text("code").notNull().default(""),
  separator: text("separator").notNull().default("_"),
  padding: integer("padding").notNull().default(0),
  next: integer("next").notNull().default(1),
});

// Entleihvorgänge je Gegenstand (Historie). status='active' (und returnedAt
// NULL) = laufend → bestimmt „aktuell bei". 'requested' = öffentliche Anfrage,
// die intern noch geprüft wird; 'rejected' = abgelehnt; 'returned' = zurück.
export const inventoryLoans = pgTable(
  "inventory_loans",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    // requested → contract_provided → contract_signed → active → returned;
    // rejected/withdrawn sind Endzustände vor der Annahme.
    status: text("status").notNull().default("active"),
    token: text("token"), // öffentlicher Status-Link bei Anfragen (sonst NULL)
    borrower: text("borrower").notNull(), // Entleiher
    borrowerEmail: text("borrower_email"), // bei öffentlicher Anfrage Pflicht
    purpose: text("purpose"), // Verwendungsort/Zweck
    startDate: text("start_date"), // YYYY-MM-DD
    endDate: text("end_date"), // YYYY-MM-DD (entliehen bis)
    // Angefragte Stückzahl (bei Anfrage gesetzt, unveränderlich). Die bestätigte
    // Stückzahl = Anzahl der aktuell zugeordneten Stücke (inventory_loan_items).
    requestedQuantity: integer("requested_quantity").notNull().default(1),
    returnedAt: timestamp("returned_at", { withTimezone: true }), // null = laufend
    notes: text("notes"),
    // Hinweise des Verleihers an den Entleiher — über den Status-Link sichtbar.
    borrowerNote: text("borrower_note"),
    // Aufgabentracking: verknüpfte Kanban-Karte (NULL = kein Ziel-Board gesetzt).
    cardId: integer("card_id").references(() => cards.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    statusCheck: check(
      "inventory_loans_status",
      sql`${t.status} in ('requested','contract_provided','contract_signed','active','returned','rejected','withdrawn')`,
    ),
    tokenUq: uniqueIndex("inventory_loans_token_uq").on(t.token),
  }),
);

// Ein Entleihvorgang reserviert 1..n konkrete Stücke (Stückzahl-Ausleihe).
export const inventoryLoanItems = pgTable(
  "inventory_loan_items",
  {
    loanId: integer("loan_id")
      .notNull()
      .references(() => inventoryLoans.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    // Reservierte Menge dieses Stücks im Vorgang. Einzel-/Gruppen-Stücke: 1.
    // Mengen-Gegenstand: die entliehene Anzahl (1..item.quantity).
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.loanId, t.itemId] }),
    quantityCheck: check(
      "inventory_loan_items_quantity",
      sql`${t.quantity} >= 1`,
    ),
  }),
);

// Mängel je Gegenstand (Historie). resolvedAt IS NULL = bekannter offener Mangel.
export const inventoryDefects = pgTable("inventory_defects", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }), // null = offen
  createdAt: createdAt(),
  createdBy: integer("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

// Dateien je Gegenstand (append-only Historie): Kaufbelege, Leihanträge,
// Leihverträge. Nie automatisch gelöscht → Nachvollziehbarkeit. loanId
// verknüpft Leihantrag/-vertrag optional mit dem konkreten Entleihvorgang.
//
// AUSNAHME `student_card`: Der bei einer öffentlichen Anfrage hochgeladene
// Studierendenausweis ist ein Ausweisdokument und damit deutlich sensibler als
// die übrigen Arten. Er ist bewusst ein EIGENER kind — nicht `loan_request` —,
// weil `loan_request` über den öffentlichen Status-Token abrufbar ist. Der
// Ausweis wird ausschließlich intern (nach Board-Zugriffsprüfung) ausgeliefert
// und beim Löschen des Vorgangs mitgelöscht — auf BEIDEN Wegen: direkt über
// `deleteLoan` (lib/inventory-loans.ts) und über den FK-Cascade, wenn das
// Leit-Stück des Vorgangs gelöscht wird (`deleteInventoryItem` in
// lib/inventory-items.ts). Der zweite Weg braucht eine eigene Behandlung, weil
// `loan_id` unten ON DELETE SET NULL ist: Der Cascade nähme den Vorgang mit,
// den Ausweis aber nicht — er bliebe unzugeordnet am Gegenstand liegen, an dem
// er hängt (nicht zwingend das gelöschte Stück, siehe removeLoanItem).
export const inventoryAttachments = pgTable(
  "inventory_attachments",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    // Beim Löschen eines Vorgangs würde `set null` den Ausweis als verwaiste,
    // unzugeordnete Datei zurücklassen — deleteLoan löscht student_card-Anhänge
    // deshalb vorher explizit inkl. Datei.
    loanId: integer("loan_id").references(() => inventoryLoans.id, {
      onDelete: "set null",
    }),
    // receipt | loan_request | loan_contract | student_card | other
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    uploadedAt: createdAt(),
    uploadedBy: integer("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    kindCheck: check(
      "inventory_attachments_kind",
      sql`${t.kind} in ('receipt','loan_request','loan_contract','student_card','other')`,
    ),
  }),
);

// Persönliche Reihenfolge der Inventar-Boards je Nutzer (wie user_board_order).
export const userInventoryBoardOrder = pgTable(
  "user_inventory_board_order",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardId: integer("board_id")
      .notNull()
      .references(() => inventoryBoards.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.boardId] }) }),
);

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
export type FormDocument = typeof formDocuments.$inferSelect;
export type CardComment = typeof cardComments.$inferSelect;
export type CardActivity = typeof cardActivity.$inferSelect;
export type FinanceBoard = typeof financeBoards.$inferSelect;
export type FinancePlanItem = typeof financePlanItems.$inferSelect;
export type FinanceTemplate = typeof financeTemplates.$inferSelect;
export type FinanceTemplateItem = typeof financeTemplateItems.$inferSelect;
export type ProtocolTemplate = typeof protocolTemplates.$inferSelect;
export type ProtocolArea = typeof protocolAreas.$inferSelect;
export type ProtocolAreaAccess = typeof protocolAreaAccess.$inferSelect;
export type ProtocolSession = typeof protocolSessions.$inferSelect;
export type ProtocolCardLink = typeof protocolCardLinks.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type ApiTokenScope = ApiToken["scope"];
export type UserTaskPrefs = typeof userTaskPrefs.$inferSelect;
export type ApiIdempotencyKey = typeof apiIdempotencyKeys.$inferSelect;
export type FeedbackArea = typeof feedbackAreas.$inferSelect;
export type FeedbackSubmission = typeof feedbackSubmissions.$inferSelect;
export type InventoryBoard = typeof inventoryBoards.$inferSelect;
export type InventoryBoardAccess = typeof inventoryBoardAccess.$inferSelect;
export type InventoryOption = typeof inventoryOptions.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
export type InventoryBoardField = typeof inventoryBoardFields.$inferSelect;
export type InventoryNumbering = typeof inventoryNumbering.$inferSelect;
export type InventoryLoan = typeof inventoryLoans.$inferSelect;
export type InventoryDefect = typeof inventoryDefects.$inferSelect;
export type InventoryAttachment = typeof inventoryAttachments.$inferSelect;
