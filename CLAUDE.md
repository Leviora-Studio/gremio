# Gremio — Projektkontext für Claude Code

## Projektübersicht
Web-App zur Verwaltung von Anträgen in Gremien (z. B. Studierendenvertretungen, Vereinen, Ausschüssen).

Zwei Bereiche:
- **Öffentlich** — Studierende reichen Anträge über ein Formular ein, sehen Statusseite
- **Intern** — das Gremium verwaltet Anträge auf **mehreren Kanban-Boards** (Login erforderlich)

Die Boards sind **allgemeine Kanban-Boards** und auch **unabhängig vom öffentlichen Formular** nutzbar. Das öffentliche Formular ist nur *eine* Quelle: Eingaben werden je nach gewähltem **Standort** automatisch in ein vom Admin festgelegtes Board + Spalte eingespeist (siehe „Standorte & Formular-Routing").

---

## Tech-Stack
- **Framework:** **Next.js (App Router) + React + TypeScript** — Full-Stack (Frontend + Backend in einem Codebase). Server-Logik via Route Handlers / Server Actions, läuft auf Node.js.
- **Datenbank:** **PostgreSQL** über `pg` (node-postgres), Schema/Queries mit **Drizzle ORM** (CHECK-Constraints & partielle Indizes). Läuft als eigener Container (docker-compose).
- **Styling/UI:** Tailwind CSS (o.ä.); Kanban-Drag&Drop mit React-Lib (z.B. `dnd-kit`)
- **Validierung:** `zod` für Formular-/API-Eingaben
- **Auth:** Session-Login (Auth.js/NextAuth Credentials **oder** eigene Cookie-Session), Passwort-Hashing mit `argon2` oder `bcrypt`
- **PDF-Generierung:** `@react-pdf/renderer` oder `pdf-lib` (Eingangsbestätigung)
- **Secrets:** Node-`crypto` (AES-256-GCM) zum Verschlüsseln der board-eigenen Nextcloud-Zugangsdaten (Schlüssel aus `.env`)
- **Bilder:** `sharp` zum Zuschneiden/Verkleinern der Profilbilder
- **Nextcloud:** `webdav`-Client (npm)
- **Deployment:** Docker (Next.js Standalone-Server auf Node, persistente Volumes für DB + Uploads) — siehe „Deployment (Docker)"

---

## Nutzerverwaltung & Berechtigungen

Drei Konzepte: **globale Rolle**, **Board-Eigentümer** und **Board-Freigabe**.

1. **Globale Rolle** (`admin` / `template_manager` / `user`)
   - **Admin:** darf in der App **alles** — alle Boards sehen/verwalten, Gruppen verwalten, Nutzer anlegen/verwalten und **andere Nutzer zu Admin oder Template-Verwalter ernennen** (Admin = vollwertig). Einziger Zugang zum Admin Panel.
   - **Template-Verwalter** (`template_manager`): wie ein normaler User, darf **zusätzlich** Board- **und** Finanz-Templates verwalten (`/vorlagen/...`). Kein Zugang zum Admin Panel.
   - **User:** sieht nur Boards, für die er berechtigt ist; darf **eigene Boards erstellen** und dort Nutzer/Gruppen einladen.

> **Rollenwechsel** macht nur der Admin (geschützt durch Tipp-Wörter: `ADMIN` zum Befördern zum Admin, `TEMPLATE` zum Template-Verwalter, `ENTZIEHEN` zum Herabstufen). Der letzte Admin und man selbst können nicht degradiert werden.
2. **Board-Eigentümer** (`boards.owner_id`) — wer ein Board erstellt, ist Eigentümer und darf es verwalten (umbenennen, Stati konfigurieren, Freigaben verwalten, löschen). Admins dürfen jedes Board verwalten.
3. **Board-Freigabe** (`board_access`) — Eigentümer/Admin geben ein Board frei, **an einen Nutzer oder eine Gruppe** (binär: sehen + Anträge bearbeiten, keine Rechtestufen). Das *Verwalten* des Boards bleibt Eigentümer/Admin vorbehalten.

> **Gruppen erstellen/verwalten darf nur der Admin.** User können vorhandene Gruppen nur zu ihren eigenen Boards einladen, aber keine Gruppen anlegen/ändern.

### Entscheidungen
- **Login-Kennung:** Benutzername (kein E-Mail-Versand, DSGVO-arm)
- **Benutzername unveränderlich:** vom Admin bei der Anlage festgelegt, danach von niemandem änderbar
- **Passwort:** jeder Nutzer ändert sein eigenes Passwort unter `/intern/konto`; Admin kann zusätzlich zurücksetzen
- **Profilbild:** optional je Nutzer (Upload/Ersetzen/Entfernen unter `/intern/konto`). Ohne Bild → generierter Avatar aus den **Initialen des Benutzernamens** (z.B. deterministische Farbe). Bild wird quadratisch zugeschnitten/verkleinert gespeichert.
- **Board-Stati:** pro Board konfigurierbar (siehe Workflow); Archiv-Trigger pro Board wählbar
- **Board-Zugriff:** binär (nur Zugriff, keine Lesen/Bearbeiten/Verwalten-Stufen)
- Ein Nutzer kann in **mehreren Gruppen** sein (n:m)
- **Eigentum übertragbar:** Eigentümer **oder** Admin können ein Board an einen anderen Nutzer übergeben
- **Eigentümer gelöscht/deaktiviert:** Board bleibt bestehen, Eigentum fällt automatisch an einen Admin (kein Datenverlust). → `boards.owner_id` daher **nicht** `ON DELETE CASCADE`, sondern beim Löschen umhängen

### Datenmodell (PostgreSQL)

> Konzeptionelle Spezifikation. Umgesetzt wird das Schema in **Drizzle ORM** (TypeScript, pg-core); die folgende SQL-Notation beschreibt Tabellen, Beziehungen und Constraints. Die Karten-Tabelle heißt `cards`.

```sql
users          (id, username UNIQUE, password_hash,
                role TEXT CHECK(role IN ('admin','template_manager','user')), is_active,
                avatar_path NULL, created_at)            -- avatar_path leer → Initialen-Fallback

groups         (id, name UNIQUE, description, created_at)        -- z.B. "Gremium A"

user_groups    (user_id FK→users, group_id FK→groups,            -- n:m
                PRIMARY KEY(user_id, group_id))

boards         (id, name, description, owner_id FK→users, created_at)  -- Eigentümer = Ersteller

board_access   (id, board_id FK→boards ON DELETE CASCADE,
                user_id  FK→users  NULL ON DELETE CASCADE,
                group_id FK→groups NULL ON DELETE CASCADE,
                CHECK ((user_id IS NULL) != (group_id IS NULL)), -- genau EINES gesetzt
                UNIQUE(board_id, user_id), UNIQUE(board_id, group_id))

board_statuses (id, board_id FK→boards ON DELETE CASCADE, name,
                position INTEGER, is_archive_trigger INTEGER DEFAULT 0, created_at)
-- max. ein Archiv-Trigger je Board:
-- CREATE UNIQUE INDEX ix_one_trigger ON board_statuses(board_id) WHERE is_archive_trigger = 1;

-- Nextcloud-Archiv pro Board (1:1), eigene Verbindung je Board:
board_archive  (board_id PK FK→boards ON DELETE CASCADE,
                enabled INTEGER DEFAULT 0,
                nc_url, nc_username, nc_password_enc,   -- Passwort verschlüsselt (AES-256-GCM)
                target_folder)

-- Antragsnummern pro Board (1:1). Format: {prefix}{zähler}{sep?}{year}{sep?}{code},
-- leere Blöcke werden übersprungen. Zähler `next` erhöht sich automatisch.
board_numbering (board_id PK FK→boards ON DELETE CASCADE,
                 enabled, prefix, year, code, separator DEFAULT '_', padding DEFAULT 0,
                 next INTEGER DEFAULT 1)
-- cards.number = vergebene Antragsnummer (Text, NULL = keine).
--   Vergabe atomar (UPDATE … next=next+1 … RETURNING) beim Formular-Eingang und
--   beim BEHALTEN einer manuellen Karte (Verwerfen verbraucht keine Nummer).
--   Editierbar nur durch Board-Verwalter; Zähler bleibt davon unberührt.
--   Keine Eindeutigkeitsgarantie (Dubletten durch Reset/leere Blöcke bewusst erlaubt).

-- Karte gehört zu genau einem Board und steht in einer Status-Spalte dieses Boards:
-- location_id = Herkunft aus dem öffentlichen Formular (NULL bei manuell angelegten Karten)
cards          (id, board_id FK→boards, status_id FK→board_statuses, location_id FK→locations NULL,
                title, applicant, token UNIQUE,
                created_at, updated_at,            -- updated_at = "Letzte Änderung", auto bei jeder Änderung/Statuswechsel
                creator_user_id  FK→users NULL,   -- "Ersteller"
                assignee_user_id FK→users NULL,   -- "Zugewiesen zu"
                deadline NULL,
                meeting  NULL,                     -- frei wählbares Datum "Sitzung"
                decision_ref NULL,                 -- Freitext "Beschlussreferenz"
                priority TEXT NULL CHECK(priority IN ('low','middle','high')),
                notes NULL,                        -- Freitext "Notizen"
                position INTEGER DEFAULT 0)        -- Reihenfolge in der Spalte (Drag&Drop sortierbar)
-- Dokumente/Anhänge separat in attachments (siehe "Karten — Felder & Anhänge")

-- Kommentare & Aktivität pro Karte (rein intern, NIE öffentlich):
card_comments  (id, card_id FK→cards ON DELETE CASCADE,
                user_id FK→users NULL, body, created_at)
card_activity  (id, card_id FK→cards ON DELETE CASCADE, user_id FK→users NULL,
                type,    -- created|status|assignee|attachment_added|attachment_removed
                detail, created_at)               -- vorgerenderter deutscher Text
```

### Board-Ansicht
- **Filter** (clientseitig): Textsuche (Titel/Antragsteller), Priorität, Zugewiesen, „nur überfällig" (Deadline < heute).
- **Karten sortierbar** per Drag&Drop innerhalb/zwischen Spalten (`cards.position`); Reihenfolge wird persistiert.
- **Kommentare** und **Aktivitäts-/Statushistorie** je Karte — nur in der internen Detailansicht, nicht auf der öffentlichen Statusseite.

### Zugriff & Verwaltung (Logik)
- **Sehen/bearbeiten** (`user_can_access_board`): `role='admin'` **oder** Eigentümer **oder** `board_access` mit eigener `user_id` **oder** mit einer `group_id` aus seinen Gruppen.
- **Verwalten** (`user_can_manage_board` — umbenennen, Stati, Freigaben, löschen): `role='admin'` **oder** Eigentümer.
- Decorators: `@login_required`, `@admin_required`, `@board_access_required`, `@board_owner_required`.

### Bootstrap & Sicherheit
- Erst-Admin via SSO: der in `.env` als `ADMIN_USER` gesetzte SSO-Benutzer wird beim **ersten Login** automatisch Admin (JIT-Provisioning; kein Passwort in dieser App, kein Admin-Seed)
- Secrets aus `.env`: `AUTH_SECRET` (Session/Cookies), `ENCRYPTION_KEY` (AES für Nextcloud-Credentials)
- Schutz: letzten Admin und sich selbst nicht entfernen/degradieren
- Cookie-Flags `HttpOnly`/`Secure`/`SameSite`, CSRF-Schutz (Server Actions prüfen Origin; Route Handlers entsprechend absichern), einfaches Rate-Limit am Login

---

## Nextcloud-Integration

> **WICHTIG — Abgrenzung:** Die App ist eigenständig. Anträge/Karten, Kanban-Board und alle Daten leben **ausschließlich in unserer eigenen App** (PostgreSQL), **nicht** in Nextcloud Deck. Nextcloud hat **nur eine einzige Aufgabe**: Am Ende des Workflows werden die Dateien eines Antrags als **Archiv** nach Nextcloud hochgeladen. Mehr macht die Nextcloud nicht (kein Deck, keine Karten, keine Tickets in Nextcloud).

- **Archivierung ist eine reine Board-Einstellung** (an/aus pro Board, Default: **aus**). **Keine globale Verbindung** — jedes Board bringt seine **eigene Nextcloud** mit: URL + Zugangsdaten + Zielordner.
- **Trigger-Status pro Board** (Status-Spalte mit `is_archive_trigger`). Erreicht ein Antrag diese Spalte **und** ist die Archivierung für das Board aktiv, werden die aktuell am Antrag hängenden Dateien automatisch in einen Unterordner des board-eigenen Zielordners hochgeladen.
- Konfiguriert wird das in den **Board-Einstellungen** (Eigentümer/Admin), nicht im globalen Admin Panel.
- Zugriff über WebDAV / Nextcloud-API; keine weitere Nextcloud-Funktionalität.
- **Sicherheit:** Zugangsdaten **verschlüsselt** in der DB (AES-256-GCM via Node-`crypto`, Schlüssel aus `.env`). Empfehlung: Nextcloud-**App-Passwort** statt Hauptpasswort. Passwortfeld im UI nur schreibend („gesetzt"-Anzeige, ersetzen statt anzeigen).


---

## Workflow

> Stati sind **pro Board konfigurierbar** (anlegen/umbenennen/sortieren/löschen, Archiv-Trigger setzen — in den **Board-Einstellungen** durch Eigentümer/Admin). Beim Erstellen eines Boards werden die Spalten aus einem **Template** kopiert (von Admin **oder** Template-Verwalter unter `/vorlagen/boards` verwaltet, siehe „Board-Templates"). Das per `db:seed` angelegte Default-Template heißt **„Antragsboard"** und hat **7 Spalten**: *Eingegangen · Geplant für Sitzung · Abgelehnt · Warten auf Nachreichung · Angenommen · Quittungen erhalten · Anweisung erfolgt* (letztere = Archiv-Trigger). Der folgende Ablauf beschreibt den fachlichen Gremien-Prozess dahinter (Spaltennamen müssen damit nicht 1:1 übereinstimmen).
>
> **Keine Schritt-Automatismen:** Statuswechsel lösen **keine** automatischen Aktionen aus — es werden insbesondere **keine Anhänge automatisch gelöscht oder hochgeladen**. Alle Schritte unten sind **manuelle** Tätigkeiten des Gremiums. **Einzige automatische Aktion** in der ganzen App: Erreicht ein Antrag die Archiv-Trigger-Spalte eines Boards mit **aktivierter** Nextcloud-Archivierung, werden die Dateien automatisch hochgeladen.

### 1. Eingegangen
- Studierender reicht Formular ein (inkl. Pflichtfeld **Standort**)
- App erstellt internen Antrag (Karte) im **Ziel-Board + Ziel-Spalte des gewählten Standorts** (siehe „Standorte & Formular-Routing") — typischerweise eine „Eingegangen"-Spalte, aber pro Standort konfigurierbar
- Anhänge werden lokal am Antrag gespeichert: Finanzantrag, Studierendenausweis, ggf. Anlage A/B
- Studierender erhält Status-Link + downloadbare PDF-Eingangsbestätigung

### 2. Geprüft → Geplant für Sitzung
- Das Gremium prüft intern, verschiebt die Karte im eigenen Board

### 3. Angenommen / Abgelehnt
- Das Gremium entfernt bei Bedarf alte Anhänge (Originalantrag etc.) **manuell** und lädt den unterschriebenen Antrag als neuen Anhang hoch (kein Automatismus)

### 4. Wartend auf Auflagen
- Warten auf Quittung vom Antragsteller

### 5. Warten auf Antwort
- Quittung wird als Anhang hochgeladen

### 6. Anweisung erfolgt ← **Archivierungs-Trigger (einziger Nextcloud-Kontakt)**
- Das Gremium lädt die Anweisung **manuell** als Anhang hoch
- Diese Spalte ist (in der Default-Vorlage) der **Archiv-Trigger**: Ist die Nextcloud-Archivierung des Boards aktiv, legt die App **automatisch** einen Nextcloud-Ordner an (Verbindung/Zielordner aus den **Board-Einstellungen**), lädt alle aktuellen Anhänge des Antrags hoch und vermerkt den internen Nextcloud-Link am Antrag
- Ein weiterer Nutzer prüft abschließend anhand des Nextcloud-Ordners

---

## Antragsformular — Felder

| Feld | Typ | Pflicht | Format |
|------|-----|---------|--------|
| Standort | Auswahl | ✅ | Einfachauswahl, nur **aktivierte** Standorte: Standort A, Standort B, Standort C, Zentrale |
| Antragsgegenstand | Text | ✅ | Freitext, z.B. "Grillabend am FB5" |
| Antragsteller | Text | ✅ | Freitext, z.B. "Max Mustermann" |
| Finanzantrag | Upload | ✅ | PDF (entspricht dem Karten-Slot „Finanzantrag") |
| Studierendenausweis | Upload | ✅ | PDF, PNG, JPG |
| Anlage A | Upload | ❌ | PDF |
| Anlage B | Upload | ❌ | PDF |

---

## Standorte & Formular-Routing

Das öffentliche Formular enthält ein Pflicht-Auswahlfeld **Standort**. Pro Standort legt der **Admin** fest, in welches **Board** und in welche **Spalte (Status)** ein eingereichter Antrag landet.

- **Vier Standorte** (Startbestand): Standort A, Standort B, Standort C, Zentrale
- Jeder Standort ist **aktivierbar/deaktivierbar** — nur aktivierte erscheinen im öffentlichen Formular
- Ein Standort ist erst auswählbar/aktivierbar, wenn ihm ein **Ziel-Board + Ziel-Spalte** zugewiesen wurde (sonst gäbe es kein Ziel)
- Die Ziel-Spalte muss zum Ziel-Board gehören (App-seitig geprüft)
- **Löschschutz:** Ein Board/eine Spalte kann **nicht gelöscht** werden, solange ein Standort darauf zeigt — der Admin muss das Routing vorher umstellen (daher `locations.target_*` **nicht** `ON DELETE CASCADE`)
- Konfiguration im Admin Panel unter `/admin/standorte`

### Datenmodell (Ergänzung)
```sql
locations  (id, name UNIQUE, enabled INTEGER DEFAULT 1, position,
            target_board_id  FK→boards         NULL,
            target_status_id FK→board_statuses NULL)
-- target_status_id muss zu target_board_id gehören (App-Logik)
-- Startbestand: Standort A, Standort B, Standort C, Zentrale

-- cards bekommt zusätzlich location_id (Herkunft); NULL = manuell auf Board angelegt
```

Bei Einreichung: App erzeugt den Antrag auf `target_board_id` in Spalte `target_status_id` des gewählten Standorts und setzt `antraege.location_id`. Manuell direkt auf einem Board angelegte Karten haben kein `location_id`.

---

## App-Struktur

```
/                        → Antragsformular (öffentlich)
/status/{token}          → Statusseite für Antragsteller (öffentlich, nur per Token): Status ansehen, Dokumente ansehen, PDFs nachreichen
/api/status/{token}/attachment/{id} → Öffentlicher Datei-Abruf per Token (nur finance_request/annex_a/annex_b/other; KEIN Studierendenausweis)
/login                   → Login-Seite (SSO)
/finanzen                → Finanzübersichten: Liste + Anlegen (jeder Nutzer; Freigabe wie Boards)
/finanzen/{id}           → Finanzansicht: 1) Haushaltsplan 2) Live-Ausgaben 3) tatsächliche Ausgaben 4) Antragsübersicht
/finanzen/{id}/einstellungen → Name, betroffene Konten (mehrere möglich; optionaler Teilmengen-Override für die Ausgaben-Berechnung Live/Tatsächlich), Quell-Boards, Freigaben, Haushaltsplan-Editor (Eigentümer/Admin)
/intern                  → Startseite: zugängliche Boards + Navigations-Buttons zu den Bereichen
/intern/konto            → Eigenes Konto: Passwort ändern + Profilbild (Benutzername fest, nicht änderbar)
/intern/board/neu        → Board erstellen (jeder eingeloggte Nutzer)
/intern/board/{id}       → Kanban-Board (Board-Zugriff erforderlich)
/intern/board/{id}/einstellungen → Board verwalten: Stati + Freigaben + Kartenfelder + Nextcloud-Archiv (Eigentümer/Admin)
/intern/card/{id}      → Detailansicht eines Antrags
/vorlagen                → Vorlagen-Bereich (Admin ODER Template-Verwalter): Einstieg zu Board- + Finanz-Templates
/vorlagen/boards         → Board-Templates: Liste + anlegen/umbenennen/löschen/duplizieren
/vorlagen/boards/{id}    → Board-Template bearbeiten: Spalten anlegen/umbenennen/per Drag&Drop sortieren/löschen
/vorlagen/finanzen       → Finanz-Templates: Liste + anlegen/umbenennen/löschen/duplizieren
/vorlagen/finanzen/{id}  → Finanz-Template bearbeiten: Haushaltsplan-Positionen (Auto-Speichern)
/admin                   → Admin Panel (nur für Admins sichtbar)
/admin/users             → Nutzerverwaltung (nur Rollen inkl. Admin/Template-Verwalter ernennen; Konten/Aktivierung/Löschen laufen über das SSO)
/admin/groups            → Gruppenverwaltung (anlegen, Mitglieder) — nur Admin
/admin/boards            → Übersicht/Verwaltung ALLER Boards (Admin-Aufsicht)
/admin/standorte         → Standorte: anlegen/umbenennen/löschen + aktivieren/deaktivieren + Ziel-Board/-Spalte (nur Admin)
/admin/priorities        → Prioritäten: Bezeichnung + Farbe je Stufe anpassen (nur Admin)
/admin/accounts          → Konten: Auswahloptionen für das Kartenfeld „Konto" verwalten (nur Admin)
```

> Pfade = Next.js-App-Router-Routen (z.B. `app/status/[token]`, `app/intern`, `app/admin/...`). Interne APIs (z.B. Nutzer-Typeahead für Ersteller/Zugewiesen, Upload-Endpunkte) als Route Handlers unter `app/api/...` bzw. via Server Actions.

### Navigation (nach Login)
Nach dem Login landet jeder Nutzer auf der **Startseite** (`/intern`): Kacheln/Liste der zugänglichen Boards (Klick → Board öffnen) plus Buttons zu den Bereichen, eingeblendet nach Rolle/Rechten:
- **Neues Board erstellen** — jeder Nutzer
- **Passwort ändern** (`/intern/konto`) — jeder Nutzer; Benutzername wird angezeigt, ist aber fest (nur der Admin legt ihn bei Anlage fest)
- **Vorlagen** (`/vorlagen`) — nur für Admin **und** Template-Verwalter sichtbar
- **Admin Panel** (`/admin`) — nur für Admins sichtbar
- **Logout**

**Board-Einstellungen** erreicht man **am jeweiligen Board** (Button in der Board-Ansicht, nur für Eigentümer/Admin sichtbar) → `/intern/board/{id}/einstellungen`, **nicht** über die Startseite.

### Status-Token
- Wird bei Einreichung zufällig generiert (30-stellig, ~175 bit)
- Wird nicht per Mail verschickt — wird am Ende der Einreichung angezeigt
- Antragsteller sieht: aktuellen Status + Datum der letzten Änderung
- **Dokumente ansehen:** Finanzantrag, Anlage A/B und „weitere Dateien" sind über den Token herunterladbar (so sieht man z.B. später die unterschriebene Version). Der **Studierendenausweis bleibt intern** (nicht öffentlich).
- **Nachreichen (append-only):** Antragsteller kann über den Link **PDFs zu „weitere Dateien" hinzufügen** (z.B. Quittungen). Öffentlich kann **nichts bearbeitet/gelöscht/überschrieben** werden — einmal vorhandene Dateien bleiben erhalten. Max. Anzahl begrenzt (Missbrauchsschutz).

### Eingangsbestätigung (PDF, downloadbar)
Enthält:
- Antragsgegenstand
- Antragsteller
- Eingangsdatum + Uhrzeit
- Status-Link (`https://deine-app.de/status/{token}`)
- Hinweis: "Bitte speichere diesen Link"

---

## Karten — Felder & Anhänge

Eine Karte (= Antrag) hat die folgenden Felder. **Welche Felder auf den Karten eines Boards sichtbar sind, ist pro Board einstellbar** (Board-Eigentümer + Admin).

| Feld | Typ | Quelle / Verhalten |
|------|-----|--------------------|
| Ersteller | Nutzer-Auswahl | Typeahead (tippen → Vorschläge) über Nutzer **mit Zugriff auf das Board** |
| Zugewiesen zu | Nutzer-Auswahl | Typeahead über Nutzer mit Board-Zugriff |
| Erstellungszeitpunkt | Datum/Zeit | **automatisch** bei Erstellung gesetzt (nicht editierbar) |
| Letzte Änderung | Datum/Zeit | **automatisch** aktualisiert bei jeder Änderung an der Karte **oder** Statuswechsel (nicht editierbar) |
| Deadline | Datum | Kalender-Auswahl |
| Sitzung | Datum | frei wählbares Datum (Kalender-Auswahl), z.B. Termin der Gremiensitzung |
| Beschlussreferenz | Text | optionales Freitextfeld (Spalte `decision_ref`), pro Board ab-/anschaltbar; z.B. „Beschluss 12/2026". In der Finanz-Anträge-Liste statt „Sitzung" angezeigt |
| Priority | Auswahl | drei feste Stufen low / middle / high; **Bezeichnung + Farbe je Stufe im Admin-Panel anpassbar** (`/admin/priorities`, Tabelle `priorities`) |
| Antragsnummer | Text (auto) | board-spezifische, automatisch vergebene Nummer (Spalte `number`); Konfiguration in den Board-Einstellungen (`board_numbering`). Anzeige-Toggle ist „nur optisch"; nur Board-Verwalter editierbar |
| Haushaltstitel | Text | optionales Freitextfeld (Spalte `budget_title`), pro Board ab-/anschaltbar; Verknüpfungs-Schlüssel zur Finanzübersicht |
| Genehmigter Betrag | Euro | `approved_amount` (Cent); Eingabe in Euro, Anzeige „… €" |
| Tatsächliche Ausgaben | Euro | `actual_amount` (Cent); überschreibt in den Ausgaben-Views den genehmigten Betrag, sobald gesetzt |
| Anweisungsdatum | Datum | `instruction_date`; auto-gesetzt beim Erreichen der pro Board wählbaren Trigger-Spalte (analog Archiv-Trigger), zusätzlich editierbar |
| Überweisungsdatum | Datum | `transfer_date`; auto-gesetzt beim Erreichen der pro Board wählbaren Trigger-Spalte (analog Anweisungsdatum, eigener Trigger), zusätzlich editierbar; verwalter-exklusiv |
| Konto | Auswahl | optionales Auswahlfeld; **Optionen frei vom Admin verwaltbar** (`/admin/accounts`, Tabelle `accounts`); `cards.account_id` FK→accounts (ON DELETE SET NULL) |
| Finanzantrag | PDF | Dokument-Slot (= der per Formular hochgeladene Finanzantrag) |
| Anlage A | PDF | Dokument-Slot |
| Anlage B | PDF | Dokument-Slot |
| Studierendenausweis | PDF/PNG/JPG | Dokument-Slot |
| Weitere PDFs | PDF (mehrere) | **beliebig viele** zusätzliche PDF-Anhänge — **nur intern** (nicht im öffentlichen Formular) |
| Notizen | Freitext | mehrzeiliger Textbereich |

- **Nutzer-Auswahl (Ersteller / Zugewiesen zu):** Tippen liefert Vorschläge aus den Nutzern, die Zugriff auf das jeweilige Board haben (Eigentümer + direkte Freigaben + Gruppen + Admins). Dafür ein gefilterter Such-Endpoint.
- **Anhänge — einheitliches Modell:** Die benannten Slots sind Anhänge mit festem `kind` (je max. 1, ersetzbar), „Weitere PDFs" sind `kind='other'` und **unbegrenzt**.
- **Titel**, **Erstellungszeitpunkt** und **Letzte Änderung** sind immer sichtbar (nicht abschaltbar).
- **Aktivierte Felder sind optional:** Aktiviert ein Board ein Feld, erscheint es auf allen Karten des Boards, **darf aber leer bleiben** (keine Pflichteingabe). Ausnahme bleiben die automatisch gesetzten Werte (Titel, Erstellungszeitpunkt, Letzte Änderung).

### Datenmodell (Ergänzung)
```sql
attachments       (id, card_id FK→cards ON DELETE CASCADE,
                   kind TEXT,   -- finance_request|annex_a|annex_b|student_card|other
                   filename, path, mime, size, uploaded_at, uploaded_by FK→users NULL)
-- benannte Slots: max. 1 je (card_id, kind); 'other': beliebig viele

board_card_fields (board_id FK→boards ON DELETE CASCADE, field_key TEXT,
                   visible INTEGER DEFAULT 1, PRIMARY KEY(board_id, field_key))
-- field_key: number|applicant|budget_title|approved_amount|actual_amount|creator|assignee|
--            deadline|meeting|decision_ref|instruction_date|transfer_date|priority|account|
--            finance_request|annex_a|annex_b|student_card|other_pdfs|notes
-- "title" (Spalte title) ist IMMER sichtbar und NICHT abschaltbar.
```

---

## Board-Templates

Beim Erstellen eines Boards wählt man ein **Template** (Spalten-Vorlage). Die Spalten des Templates werden in das neue Board **kopiert** — danach ist das Board unabhängig (Template-Änderungen wirken nicht rückwirkend). Es gibt **keine** fest verdrahteten Default-Spalten mehr; das per `db:seed` angelegte Template **„Antragsboard"** (7 Spalten) ist nur der Startbestand.

- **Verwaltung durch Admin oder Template-Verwalter** unter `/vorlagen/boards` (anlegen, umbenennen, löschen, **duplizieren** → Kopie heißt „{Name} - copy"; Spalten anlegen/umbenennen/**per Drag&Drop sortieren**/löschen). Lösch-Bestätigungen laufen als **In-App-Modal** (kein Browser-Dialog).
- **Kein Archiv-Trigger im Template-Editor:** Die Nextcloud-/Archiv-Trigger-Spalte wird **nicht** mehr im Template gewählt, sondern erst **pro Board** in den Board-Einstellungen gesetzt. Das Schemafeld `is_archive_trigger` (s. u.) existiert weiter und wird beim Duplizieren mitkopiert, ist im Template-UI aber nicht mehr wählbar.
- Board löschen/Template löschen sind unabhängig (Boards kopieren die Spalten, kein FK auf Templates).

> **Finanz-Templates** (`/vorlagen/finanzen`) funktionieren analog: Haushaltsplan-Vorlagen mit Ober-/Unterpunkten, **anlegen/umbenennen/löschen/duplizieren**; der Haushaltsplan-Editor **speichert automatisch** (kein Speichern-Button), Summen-Warnungen bleiben serverseitig live.

```sql
board_templates        (id, name UNIQUE, description, created_at)

board_template_statuses(id, template_id FK→board_templates ON DELETE CASCADE, name,
                        position INTEGER, is_archive_trigger INTEGER DEFAULT 0)
-- max. ein Archiv-Trigger je Template (partieller UNIQUE-Index)
```

---

## Card-Titel Format
```
{Titel}
Beispiel: "Grillabend am FB5"
```
- **Titel** (Spalte `title`) ist der Kartentitel — immer sichtbar, **nicht abschaltbar** (jede Karte braucht einen Titel).
- **Antragsteller** ist ein **eigenes, optionales Feld** (Spalte `applicant`, field_key `applicant`), das pro Board ein-/ausgeschaltet werden kann. Vom öffentlichen Formular wird es befüllt; manuell angelegte Karten können es leer lassen.
- **Neue Karte (intern):** Button öffnet ein **Popup** mit allen sichtbaren Feldern. Karte wird sofort angelegt; **Erstellen und Bearbeiten speichern automatisch** (kein Speicher-Button). „Verwerfen" löscht die Karte wieder.

---

## Deployment (Docker)

Bereitstellung am Ende **containerisiert** via `Dockerfile` + `docker-compose.yml`.

- **Zwei Services** (docker-compose): `db` (**PostgreSQL 16**) und `app` (Next.js).
- **App-Server:** Next.js im **Standalone-Output** (`output: 'standalone'`), im Container mit `node server.js` gestartet — kein separater WSGI-/App-Server nötig, Node bringt den Server mit. Multi-Stage-Build (Build → schlankes Runtime-Image).
- **Persistente Volumes** (zwingend, sonst Datenverlust beim Rebuild) — liegen **außerhalb** des Images:
  - Postgres-Datenverzeichnis (`pgdata`)
  - Upload-Verzeichnis (Anhänge + Profilbilder)
- **Konfiguration über Umgebungsvariablen / `.env`** (nicht ins Image gebaut): `DATABASE_URL` (Postgres), `AUTH_SECRET` (Session), `ENCRYPTION_KEY` (AES für Nextcloud-Credentials), `OIDC_ISSUER`/`OIDC_INTERNAL_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` (SSO), `ADMIN_USER`, `POSTGRES_PASSWORD`.
- **Reverse-Proxy (nginx):** Der Container liefert **nur HTTP** aus; **SSL/TLS terminiert nginx** davor. Kein HTTPS im Container.
  - nginx muss `X-Forwarded-Proto`, `X-Forwarded-For` und `Host` durchreichen, damit die App das echte Schema/den Host erkennt (für `Secure`-Cookies, Redirects, Auth-Callback-URLs).
  - In Next.js den Proxy als vertrauenswürdig behandeln (`AUTH_TRUST_HOST=true` bzw. Auth.js `trustHost`).
- **DB beim ersten Start:** nur Drizzle-Migrationen (Tabellen anlegen) — **kein** Auto-Seed. Startwerte optional und manuell via `npm run db:seed` (4 Standorte, Prioritäten, Board-Template „Antragsboard") bzw. `npm run db:setup` (= migrate + seed). Kein Admin im Seed — Admin kommt via SSO (`ADMIN_USER`).

---

## Sicherheits-/Design-Entscheidungen (bewusst, kein Bug)

Aus einem externen Security-Review bewusst so belassene Punkte — damit klar ist, dass sie geprüft und gewollt sind:

- **Finanz-Sichtbarkeit am Eigentümer:** Welche Quell-Boards in eine Finanzübersicht einfließen, entscheidet der **Finanzboard-Eigentümer** (Spec „Freigabe wie Boards"). Wer eine Übersicht freigegeben bekommt, sieht damit Karten-Finanzdaten auch von Boards ohne eigenen Zugriff — bewusste Informations-Freigabe.
- **Archivierte Karten zählen in der Finanzauswertung mit** (Done-Archiv blendet nur die Board-/Aufgaben-Ansicht aus). Für „tatsächliche Ausgaben" sollen abgeschlossene Anträge mitzählen.
- **„Weitere PDFs" (`other`) sind über den Status-Token öffentlich** herunterladbar (Spec) — dort **keine** vertraulichen internen Dokumente ablegen. Der **Studierendenausweis** bleibt intern.
- **Binäres Board-Zugriffsmodell:** Jedes Board-Mitglied darf Karten/Anhänge bearbeiten **und löschen** (kein separates Lese-/Lösch-Recht). Verwalter-exklusiv bleiben nur Antragsnummer, Anweisungsdatum, Überweisungsdatum und Archiv-Status (UI **und** REST-API).
- **REST-API ⊆ Web-App (nie mehr Rechte):** Board-Zugriff via `canAccessBoard`, Token-`scope` (read/write) und Board-Beschränkung schränken nur **ein**. Deaktivierte Board-Felder (`board_card_fields`) werden über die API **weder gelesen noch geschrieben** — exakt wie die Web-Oberfläche sie ausblendet.
- **Öffentliches Nachreichen ist append-only**, ohne Spalten-Gate/Frist (bis 30 PDFs je Karte) — gewollt; gegen Missbrauch zusätzlich ratenbegrenzt.
- **Proxy-Header werden vertraut:** Hinter **genau einem** vertrauenswürdigen nginx werden `X-Forwarded-*`/`X-Real-IP` direkt genutzt (Schema/Host/Client-IP). `AUTH_TRUST_HOST` ist bei der eigenen iron-session-Auth ein No-op.
- **SSO-Vertrauensannahme (JIT):** `preferred_username` muss vom SSO autoritativ/unveränderlich vergeben werden (das muss der eingesetzte OIDC-Provider garantieren); darauf basieren Konto-Adoption und die `ADMIN_USER`-Beförderung.
- **Rate-Limiting ist in-memory** (ein Container = eine Instanz). Bei horizontaler Skalierung → geteilter Speicher (Redis) nötig.
- **DB-Verbindung ohne TLS** ist im privaten Docker-Netz ok; bei **externem** Postgres `ssl` aktivieren.
- **CSP** setzt nur `frame-ancestors 'none'` (+ `X-Frame-Options`, `nosniff`); **HSTS** terminiert nginx. Eine strikte `script-src`-CSP (Nonces) ist bewusst zurückgestellt.
- **Upload-Validierung** prüft MIME/Endung (keine Magic-Bytes); ausgeliefert wird mit erzwungenem Content-Type + `nosniff` → kein Stored-XSS, Restrisiko nur „Müll-PDFs".
- **Dependencies:** verbleibende `npm audit`-Funde (postcss, esbuild) sind **build-/dev-only** über Next.js bzw. drizzle-kit — kein Laufzeitrisiko.

---

## Hinweise
- Credentials nicht in den Code committen → `.env`-Datei verwenden
- Board-eigene Nextcloud-Zugangsdaten werden **verschlüsselt** in der DB gespeichert (AES-256-GCM, Schlüssel aus `.env`), nie im Klartext
- DSGVO: Token nur lokal anzeigen
- Antragsteller-E-Mail wird nicht erfasst
