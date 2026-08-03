# Implementierungsplan — Gremio

> ## ⚠️ ARCHIV — historisches Dokument
>
> **Dieser Bauplan beschreibt die Erstumsetzung (MVP) und wird nicht mehr
> gepflegt.** Alle Phasen 0–10 sind abgeschlossen; seither hat sich die App in
> wesentlichen Punkten weiterentwickelt. Er bleibt nur zur Nachvollziehbarkeit
> der Entstehung im Repo — **nicht als Referenz für den aktuellen Stand
> verwenden.**
>
> **Aktuelle Referenz:**
> [CLAUDE.md](CLAUDE.md) (Fachkonzept & Datenmodell) ·
> [README.md](README.md) (Betrieb, `.env`, Deployment) ·
> [docs/API.md](docs/API.md) (REST-API) ·
> `lib/db/schema.ts` (**maßgebliches** Schema)
>
> **Was hier überholt ist:**
>
> | im Plan | tatsächlich |
> |---------|-------------|
> | SQLite via `better-sqlite3`, `DATABASE_PATH` | **PostgreSQL 16** via `pg` + Drizzle, `DATABASE_URL` |
> | Tabelle `antraege` | Tabelle **`cards`** |
> | `/intern/antrag/{id}` · `/antrag/{token}` | **`/intern/card/{id}`** · **`/status/{token}`** |
> | Lokale Passwörter (`argon2`/`bcrypt`), `ADMIN_PASSWORD`, Admin im Seed | Login **ausschließlich SSO/OIDC** (JIT-Provisioning); der Seed legt **keinen** Admin an, der erste Admin entsteht über `ADMIN_USER` |
> | 20-stelliger Status-Token | **30-stellig** |
> | Anhang-`kind`s `finanzantrag`/`anlage_a`/`weitere` … | `finance_request`/`annex_a`/`annex_b`/`student_card`/`other` |
> | 6 fest verdrahtete Default-Spalten | Spalten kommen aus **Board-Templates** (`/vorlagen/boards`); max. **zwei** Archiv-Trigger je Board |
>
> **Was hier komplett fehlt** (nach dem MVP entstanden): Finanzübersichten,
> Board- & Finanz-Vorlagen, **Inventar- & Entleihsystem**, REST-API (`/api/v1`),
> In-App-PDF-Viewer/-Editor mit PAdES-Signatur, Live-Updates via SSE,
> Done-Archiv, Aufgabenübersicht und Board-Statistik.

> Bauplan für die Umsetzung. Fachkonzept & Datenmodell siehe [CLAUDE.md](CLAUDE.md).
> Stack: **Next.js (App Router) + React + TypeScript**, SQLite via `better-sqlite3` + **Drizzle ORM**, Tailwind, `dnd-kit`, `zod`, Auth (Session), Node-`crypto` (AES-256-GCM), `sharp`, `webdav`, Docker hinter nginx.

Die Reihenfolge folgt den technischen Abhängigkeiten: erst Fundament (Setup → Datenmodell → Auth → Autorisierung), dann die Kernflächen (Admin, Boards, Karten), danach die öffentliche Seite, zuletzt Nextcloud, Profilbilder und Deployment.

**MVP-Schnitt:** Phasen 0–7 ergeben eine voll funktionsfähige App (öffentliches Formular → Board, internes Kanban mit Auth/Rollen/Standorten). Phasen 8–9 (Nextcloud, Profilbilder) sind Erweiterungen, Phase 10 ist Auslieferung.

---

## Phase 0 — Projekt-Setup & Gerüst
**Ziel:** Lauffähiges Next.js-Skeleton mit DB-Anbindung und Konfiguration.

- Next.js (App Router, TypeScript) initialisieren; Tailwind CSS; ESLint/Prettier
- `better-sqlite3` + **Drizzle ORM** + `drizzle-kit` (Migrationen) einrichten
- `.env`-Konvention + Validierung (`zod`): `AUTH_SECRET`, `ENCRYPTION_KEY`, `ADMIN_USER`, `ADMIN_PASSWORD`, `DATABASE_PATH`, `UPLOAD_DIR`, `APP_BASE_URL`
- Ordnerstruktur: `app/`, `lib/db/` (Schema, Client), `lib/auth/`, `lib/authz/`, `lib/files/`, `lib/nextcloud/`, `components/`
- Health-Check-Route, Basis-Layout

**Ergebnis:** `npm run dev` startet, DB-Verbindung steht.

---

## Phase 1 — Datenmodell & Migrationen
**Ziel:** Komplettes Schema in Drizzle + Seed. (Abhängig von 0)

- Drizzle-Schema aller Tabellen: `users, groups, user_groups, boards, board_access, board_statuses, board_archive, locations, antraege, attachments, board_card_fields`
- Constraints korrekt abbilden:
  - `board_access`: CHECK „genau eines von user_id/group_id" + UNIQUE(board_id,user_id)/UNIQUE(board_id,group_id), FKs `ON DELETE CASCADE`
  - `board_statuses`: partieller UNIQUE-Index `WHERE is_archive_trigger = 1` (max. 1 Trigger/Board)
  - `antraege.priority` CHECK (`low|middle|high`)
  - `boards.owner_id`: **kein** CASCADE (beim Löschen des Eigentümers umhängen)
  - `locations.target_board_id/target_status_id`: **kein** CASCADE (Löschschutz)
- Erste Migration generieren + anwenden
- **Seed-Script:** Erst-Admin aus `.env`; 4 Beispiel-Standorte (Standort A, Standort B, Standort C, Zentrale — zunächst deaktiviert/ohne Ziel)
- **Default-Status-Vorlage** als wiederverwendbare Funktion definieren (6 Stati inkl. Archiv-Trigger auf „Anweisung erfolgt")

**Ergebnis:** DB-Schema steht, Seed legt Admin + Standorte an.

---

## Phase 2 — Auth & Sessions
**Ziel:** Login/Logout, Session, Passwort-Handling. (Abhängig von 1)

- Passwort-Hashing (`argon2` oder `bcrypt`)
- Session-Mechanismus (Auth.js Credentials **oder** eigene Cookie-Session): `HttpOnly`/`Secure`/`SameSite`, `AUTH_TRUST_HOST`
- Helper: `getCurrentUser()`, `requireLogin()`, `requireAdmin()`
- `/login`-Seite + einfaches Rate-Limit
- Logout
- `/intern/konto`: eigenes Passwort ändern (Benutzername angezeigt, nicht änderbar)

**Ergebnis:** Anmeldung als Seed-Admin funktioniert, geschützte Bereiche sind abgesichert.

---

## Phase 3 — Autorisierung / Board-Zugriffslogik
**Ziel:** Zentrale Rechte-Helper. (Abhängig von 2)

- `userCanAccessBoard(user, boardId)`: admin ∨ owner ∨ board_access(user) ∨ board_access(group ∈ user-groups)
- `userCanManageBoard(user, boardId)`: admin ∨ owner
- Query „Boards, die ein Nutzer sehen darf"
- Wiederverwendbare Guards für Server Actions / Route Handlers / Seiten (Äquivalent zu `@board_access_required` / `@board_owner_required`)

**Ergebnis:** Einheitliche, getestete Zugriffsprüfung als Basis für alle folgenden Flächen.

---

## Phase 4 — Admin Panel
**Ziel:** Verwaltung von Nutzern, Gruppen, Boards, Standorten. (Abhängig von 3)

- `/admin` Layout + Admin-Guard
- `/admin/users`: anlegen (Benutzername fix), Rolle setzen (**Admin ernennen**), aktiv/inaktiv, Passwort-Reset; Schutz: letzten Admin & sich selbst nicht degradieren/entfernen
- `/admin/groups`: CRUD + Mitglieder verwalten (n:m)
- `/admin/boards`: Übersicht ALLER Boards, Eigentum übertragen, löschen (Aufsicht)
- `/admin/standorte`: aktivieren/deaktivieren, Ziel-Board + Ziel-Spalte mappen; Validierung (Spalte gehört zum Board; Aktivierung nur mit gültigem Ziel)

**Ergebnis:** Admin kann alle Stammdaten pflegen.

---

## Phase 5 — Boards & Kanban (intern)
**Ziel:** Startseite, Board-Erstellung, Kanban-Ansicht, Board-Einstellungen. (Abhängig von 3, teils 4)

- `/intern` Startseite: zugängliche Boards als Kacheln + Nav-Buttons (Neues Board, Konto, Admin Panel [nur Admin], Logout)
- `/intern/board/neu`: Board anlegen (owner = aktueller Nutzer), Default-Status-Vorlage anlegen
- `/intern/board/{id}`: Kanban — Spalten = `board_statuses`, Karten = `antraege`; **Drag&Drop** (dnd-kit) zwischen Spalten → Statuswechsel persistieren + `updated_at` setzen; manuelles Anlegen von Karten
- `/intern/board/{id}/einstellungen` (owner/admin):
  - Stati: CRUD, sortieren (`position`), Archiv-Trigger setzen (partieller Unique)
  - Freigaben: Nutzer/Gruppen hinzufügen/entfernen
  - **Kartenfelder-Sichtbarkeit** (`board_card_fields`)
  - Nextcloud-Archiv-Konfig (Platzhalter bis Phase 8)
  - Eigentum übertragen; Board löschen (**Löschschutz**, wenn ein Standort darauf zeigt)

**Ergebnis:** Vollständig nutzbares Kanban, unabhängig vom öffentlichen Formular.

---

## Phase 6 — Karten-Detail, Felder & Anhänge
**Ziel:** Detailansicht mit allen konfigurierbaren Feldern + Datei-Anhängen. (Abhängig von 5)

- `/intern/antrag/{id}`: Detailansicht; nur **sichtbare** Felder anzeigen, alle optional
- **Typeahead** Ersteller/Zugewiesen → Route Handler `app/api/...`: Nutzer mit Board-Zugriff per Präfix
- Felder: Deadline & Sitzung (Datepicker), Priority (select), Notizen (Textarea); immer sichtbar: Titel, Erstellung, Letzte Änderung
- **Anhänge** (`lib/files`): Dokument-Slots (`finanzantrag|anlage_a|anlage_b|studierendenausweis`, je max. 1, ersetzbar) + „Weitere PDFs" (`weitere`, unbegrenzt); Upload/Download/Löschen; Typ-/Größen-Validierung; Speicherung im Upload-Volume
- Jede Änderung aktualisiert `updated_at`

**Ergebnis:** Karten vollständig bearbeitbar inkl. Dateiverwaltung.

---

## Phase 7 — Öffentliches Formular & Statusseite
**Ziel:** Einreichung → Antrag im Ziel-Board, Token, PDF-Bestätigung. (Abhängig von 6)

- `/` Formular: Standort (nur **aktivierte**), Antragsgegenstand, Antragsteller, Finanzantrag (PDF), Studierendenausweis (PDF/PNG/JPG), Anlage A/B (optional); `zod`-Validierung
- Submission (Server Action): Antrag auf `target_board_id`/`target_status_id` des Standorts anlegen, `location_id` setzen, Anhänge als korrekte `kind`s speichern, **20-stelligen Token** generieren
- **PDF-Eingangsbestätigung** (`@react-pdf/renderer`/`pdf-lib`): Antragsgegenstand, Antragsteller, Eingangsdatum/-zeit, Status-Link, Hinweis
- Erfolgsseite: Token-Link + PDF-Download
- `/antrag/{token}`: Statusseite (aktueller Status + letzte Änderung), keine sensiblen Daten, keine E-Mail

**Ergebnis:** End-to-End-Fluss Bürger → Board. **MVP fertig.**

---

## Phase 8 — Nextcloud-Archivierung
**Ziel:** Automatischer Datei-Upload beim Erreichen der Trigger-Spalte. (Abhängig von 5/6)

- `lib/crypto`: AES-256-GCM encrypt/decrypt (Schlüssel aus `.env`)
- Board-Archiv-Konfig speichern (Passwort **verschlüsselt**, Feld write-only/„gesetzt"-Anzeige)
- `lib/nextcloud`: WebDAV-Client (Ordner anlegen, Dateien hochladen)
- Trigger-Logik: Statuswechsel in Archiv-Trigger-Spalte **und** Board-Archiv aktiv → Unterordner anlegen, **alle aktuellen Anhänge** hochladen, internen Nextcloud-Link am Antrag vermerken
- Idempotenz (kein Doppel-Upload), Fehlerbehandlung/Logging
- „Verbindung testen"-Button in den Board-Einstellungen

**Ergebnis:** Einzige Automatik der App ist umgesetzt.

---

## Phase 9 — Profilbilder & Feinschliff
**Ziel:** Avatare + UX-Politur. (Abhängig von 2/5)

- `/intern/konto`: Avatar-Upload/Ersetzen/Entfernen; `sharp` schneidet quadratisch zu/verkleinert
- Initialen-Fallback (deterministische Farbe aus Benutzername)
- Avatar in Navigation, Board-Karten, Antrags-Detail anzeigen
- Fehlerseiten (403/404), Leerzustände, Ladezustände, einheitliche Validierungsmeldungen

**Ergebnis:** Runde, konsistente Oberfläche.

---

## Phase 10 — Deployment (Docker hinter nginx)
**Ziel:** Reproduzierbare Auslieferung. (Abhängig von allen)

- `next.config`: `output: 'standalone'`
- **Dockerfile** (Multi-Stage: Build → schlankes Runtime-Image, `node server.js`)
- **docker-compose**: persistente Volumes für **SQLite-DB** + **Upload-Verzeichnis**, `.env` als `env_file`
- Entrypoint: Drizzle-Migrationen + Seed beim ersten Start
- **nginx-Beispielconfig**: SSL-Termination, `X-Forwarded-Proto/-For` + `Host` durchreichen; Container nur HTTP
- README/Betriebshinweise (Backups der Volumes, Schlüssel-Rotation)

**Ergebnis:** `docker compose up` liefert die App hinter nginx aus.

---

## Querschnittsthemen (durchgängig in jeder Phase)
- **Validierung** mit `zod` an allen Eingängen (Formulare, Route Handlers, Server Actions)
- **Autorisierung** in *jedem* Handler prüfen (nie nur im UI ausblenden)
- **Fehler-/Edge-Cases**: Datei-Typ/-Größe, doppelte Namen, fehlende Ziele, deaktivierte Nutzer
- **Sicherheit**: CSRF (Origin-Check), Rate-Limit Login, Secrets nie ins Repo/Image
- **Tests** (optional, empfohlen für `lib/authz` + Routing-Logik + Archiv-Trigger)

## Empfohlene erste Schritte
1. Phase 0 (Setup) + Phase 1 (Schema/Seed) zusammen — danach steht das Fundament.
2. Phase 2/3 (Auth + Autorisierung) — kritisch, alles Weitere baut darauf.
3. Ab da iterativ Phase 4 → 7 bis zum MVP.
