# Gremio — Projektkontext für Claude Code

## Projektübersicht
Web-App zur Verwaltung von Anträgen in Gremien (z. B. Studierendenvertretungen, Vereinen, Ausschüssen).

Zwei Bereiche:
- **Öffentlich** — Studierende reichen Anträge über ein Formular ein, sehen Statusseite; außerdem öffentliches **Feedback** (siehe „Umfragen & Feedback") und öffentliches **Inventar** mit Ausleih-Anfrage (siehe „Inventar- & Entleihsystem")
- **Intern** — das Gremium verwaltet Anträge auf **mehreren Kanban-Boards** (Login erforderlich)

Die Boards sind **allgemeine Kanban-Boards** und auch **unabhängig vom öffentlichen Formular** nutzbar. Das öffentliche Formular ist nur *eine* Quelle: Eingaben werden je nach gewähltem **Standort** automatisch in ein vom Admin festgelegtes Board + Spalte eingespeist (siehe „Standorte & Formular-Routing").

**Fünf Module** teilen sich Nutzer, Gruppen und das Freigabemodell:
1. **Kanban/Anträge** — Boards, Karten, Anhänge (Kern)
2. **Finanzen** (`/finanzen`) — Haushaltsplan + Ausgabenauswertung über Quell-Boards
3. **Inventar & Ausleihe** (`/intern/inventar`) — Gegenstände, Leihvorgänge, Anlagenverzeichnis
4. **Protokolle** (`/intern/protokolle`) — Sitzungen und Markdown-Protokolle mit Nextcloud als alleiniger Dateiablage
5. **Vorlagen** (`/vorlagen`) — Board-, Finanz- und Protokollvorlagen

---

## Tech-Stack
- **Framework:** **Next.js (App Router) + React + TypeScript** — Full-Stack (Frontend + Backend in einem Codebase). Server-Logik via Route Handlers / Server Actions, läuft auf Node.js.
- **Datenbank:** **PostgreSQL** über `pg` (node-postgres), Schema/Queries mit **Drizzle ORM** (CHECK-Constraints & partielle Indizes). Läuft als eigener Container (docker-compose).
- **Styling/UI:** Tailwind CSS (o.ä.); Kanban-Drag&Drop mit React-Lib (z.B. `dnd-kit`)
- **Validierung:** `zod` für Formular-/API-Eingaben
- **Auth:** **ausschließlich SSO/OIDC** — eigener OIDC-Client (`jose`, PKCE, `state`/`nonce`, `iss`/`aud`/`exp`-Prüfung) in `lib/oidc.ts`, Session als verschlüsseltes Cookie via `iron-session`. **Kein lokales Passwort** in dieser App (`users.password_hash` ist eine Altlast und wird nirgends gelesen).
- **PDF-Generierung:** `pdf-lib` (Eingangsbestätigung, PDF-Bearbeitung)
- **Live-Updates:** Postgres-Trigger auf `cards` → `pg_notify`; eine dedizierte LISTEN-Verbindung verteilt die Events über einen In-Process-EventEmitter an **SSE**-Streams (`lib/realtime.ts`, `lib/sse.ts`) — kein Polling.
- **Secrets:** Node-`crypto` (AES-256-GCM) zum Verschlüsseln der board-eigenen Nextcloud-Zugangsdaten (Schlüssel aus `.env`)
- **Bilder:** `sharp` zum Zuschneiden/Verkleinern der Profilbilder
- **Nextcloud:** `webdav`-Client (npm)
- **PDF-Viewer/Editor:** `react-pdf` (pdf.js) rendert Anhänge **in-app** (Modal) statt im Browser-Tab; Bearbeitung (Freitext, Formularfelder) + Signatur werden serverseitig mit `pdf-lib` ins PDF geschrieben.
- **PDF-Signatur (PAdES):** kryptografische, prüfbare Signatur über `@signpdf/signpdf` + `@signpdf/signer-p12` + `@signpdf/placeholder-pdf-lib` (CMS/PKCS#7 detached). `.p12`-Parsing mit `node-forge`. Läuft ausschließlich serverseitig (Privatschlüssel verlässt den Server nicht).
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
- **Login ausschließlich über SSO/OIDC.** Konten entstehen per **JIT-Provisioning** beim ersten Login; die App legt selbst keine Konten an und kennt keine Passwörter.
- **Login-Kennung:** `preferred_username` aus dem SSO (kein E-Mail-Versand an Antragsteller, DSGVO-arm). Verknüpfung zum SSO-Konto über `users.sub` (OIDC-Subject).
- **Benutzername unveränderlich:** kommt vom SSO, in dieser App von niemandem änderbar
- **Passwort/Anzeigename/E-Mail:** werden **zentral im SSO** gepflegt, nicht in Gremio. `/intern/konto` zeigt sie nur an und bietet „Profil neu abgleichen" (`resyncProfileAction`). Es gibt **keine** Passwort-Ändern- oder Passwort-Reset-Funktion.
- **Konten deaktivieren/löschen** passiert ebenfalls im SSO; `/admin/users` vergibt nur **Rollen**.
- **Profilbild:** optional je Nutzer (Upload/Ersetzen/Entfernen unter `/intern/konto`). Ohne Bild → generierter Avatar aus den **Initialen des Benutzernamens** (z.B. deterministische Farbe). Bild wird quadratisch zugeschnitten/verkleinert gespeichert.
- **Board-Stati:** pro Board konfigurierbar (siehe Workflow); Archiv-Trigger pro Board wählbar
- **Board-Zugriff:** binär (nur Zugriff, keine Lesen/Bearbeiten/Verwalten-Stufen)
- Ein Nutzer kann in **mehreren Gruppen** sein (n:m)
- **Eigentum übertragbar:** Eigentümer **oder** Admin können ein Board an einen anderen Nutzer übergeben
- **Eigentümer gelöscht/deaktiviert:** Board bleibt bestehen, Eigentum fällt automatisch an einen Admin (kein Datenverlust). → `boards.owner_id` daher **nicht** `ON DELETE CASCADE`, sondern beim Löschen umhängen

### Datenmodell (PostgreSQL)

> Konzeptionelle Spezifikation. Umgesetzt wird das Schema in **Drizzle ORM** (TypeScript, pg-core); die folgende SQL-Notation beschreibt Tabellen, Beziehungen und Constraints. Die Karten-Tabelle heißt `cards`.

```sql
users          (id, username UNIQUE,                     -- preferred_username aus dem SSO
                sub UNIQUE NULL, name NULL, email NULL,  -- OIDC-Subject + Profil aus dem SSO
                password_hash NULL,                      -- ALTLAST: seit der SSO-Umstellung nie gelesen
                role TEXT CHECK(role IN ('admin','template_manager','user')), is_active,
                avatar_path NULL, signature_path NULL, created_at)  -- avatar_path leer → Initialen-Fallback
-- Signatur-Zertifikat (verschlüsselt): cert_p12_enc, cert_pass_enc, cert_subject,
-- cert_not_after, cert_uploaded_at — siehe „PDF-Viewer, -Editor & digitale Signatur"

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
-- Archiv-Trigger: beliebig viele Spalten je Board möglich. Erreicht ein Antrag
-- EINE der Trigger-Spalten und ist
-- die Nextcloud-Archivierung aktiv, wird archiviert.

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
--   Bei aktiviertem Feld durch jedes Board-Mitglied editierbar; Zähler bleibt davon unberührt.
--   Keine Eindeutigkeitsgarantie (Dubletten durch Reset/leere Blöcke bewusst erlaubt).

board_instruction_forms (board_id PK FK→boards ON DELETE CASCADE,
                         enabled DEFAULT false,
                         filename, path, size, uploaded_at, uploaded_by NULL)
-- Board-Eigentümer/Admin hinterlegen genau eine PDF-Vorlage. Aktivierung ist
-- nur mit Vorlage möglich. Board-Mitglieder erstellen daraus im Karten-PDF-
-- Editor neue Anhänge: Anweisung 1.pdf, Anweisung 2.pdf, ... . Die nächste
-- Nummer folgt auch auf passend benannte, manuell hochgeladene PDFs.

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
                requested_amount NULL,             -- beantragter Betrag in Cent
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
- **Sehen/bearbeiten** (`canAccessBoard`): `role='admin'` **oder** Eigentümer **oder** `board_access` mit eigener `user_id` **oder** mit einer `group_id` aus seinen Gruppen.
- **Verwalten** (`canManageBoard` — umbenennen, Stati, Freigaben, löschen): `role='admin'` **oder** Eigentümer.
- **Guards** (Server-Funktionen, werfen `notFound()`/`redirect()` — in *jedem* Handler aufrufen, nie nur im UI ausblenden):
  - `requireUser` / `requireAdmin` / `requireTemplateManager` (`lib/auth`)
  - `requireBoardAccess` / `requireBoardManage` (`lib/authz`)
  - `requireFinanceAccess` / `requireFinanceManage` (`lib/finance`)
  - `requireInventoryBoardAccess` / `requireInventoryBoardManage` (`lib/inventory`)
- Alle drei Board-Arten (Kanban, Finanzen, Inventar) benutzen **dasselbe Muster**: `canAccess*` (admin ∨ Eigentümer ∨ Freigabe) und `canManage*` (admin ∨ Eigentümer).

### Bootstrap & Sicherheit
- Erst-Admin via SSO: der in `.env` als `ADMIN_USER` gesetzte SSO-Benutzer wird beim **ersten Login** automatisch Admin (JIT-Provisioning; kein Passwort in dieser App, kein Admin-Seed)
- Secrets aus `.env`: `AUTH_SECRET` (Session/Cookies), `ENCRYPTION_KEY` (AES für Nextcloud-Credentials)
- Schutz: letzten Admin und sich selbst nicht entfernen/degradieren
- Cookie-Flags `HttpOnly`/`Secure`/`SameSite`, CSRF-Schutz (Server Actions prüfen Origin; Route Handlers entsprechend absichern), einfaches Rate-Limit am Login

---

## Nextcloud-Integration

> **WICHTIG — Abgrenzung:** Die App ist eigenständig. Anträge/Karten und Kanban-Boards leben **ausschließlich in PostgreSQL**, nicht in Nextcloud Deck. Nextcloud erfüllt zwei klar getrennte Aufgaben: die bestehende, abschließende Antragsarchivierung und den eigenständigen Bereich **Protokolle**, in dem Nextcloud die alleinige Quelle der Markdown-Dateien und Sitzungsordner ist. Gremio speichert dort nur technische Metadaten und Relationen.

- **Archivierung ist eine reine Board-Einstellung** (an/aus pro Board, Default: **aus**). **Keine globale Verbindung** — jedes Board bringt seine **eigene Nextcloud** mit: URL + Zugangsdaten + Zielordner.
- **Trigger-Status pro Board** (Status-Spalte mit `is_archive_trigger`). Erreicht ein Antrag diese Spalte **und** ist die Archivierung für das Board aktiv, werden die aktuell am Antrag hängenden Dateien automatisch in einen Unterordner des board-eigenen Zielordners hochgeladen.
- Konfiguriert wird das in den **Board-Einstellungen** (Eigentümer/Admin), nicht im globalen Admin Panel.
- Zugriff über WebDAV / Nextcloud-API; keine weitere Nextcloud-Funktionalität.
- **Sicherheit:** Zugangsdaten **verschlüsselt** in der DB (AES-256-GCM via Node-`crypto`, Schlüssel aus `.env`). Empfehlung: Nextcloud-**App-Passwort** statt Hauptpasswort. Passwortfeld im UI nur schreibend („gesetzt"-Anzeige, ersetzen statt anzeigen).


---

## Workflow

> Stati sind **pro Board konfigurierbar** (anlegen/umbenennen/sortieren/löschen, Archiv-Trigger setzen — in den **Board-Einstellungen** durch Eigentümer/Admin). Beim Erstellen eines Boards werden die Spalten aus einem **Template** kopiert (von Admin **oder** Template-Verwalter unter `/vorlagen/boards` verwaltet, siehe „Board-Templates"). Das per `db:seed` angelegte Default-Template heißt **„Antragsboard"** und hat **7 Spalten**: *Eingegangen · Geplant für Sitzung · Abgelehnt · Warten auf Nachreichung · Angenommen · Quittungen erhalten · Anweisung erfolgt* (letztere = Archiv-Trigger). Der folgende Ablauf beschreibt den fachlichen Gremien-Prozess dahinter (Spaltennamen müssen damit nicht 1:1 übereinstimmen).
>
> **Grundsatz — keine Schritt-Automatismen:** Der fachliche Ablauf unten besteht aus **manuellen** Tätigkeiten des Gremiums. Insbesondere werden **nie Anhänge automatisch gelöscht**, und Statuswechsel ziehen keine inhaltliche Bearbeitung nach sich.
>
> Die **vollständige Liste** der Automatismen — alle an eine pro Board konfigurierte Spalte oder Uhrzeit gebunden, alle standardmäßig **aus**:
> 1. **Nextcloud-Archivierung** — Archiv-Trigger-Spalte erreicht **und** Archivierung am Board aktiv → Dateien werden hochgeladen (bei Fehlschlag automatischer Retry).
> 2. **Anweisungsdatum** (`instruction_date`) — wird beim Erreichen der Anweisungs-Trigger-Spalte gesetzt.
> 3. **Überweisungsdatum** (`transfer_date`) — analog, eigener Trigger.
> 4. **Done-Sweep** — Karten in der „Done"-Spalte werden täglich zur eingestellten Uhrzeit archiviert (nur ausgeblendet, nichts gelöscht).
> 5. **Quittungs-Gate** — erst beim abschließenden öffentlichen Einreichen wandert die Karte aus einer aktuell ausgewählten Quellspalte in die gemeinsame Zielspalte. Beliebig viele Quellen, keine historische Freigabe.
> 6. **Antragsnummer** — wird bei aktiver Board-Nummerierung automatisch vergeben.
> 7. **Leihvorgang-Sync** (Inventar) — die Spalte der Leihkarte setzt den Vorgangsstatus (siehe „Inventar- & Entleihsystem").

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
- Das Gremium lädt die Anweisung manuell als Anhang hoch oder erstellt sie aus
  der optionalen Board-Vorlage über **Neue Anweisung erstellen**. Das ausgefüllte
  PDF wird als fortlaufend nummerierter normaler Kartenanhang gespeichert.
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
- Die Ziel-Spalte muss zum Ziel-Board gehören (App-seitig geprüft). Öffentliches Formular, `GET /api/public/v1/locations` und die Einreichungslogik benutzen dafür **dieselbe** Abfrage (`listPublicLocations`) — ein Standort mit unvollständigem/falschem Routing erscheint nirgends zur Auswahl, statt erst beim Absenden abgewiesen zu werden
- **Leih-System-Boards sind kein zulässiges Ziel** (`boards.inventory_board_id`): Sie tragen nur die Tracking-Karten der Leihvorgänge, und die öffentlichen Antrags-/Feedback-Routen weisen Karten von dort mit 404 ab — der Status-Link führte also ins Leere. Die Admin-Auswahl bietet sie nicht an, `setLocationTargetAction` lehnt sie ab, und Auswahlliste wie Einreichungslogik filtern sie zusätzlich heraus (gilt für Feedback-Bereiche genauso)
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
/status/{token}/pdf      → Eingangsbestätigung als PDF (öffentlich, nur per Token)
/feedback                → Öffentliches Feedback-Formular (Bereichsauswahl, Name, Freitext)
/feedback/status/{token} → Statusseite eines Feedbacks (öffentlich, nur per Token)
/feedback/status/{token}/pdf → Feedback-Eingangsbestätigung als PDF
/inventar                → Öffentliche Inventare (nur vom Admin freigegebene) — Einstieg
/inventar/{id}           → Öffentliche Inventarliste: suchen/filtern + Ausleihe anfragen
/inventar/status/{token} → Statusseite eines Leihvorgangs (öffentlich, nur per Token)
/api/status/{token}/attachment/{id} → Öffentlicher Datei-Abruf per Token (nur finance_request/annex_a/annex_b/other; KEIN Studierendenausweis)
/api/attachment/{id}/fields → Ausfüllbare AcroForm-Felder eines PDF-Anhangs (für den In-App-Editor; Board-Zugriff)
/api/v1/...              → REST-API mit persönlichen Bearer-Tokens — siehe docs/API.md
/login                   → Login-Seite (SSO)
/finanzen                → Finanzübersichten: Liste + Anlegen (jeder Nutzer; Freigabe wie Boards)
/finanzen/{id}           → Finanzansicht: 1) Haushaltsplan 2) Live-Ausgaben 3) tatsächliche Ausgaben 4) Antragsübersicht
/finanzen/{id}/einstellungen → Name, betroffene Konten (mehrere möglich; optionaler Teilmengen-Override für die Ausgaben-Berechnung Live/Tatsächlich), Quell-Boards, Freigaben, Haushaltsplan-Editor (Eigentümer/Admin)
/finanzen/{id}/export    → XLSX/CSV-Export der Finanzübersicht
/intern                  → Startseite: Dashboard + Navigations-Buttons zu den Bereichen
/intern/boards           → Alle zugänglichen Kanban-Boards (persönlich sortierbar)
/intern/aufgaben         → „Meine Aufgaben": board-übergreifend die eigenen/zugewiesenen Karten
/intern/konto            → Eigenes Konto: Profilbild, Signatur-Zertifikat + Unterschriftsbild, API-Tokens, „Profil neu abgleichen". Benutzername/Anzeigename/Passwort kommen aus dem SSO
/intern/board/neu        → Board erstellen (jeder eingeloggte Nutzer)
/intern/board/{id}       → Kanban-Board (Board-Zugriff erforderlich)
/intern/board/{id}/archiv → Erledigte (weggeräumte) Karten des Boards + wiederherstellen
/intern/board/{id}/statistik → Auswertung des Boards (Kennzahlen, Verteilungen)
/intern/board/{id}/einstellungen → Board verwalten: Stati + Freigaben + Kartenfelder + Nextcloud-Archiv (Eigentümer/Admin)
/intern/card/{id}      → Detailansicht eines Antrags
/intern/inventar         → Zugängliche Inventar-Boards (persönlich sortierbar)
/intern/inventar/neu     → Inventar-Board erstellen (jeder eingeloggte Nutzer)
/intern/inventar/gesamt  → Gesamtinventar (Anlagenverzeichnis) — Nur-Ansicht für alle eingeloggten Nutzer
/intern/inventar/{id}    → Inventarliste: Gegenstände + laufende Leihvorgänge (Board-Zugriff)
/intern/inventar/{id}/archiv → Defekte/verlorene Gegenstände
/intern/inventar/{id}/einstellungen → Felder, Inventarnummern, Optionen, Freigaben, Leihboard, Eigentum/Löschen (Eigentümer/Admin)
/intern/inventar/item/{itemId} → Detailansicht eines Gegenstands (Vorgänge, Mängel, Belege)
/intern/inventar/loan/{loanId} → Detailansicht eines Leihvorgangs
/intern/protokolle       → Zugängliche Protokollbereiche
/intern/protokolle/neu   → Protokollbereich erstellen (jeder eingeloggte Nutzer)
/intern/protokolle/{id}  → Nextcloud-Sitzungsordner synchronisieren und öffnen
/intern/protokolle/{id}/sitzung/{sessionId} → Dateien eines Sitzungsordners + Markdown-Editor
/intern/protokolle/{id}/einstellungen → Verbindung, Muster, Finanzboard, Eigentum und Freigaben (Eigentümer/Admin)
/vorlagen                → Vorlagen-Bereich (Admin ODER Template-Verwalter): Einstieg zu Board-, Finanz- und Protokollvorlagen
/vorlagen/boards         → Board-Templates: Liste + anlegen/umbenennen/löschen/duplizieren
/vorlagen/boards/{id}    → Board-Template bearbeiten: Spalten anlegen/umbenennen/per Drag&Drop sortieren/löschen
/vorlagen/finanzen       → Finanz-Templates: Liste + anlegen/umbenennen/löschen/duplizieren
/vorlagen/finanzen/{id}  → Finanz-Template bearbeiten: Haushaltsplan-Positionen (Auto-Speichern)
/vorlagen/protokolle     → Protokollvorlagen mit zentral aufgelösten Markdown-Variablen
/admin                   → Admin Panel (nur für Admins sichtbar)
/admin/users             → Nutzerverwaltung (nur Rollen inkl. Admin/Template-Verwalter ernennen; Konten/Aktivierung/Löschen laufen über das SSO)
/admin/groups            → Gruppenverwaltung (anlegen, Mitglieder) — nur Admin
/admin/boards            → Übersicht/Verwaltung ALLER Boards (Admin-Aufsicht)
/admin/finanzboards      → Übersicht/Verwaltung ALLER Finanzboards (Admin-Aufsicht)
/admin/inventar          → Inventare: öffentliche Sichtbarkeit je Inventar-Board schalten (nur Admin)
/admin/inventar/gesamt   → Gesamtinventar konfigurieren: einbezogene Boards + Mindestpreis (nur Admin)
/admin/standorte         → Standorte: anlegen/umbenennen/löschen + aktivieren/deaktivieren + Ziel-Board/-Spalte (nur Admin)
/admin/umfragen          → Feedback-Bereiche: wie Standorte, aber fürs Feedback-Formular (nur Admin)
/admin/priorities        → Prioritäten: Bezeichnung + Farbe je Stufe anpassen (nur Admin)
/admin/accounts          → Konten: Auswahloptionen für das Kartenfeld „Konto" verwalten (nur Admin)
/admin/formular          → Antragsformular: Dateien („Wichtige Dokumente") verwalten, die öffentlich auf der Antragsseite erscheinen (nur Admin)
```

> Pfade = Next.js-App-Router-Routen (z.B. `app/status/[token]`, `app/intern`, `app/admin/...`). Interne APIs (z.B. Nutzer-Typeahead für Ersteller/Zugewiesen, Upload-Endpunkte) als Route Handlers unter `app/api/...` bzw. via Server Actions.

### Navigation (nach Login)
Nach dem Login landet jeder Nutzer auf der **Startseite** (`/intern`): Dashboard plus Buttons zu den Bereichen, eingeblendet nach Rolle/Rechten:
- **Boards** (`/intern/boards`), **Finanzen** (`/finanzen`), **Inventar** (`/intern/inventar`), **Protokolle** (`/intern/protokolle`), **Meine Aufgaben** (`/intern/aufgaben`) — jeder Nutzer
- **Neues Board erstellen** — jeder Nutzer
- **Mein Konto** (`/intern/konto`) — jeder Nutzer; Benutzername/Anzeigename kommen aus dem SSO und sind hier nicht änderbar
- **Vorlagen** (`/vorlagen`) — nur für Admin **und** Template-Verwalter sichtbar
- **Admin Panel** (`/admin`) — nur für Admins sichtbar
- **Logout**

**Board-Einstellungen** erreicht man **am jeweiligen Board** (Button in der Board-Ansicht, nur für Eigentümer/Admin sichtbar) → `/intern/board/{id}/einstellungen`, **nicht** über die Startseite.

### Status-Token
- Wird bei Einreichung zufällig generiert (30-stellig, ~175 bit)
- Wird nicht per Mail verschickt — wird am Ende der Einreichung angezeigt
- Antragsteller sieht: aktuellen Status + Datum der letzten Änderung
- **Dokumente ansehen:** Finanzantrag, Anlage A/B und „weitere Dateien" sind über den Token herunterladbar (so sieht man z.B. später die unterschriebene Version). Der **Studierendenausweis bleibt intern** (nicht öffentlich).
- **Dateien einreichen (append-only):** Allgemeine PDFs behalten ihren Namen; Quittungen werden ausschließlich im zusätzlich freigeschalteten Quittungsbereich hochgeladen. Öffentlich kann **nichts bearbeitet/gelöscht/überschrieben** werden. Max. Anzahl begrenzt (Missbrauchsschutz); Archiv-Trigger sperren Uploads.

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
| Antragsnummer | Text (auto) | board-spezifische, automatisch vergebene Nummer (Spalte `number`); Konfiguration in den Board-Einstellungen (`board_numbering`). Anzeige-Toggle ist „nur optisch"; für alle Nutzer mit Board-Zugriff editierbar |
| Haushaltstitel | Text | optionales Freitextfeld (Spalte `budget_title`), pro Board ab-/anschaltbar; Verknüpfungs-Schlüssel zur Finanzübersicht |
| Beantragter Betrag | Euro | `requested_amount` (Cent); wird in Protokollvorschlägen verwendet |
| Genehmigter Betrag | Euro | `approved_amount` (Cent); Eingabe in Euro, Anzeige „… €" |
| Tatsächliche Ausgaben | Euro | `actual_amount` (Cent); überschreibt in den Ausgaben-Views den genehmigten Betrag, sobald gesetzt |
| Anweisungsdatum | Datum | `instruction_date`; auto-gesetzt beim Erreichen der pro Board wählbaren Trigger-Spalte (analog Archiv-Trigger), zusätzlich für alle Nutzer mit Board-Zugriff editierbar |
| Überweisungsdatum | Datum | `transfer_date`; auto-gesetzt beim Erreichen der pro Board wählbaren Trigger-Spalte (analog Anweisungsdatum, eigener Trigger), zusätzlich für alle Nutzer mit Board-Zugriff editierbar |
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
-- field_key: number|applicant|budget_title|requested_amount|approved_amount|actual_amount|creator|assignee|
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

> **Protokollvorlagen** (`/vorlagen/protokolle`) enthalten Markdown. Erlaubte Variablen werden zentral geprüft und beim Anlegen der Nextcloud-Datei aufgelöst; unbekannte Variablen führen zu einer sichtbaren Validierungsmeldung.

```sql
board_templates        (id, name UNIQUE, description, created_at)

board_template_statuses(id, template_id FK→board_templates ON DELETE CASCADE, name,
                        position INTEGER, is_archive_trigger INTEGER DEFAULT 0)
-- beliebig viele Archiv-Trigger; beim Kopieren vollständig übernehmen
```

---

## Haushaltspositionen und öffentliche Einreichung (Migration 0062)

Bestehende Karten bleiben `budget_mode='single'`: bisherige Felder und optionale
Kontozuordnung bleiben unverändert. `card_budget_positions` speichert im Modus
`positions` UUID, Karten-FK (CASCADE), Reihenfolge, Haushaltstitel, Bezeichnung,
verpflichtende Konto-FK (RESTRICT) und drei nullable Centbeträge. `cards.account_id`
und `cards.budget_title` sind dann NULL; die drei Kartenbeträge sind atomar mit den
Positionen gespeicherte Gesamtsummen. Es gibt keine zweite Kontozuordnung.
Je Betragsart gilt: ausschließlich vorhandene Werte summieren, alle leer → NULL,
echte Null → 0; Positionswerte und Gesamtsummen maximal 2.000.000.000 Cent.
Die Live-Ausgabe verwendet je Position tatsächlich, sonst genehmigt, sonst 0.
Kartenbeträge, Positionszeilen und Budgetrevision werden beim Öffnen des Editors
und beim Start einer Mehrfachzuordnung aus demselben Datenbanksnapshot gelesen.

Der erste Wechsel füllt Position 1 mit den bisherigen Kartenwerten vor; sichtbare
Felder können bereits vor dem ersten Speichern geändert werden. Neue Positionen
haben leere Beträge. Interne Datenbankfelder (`cardId`, `position`) werden nicht
in den bearbeitbaren Entwurf oder das Schreibobjekt übernommen.
Beim Autosave-/Live-Abgleich bleibt der eingegebene Betragstext erhalten, wenn
der Centwert unverändert ist; kein Ergänzen von Nachkommastellen während der
Bearbeitung. Tatsächlich geänderte Serverwerte werden in saubere Entwürfe übernommen.
Fehlende Konten blockieren den gesamten Speichervorgang und
lassen den lokalen Entwurf stehen. `budget_revision` erkennt konkurrierende
Budgetänderungen. Einzelne befüllte Positionen werden nur nach Bestätigung entfernt.
Eine verbleibende Position kehrt erst bei leerer Bezeichnung verlustfrei in den
Einzelmodus zurück. Im Editor müssen Haushaltstitel und Konto aktiviert sein.
Ausgeblendete Betragsfelder bleiben ausgeblendet und werden beim Speichern erhalten;
Positionen mit ausgeblendeten befüllten Feldern dürfen nicht indirekt gelöscht werden.
REST und Server Actions prüfen dieselben Regeln und sperren direkte Änderungen an
Mehrfach-Kartengesamtsummen und globalem Konto. Löschen verwendeter Positionskonten
ist gesperrt; Einzelkarten behalten die bisherige SET-NULL-Regel.

Die Finanz-Antragsliste zeigt jede Karte einmal mit vollständigen Kartensummen
und deduplizierten, kommagetrennten Haushaltstiteln. Aufnahme bei mindestens einem
passenden Positionskonto; Ausgaben werden dagegen ausschließlich aus den Positionen
der ausgewählten Konten berechnet, inklusive Ausgaben-Konten-Override. Leere Titel
bleiben wie bisher ohne Plan-Zuordnung. Antragslistenexporte sind flach, sortiert nach
Nummer oder Titelanzeige; keine irreführenden Zwischensummen nach Titelkombinationen.
Archivpfad, Kanban-Suche, Aufgabenübersicht und Protokollverknüpfungen verwenden bei
Bedarf eine separate Titel-/Kontenanzeige; niemals als Schlüssel für die Auswertung.

Quittungsquellen stehen in `board_statuses.is_receipt_trigger`; die Altspalte
`boards.receipt_from_status_id` wird nur migrationsbedingt aufbewahrt und nicht mehr
ausgewertet. Migration übernimmt die bisherige Quelle. Zielspalte bleibt erhalten.
Archiv- und Quittungstrigger erlauben jeweils beliebig viele Quellen desselben Boards.
Archiv-Trigger sperren öffentlich Uploads und Einreichen unabhängig von anderen Gates.
Nachreichung und Quittung dürfen gleichzeitig angeboten werden; jede Aktion benennt
ihren Zweck ausdrücklich. Allgemeine Uploads bleiben unabhängig davon möglich.

Öffentliche Uploads starten nach Mehrfachauswahl sofort, einzeln in einer Warteschlange
mit Dateistatus und gezieltem Retry. Kein Upload löst die abschließende Einreichung aus;
während Uploads laufen sind beide Einreichen-Aktionen blockiert. `upload_purpose`
unterscheidet general/resubmission/receipt (Altdateien bleiben NULL). Nur receipt
erhält die vorhandene Q-Nummerierung; allgemeine Dateinamen bleiben sicher bereinigt
erhalten. Quittungsnummer und 30-Dateien-Grenze werden unter Kartensperre vergeben;
Status und Board-Gates werden innerhalb derselben Transaktion frisch geprüft. Bei
fehlgeschlagener DB-Zuordnung wird die neu gespeicherte Datei entfernt. Interne
Mehrfach-PDF-Anhänge nutzen dieselbe Warteschlange; Einzeldokument-Slots bleiben einzeln.
Die öffentliche Statusseite und API zeigen ausschließlich den genehmigten Karten-
Gesamtbetrag zusätzlich an (NULL und 0 unterscheidbar), keine Konten oder Positionen.

## Card-Titel Format
```
{Titel}
Beispiel: "Grillabend am FB5"
```
- **Titel** (Spalte `title`) ist der Kartentitel — immer sichtbar, **nicht abschaltbar** (jede Karte braucht einen Titel).
- **Antragsteller** ist ein **eigenes, optionales Feld** (Spalte `applicant`, field_key `applicant`), das pro Board ein-/ausgeschaltet werden kann. Vom öffentlichen Formular wird es befüllt; manuell angelegte Karten können es leer lassen.
- **Neue Karte (intern):** Button öffnet ein **Popup** mit allen sichtbaren Feldern. Karte wird sofort angelegt; **Erstellen und Bearbeiten speichern automatisch** (kein Speicher-Button). „Verwerfen" löscht die Karte wieder.

---

## Inventar- & Entleihsystem

Eigenständiges Modul (seit 2.0.0) zur Verwaltung von Gegenständen und deren Ausleihe. **Inventar-Boards sind keine Kanban-Boards** — eigene Tabellen, eigene Listenansicht. Sie teilen sich mit den Kanban-Boards nur Nutzer, Gruppen und das **identische Zugriffsmodell**: Zugriff = Admin ∨ Eigentümer ∨ Freigabe an Nutzer/Gruppe (binär); Verwalten = Admin ∨ Eigentümer (`lib/inventory.ts`, gleiche Struktur wie `lib/authz/index.ts`). Jeder eingeloggte Nutzer darf ein Inventar-Board erstellen und ist dann dessen Eigentümer.

Zwei Schalter bleiben **dem Admin vorbehalten**:
- **Öffentlich** (`is_public`, `/admin/inventar`) — das Inventar erscheint unter `/inventar`
- **Im Gesamtinventar** (`include_in_overview`, `/admin/inventar/gesamt`) — fließt ins Anlagenverzeichnis ein

### Gegenstände
- **Felder pro Board konfigurierbar** (`inventory_board_fields`, exakt wie `board_card_fields` bei Karten). Feld-Keys: `group`, `number`, `serial_number`, `category`, `location`, `condition`, `lendable`, `current_holder`, `availability`, `price`, `purchase_date`, `vendor`, `notes`. Die **Bezeichnung** (`name`) ist immer sichtbar und nicht abschaltbar (sie ist die Identität des Gegenstands).
- **`current_holder` und `availability` sind abgeleitet** (read-only) — sie ergeben sich aus den laufenden Vorgängen und stehen nicht im Bearbeiten-Formular.
- **Auswahloptionen** (`inventory_options`, unterschieden über `kind`): Kategorien (Multiselect), Standorte — **direkt beim Erfassen erweiterbar**. `kind='loan_status'` ist eine Altlast: der Entleihstatus wird nicht mehr manuell gesetzt, sondern aus den Vorgängen abgeleitet.
- **Stückzahl:** `quantity` ≥ 1 — ein Gegenstand (eine Inventarnummer) kann mehrere physische Einheiten haben (z.B. 100 Becher). Verfügbare Menge = `quantity` − Summe der aktuell verliehenen Mengen. Über `group_name` („Artikel/Gruppe") lassen sich mehrere gleichartige **Einzelstücke** zu einer Gruppe zusammenfassen.
- **Zustand** (`condition`): `active` | `defect` | `lost`. Defekte/verlorene Stücke landen im **Archiv** (`/intern/inventar/{id}/archiv`), sind nicht entleihbar und öffentlich unsichtbar.
- **Inventarnummern** (`inventory_numbering`) funktionieren wie die Antragsnummern der Boards (Präfix/Jahr/Code/Zähler, atomare Vergabe).
- **Mängel** (`inventory_defects`) je Gegenstand mit Historie; `resolved_at IS NULL` = offener Mangel.
- **Dateien** (`inventory_attachments`): Kaufbelege, Leihanträge, Leihverträge, weitere Dateien — **append-only**, werden nie automatisch gelöscht (Nachvollziehbarkeit). Optional mit einem konkreten Vorgang verknüpft (`loan_id`).

### Leihvorgänge — kartengeführt über ein System-Board

> **Kernidee:** Ein Leihvorgang hat keinen eigenen Statusautomaten. Jedes Inventar bekommt ein **automatisch angelegtes Kanban-Board** („System-Board", `boards.inventory_board_id`), auf dem jeder Vorgang als Karte liegt — und **die Spalte der Karte definiert den Vorgangsstatus** (`syncLoanFromCard` in `lib/inventory-loans.ts`). Das Gremium arbeitet also im gewohnten Kanban, das Inventar zieht automatisch nach.

- **Feste Spaltenstruktur** des Leihboards (`LOAN_BOARD_COLUMNS` in `lib/boards.ts`): *Eingegangen · In Prüfung · Vertrag bereitgestellt · Vertrag unterschrieben · Ausleihe bestätigt · in Ausleihe · Zurückgegeben*.
- **Zwei Trigger-Spalten** am Inventar (`loan_active_status_id` / `loan_returned_status_id`, per Default „in Ausleihe" / „Zurückgegeben"): Karte erreicht „in Ausleihe" → Vorgang `active`, Gegenstand gilt als entliehen. Karte erreicht „Zurückgegeben" → Vorgang `returned`, Menge wieder verfügbar.
- **Rückwärts korrigierbar:** Wird die Karte aus „in Ausleihe" wieder herausgezogen, fällt der Vorgang auf `contract_provided` zurück — der Entleiher kann den Vertrag weiter einreichen. Der normale Vertragsfortschritt wird dabei nicht angefasst.
- **Vorgangsstatus** (`inventory_loans.status`): `requested` → `contract_provided` → `contract_signed` → `active` → `returned`; `rejected` und `withdrawn` sind Endzustände **vor** der Annahme.
- **Ein Vorgang reserviert 1..n konkrete Stücke** (`inventory_loan_items` mit Menge je Stück) — angefragte Menge (`requested_quantity`, unveränderlich) vs. bestätigte Menge (Summe der zugeordneten Stücke), in der UI als „A von B".
- **Nebenläufigkeit:** Gegenläufige Kartenbewegungen derselben Karte werden per `pg_advisory_xact_lock(ns, cardId)` serialisiert; innerhalb der Sperre wird der Kartenstatus **frisch gelesen** statt dem übergebenen Wert zu vertrauen.
- **Keine Überbuchung:** Eine öffentliche Anfrage sperrt **alle** von ihr reservierten Stücke (`loanRequestLockIds`, aufsteigend sortiert → deadlock-frei) und prüft die freie Menge **innerhalb** der Sperren erneut. Nur das Leit-Stück zu sperren reichte nicht: Eine Obergruppen-Anfrage und eine gleichzeitige Einzel-Anfrage auf dasselbe Gruppenmitglied nahmen sonst verschiedene Sperren und buchten denselben Bestand doppelt.

**System-Boards sind gesperrt:** `requireBoardManage` weist Boards mit gesetztem `inventory_board_id` **hart mit 404 ab** (nicht nur per Redirect). Sonst ließen sich dort Done-Spalte, Archiv-Trigger oder Nextcloud scharfschalten — beides würde Leihkarten wegräumen. Verwaltet wird das Leihboard ausschließlich über `/intern/inventar/{id}/einstellungen`. Zugriff und Mitgliederliste des System-Boards **spiegeln das Inventar** (siehe `canAccessBoard` / `getBoardMemberUsers`).

### Öffentlicher Ausleih-Ablauf

1. `/inventar` listet die vom Admin freigegebenen Inventare, `/inventar/{id}` die verfügbaren Gegenstände (suchen, nach Kategorie filtern).
2. Anfrage absenden → Vorgang `requested` + **Status-Token**; falls ein Leihboard existiert, entsteht die Karte in der ersten Spalte. Das Formular hat denselben Spam-Schutz wie Antrag und Feedback — **Honeypot, signierte Zeitfalle** und einen eigenen Rate-Limit-Scope (`inventory-request`); geprüft wird vor jedem Datei- und Datenbankzugriff, damit eine verworfene Einsendung weder eine Ausweis-Datei schreibt noch einen Vorgang anlegt.
3. `/inventar/status/{token}` zeigt den Fortschritt **anhand der Kartenspalten** (Stepper) plus die Hinweise des Verleihers (`borrower_note`). Dort kann der Entleiher den bereitgestellten Vertrag herunterladen, den unterschriebenen hochladen und **„Vertrag einsenden"** — das bewegt die Karte von „Vertrag bereitgestellt" nach „Vertrag unterschrieben", aber **nur aus dieser Quell-Spalte** (nie rückwärts, kein Überspringen; gleiches Von→Nach-Prinzip wie der Quittungs-Zug auf normalen Boards). Außerdem kann er die Anfrage zurückziehen.

**Öffentlich sichtbar ist eine bewusste Whitelist** (`PUBLIC_INVENTORY_FIELD_KEYS` in `lib/inventory-public.ts`): nur **Bezeichnung, Kategorie, Stückzahl/Verfügbarkeit** und ggf. „entliehen bis \<Datum\>" — **ohne Person**. **Nicht öffentlich:** Inventar-/Seriennummer, Standort, Kaufpreis, Händler, Kaufdatum, Belege, „aktuell bei" und Verträge. Gezeigt werden ausschließlich Gegenstände mit `lendable = true` **und** `condition = 'active'`.

### Gesamtinventar (Anlagenverzeichnis)
Board-übergreifende Liste aller Artikel aus den einbezogenen Inventaren mit **Preis ≥ Mindestpreis**, einzeln gelistet (keine Zwischensummen) plus Gesamtsumme — für gesetzliche Nachweise. `/intern/inventar/gesamt` ist **Nur-Ansicht für jeden eingeloggten Nutzer**; die Konfiguration (einbezogene Boards, Mindestpreis) macht nur der Admin unter `/admin/inventar/gesamt`. CSV-Export in verschiedenen Sortierungen.

### Datenmodell (Ergänzung)
```sql
inventory_boards       (id, name, description, owner_id FK→users ON DELETE RESTRICT,
                        is_public, include_in_overview,
                        loan_board_id        FK→boards         NULL ON DELETE SET NULL,
                        loan_active_status_id   FK→board_statuses NULL,  -- „in Ausleihe"
                        loan_returned_status_id FK→board_statuses NULL,  -- „Zurückgegeben"
                        created_at)
-- boards.inventory_board_id FK→inventory_boards ON DELETE CASCADE markiert das
-- System-Board (Leihvorgänge) und löscht es mit dem Inventar mit.

inventory_board_access (id, board_id FK→inventory_boards ON DELETE CASCADE,
                        user_id FK→users NULL, group_id FK→groups NULL,
                        CHECK ((user_id IS NULL) != (group_id IS NULL)),
                        UNIQUE(board_id,user_id), UNIQUE(board_id,group_id))

inventory_options      (id, board_id FK→inventory_boards ON DELETE CASCADE,
                        kind CHECK(kind IN ('category','location','loan_status')),
                        name, position, created_at, UNIQUE(board_id,kind,name))

inventory_items        (id, board_id FK→inventory_boards ON DELETE CASCADE,
                        number NULL, name, group_name NULL,
                        quantity CHECK(quantity >= 1) DEFAULT 1, lendable,
                        location_id FK→inventory_options NULL, loan_status_id NULL,  -- loan_status_id = Altlast
                        price NULL, purchase_date NULL, vendor NULL, serial_number NULL,
                        condition CHECK(condition IN ('active','defect','lost')),
                        condition_note NULL, notes NULL,
                        created_at, updated_at, creator_user_id FK→users NULL)

inventory_item_categories (item_id FK→inventory_items, option_id FK→inventory_options,
                           PRIMARY KEY(item_id, option_id))          -- n:m Multiselect

inventory_board_fields (board_id FK→inventory_boards ON DELETE CASCADE, field_key,
                        visible DEFAULT 1, position, PRIMARY KEY(board_id, field_key))
inventory_numbering    (board_id PK FK→inventory_boards ON DELETE CASCADE,
                        enabled, prefix, year, code, separator, padding, next)

inventory_loans        (id, item_id FK→inventory_items ON DELETE CASCADE,
                        status CHECK(status IN ('requested','contract_provided',
                          'contract_signed','active','returned','rejected','withdrawn')),
                        token UNIQUE NULL,       -- öffentlicher Status-Link (nur bei Anfragen)
                        borrower, borrower_email NULL, purpose NULL,
                        start_date NULL, end_date NULL,
                        requested_quantity DEFAULT 1,   -- angefragt (unveränderlich)
                        returned_at NULL,               -- NULL = laufend
                        notes NULL, borrower_note NULL, -- borrower_note: über Status-Link sichtbar
                        card_id FK→cards NULL ON DELETE SET NULL,  -- Tracking-Karte
                        created_at, created_by FK→users NULL)

inventory_loan_items   (loan_id FK→inventory_loans ON DELETE CASCADE,
                        item_id FK→inventory_items ON DELETE CASCADE,
                        quantity CHECK(quantity >= 1), PRIMARY KEY(loan_id, item_id))

inventory_defects      (id, item_id FK→inventory_items ON DELETE CASCADE, description,
                        resolved_at NULL, created_at, created_by FK→users NULL)

inventory_attachments  (id, item_id FK→inventory_items ON DELETE CASCADE,
                        loan_id FK→inventory_loans NULL ON DELETE SET NULL,
                        kind CHECK(kind IN ('receipt','loan_request','loan_contract','other')),
                        filename, path, mime, size, uploaded_at, uploaded_by FK→users NULL)

inventory_overview_config  (id PK DEFAULT 1, min_price)   -- Singleton, Cent
user_inventory_board_order (user_id, board_id, position, PRIMARY KEY(user_id, board_id))
```

---

## Protokolle

`/intern/protokolle` ist ein eigenständiger Bereich wie Finanzen oder Inventar,
kein Kanban-Board. Ein **Protokollbereich** gehört einem Nutzer und kann binär an
Nutzer oder Gruppen freigegeben werden. Sehen und Bearbeiten gilt für alle
Mitglieder; Name, Freigaben, WebDAV-Verbindung, Namensmuster und
Finanzverknüpfung verwalten ausschließlich Eigentümer oder Administratoren. Alle
Server Actions und Seiten verwenden dafür `requireProtocolAreaAccess` bzw.
`requireProtocolAreaManage`; UI-Ausblendung ist nicht die Sicherheitsgrenze.

### Speicher- und Synchronisationsmodell

- Sitzungsordner und Markdown-Protokolle liegen **ausschließlich in Nextcloud**.
  `protocol_sessions` speichert nur Ordnername, optional erkanntes Datum,
  WebDAV-Pfad, `oc:fileid`, ETag/Änderungszeit und letzten Abgleich. Der
  Markdown-Inhalt wird weder in PostgreSQL noch im lokalen Upload-Verzeichnis
  persistiert.
- Beim Öffnen eines Bereichs sowie über „Jetzt synchronisieren“ wird der
  WebDAV-Wurzelpfad gelesen. Direkte Unterordner werden als Sitzungen registriert.
  Weitere Dateien werden aufgelistet und über einen Nextcloud-Link geöffnet.
  Gremio verschiebt oder überschreibt sie nicht; Löschungen erfolgen nur nach
  expliziter Bestätigung über die unten beschriebenen Löschaktionen. Auch die
  Konfigurationsprüfung liest den Wurzelpfad nur und legt ihn nicht selbst an.
- Auch beim direkten Öffnen oder Neuladen einer Sitzung wird deren Dateiliste
  anhand derselben Erkennungsregeln abgeglichen: konfigurierter Dateiname,
  bekannte Datei-ID, gespeicherter Pfad. Extern angelegte Protokolle werden
  sofort registriert und im Editor geöffnet, ohne Umweg über die Übersicht.
  Ein erfolgreiches Listing aktualisiert die Metadaten; bei Cloud-Fehlern
  bleiben sie erhalten. Existiert die Datei beim exklusiven Anlegen bereits,
  wird sie ebenfalls erkannt und die Sitzungsseite aktualisiert, nicht ersetzt.
- Neue Ordner und Dateien werden mit exklusivem Anlegen (`If-None-Match: *`)
  erzeugt. Ein vorhandener Sitzungsordner wird geöffnet; eine vorhandene Datei
  wird beim Anlegen nie ersetzt. Das Speichern im Editor überschreibt dagegen
  bewusst die registrierte Protokolldatei ohne `If-Match` oder
  `If-Unmodified-Since`, auch wenn ETag/Änderungszeit fehlen oder veraltet sind.
  Zwischenzeitliche externe Änderungen können dabei verloren gehen; die
  Oberfläche weist darauf hin. ETags bleiben technische Synchronisationsmetadaten.
  Berechtigungs-, Netzwerk- und Dateisperrfehler werden weiterhin als Fehler
  gemeldet, nicht als erfolgreiche Speicherung.
- Nextcloud-`oc:fileid` wird über einen expliziten `PROPFIND` abgefragt und, wenn
  verfügbar, zur Wiedererkennung umbenannter Ordner/Dateien benutzt. Fehlt die
  serverabhängige Eigenschaft, bleiben Pfad und ETag der nachvollziehbare
  Fallback. Zugangsdaten bleiben serverseitig, sind AES-256-GCM-verschlüsselt und
  durch die bestehende HTTPS-/DNS-Pinning-/Redirect-SSRF-Härtung geschützt.

Die direkten Protokoll-Lade-/Speicheraktionen prüfen dieselben aktuellen
Wurzelpfad-, Sitzungsordner- und Dateiidentitäten wie der Dokumenteditor, auch
wenn der Aufrufer keine erwartete Datei-ID liefert. Markdown wird beim Lesen
auf tatsächlich übertragene 2.000.000 Bytes und 30 Sekunden begrenzt; dasselbe
Bytelimit gilt beim Schreiben. Generierte Datei-/Ordnernamen werden bereits
vor der Erstellung gegen die WebDAV-Pfadregeln und die 255-Byte-Grenze geprüft.
Während „Neu laden“ bleibt das Dokument schreibgeschützt, damit neu eingetippter
Text nicht durch die eintreffende Antwort verloren geht.

### Mitglieder und Anwesenheit

Im eigenständigen Dokumenteditor öffnet „Sitzungsdaten“ einen modalen Vorbereitungsbereich
mit aufklappbaren Abschnitten für Mitglieder, Gäste und Sitzungsinformationen.
Formularentwürfe bleiben beim Schließen erhalten; nicht übernommene Eingaben
blockieren Speichern und Export und werden in der Kopfzeile angezeigt.
`protocol_members` speichert je Bereich Namen und Reihenfolge;
`protocol_attendance` speichert je Sitzung/Mitglied Anwesenheit und optional
das andere Bereichsmitglied, auf das die Stimme übertragen wurde. Namen sind
keine Benutzerkonten. Bereichsmitglieder dürfen diese Daten bearbeiten. Die
Reihenfolge ist per Drag-and-drop-Griff sowie Tastatur veränderbar und gilt im
gesamten Bereich. Ohne Auswahl gilt „Nein“ bzw. keine Übertragung. Selbst- und
bereichsfremde Übertragungen sind serverseitig ausgeschlossen; darüber hinaus
werden keine fachlichen Stimmrechtsregeln angenommen.

Mitgliederdaten werden direkt in Gremio gespeichert, unabhängig vom Cloud-Speichern.
Im geöffneten Editor wird unter `## Anwesenheit` / `### Mitglieder` automatisch
eine Tabelle mit „Mitglied“, „Anwesend“ und „übertragen auf“ aktualisiert.
Sie enthält alle Mitglieder in Listenreihenfolge, Ja/Nein und einen Namen oder
eine leere Übertragungszelle. Bestehende Abschnitte werden wiederverwendet;
Notizen und Gäste bleiben erhalten. Die Vorschau rendert Markdown-Tabellen.
Beim Speichern werden die aktuellen Daten nochmals serverseitig eingearbeitet.
Die Cloud-Datei wird erst mit „In Nextcloud speichern“ geschrieben; andere
bereits gespeicherte Protokolle werden nicht im Hintergrund verändert.

Das Entfernen eines Mitglieds erfordert eine Bestätigung, löscht seine
Anwesenheitsdaten in allen Sitzungen des Bereichs und leert Verweise auf dieses
Mitglied als Stimmempfänger. Sitzungslöschung entfernt nur ihre Anwesenheitsdaten,
nicht die Mitgliederliste. Fremdschlüssel und Indizes sichern die Beziehungen;
kurze bereichsweise Transaktionen serialisieren Listenänderungen. Migration:
`0058_lazy_hedge_knight.sql`.

### Gäste je Sitzung

`protocol_guests` speichert Name (Pflichtfeld, max. 200 Zeichen), Zugehörigkeit
(optional, max. 300) und Anliegen (optional, max. 1000) ausschließlich je
Sitzung. Die einfache Liste folgt der Anlegereihenfolge; sie ist kein
bereichsweites Verzeichnis und vergibt keine Anwesenheits- oder Stimmrechte.
Bereichsmitglieder können Gäste in der Seitenleiste hinzufügen, bearbeiten und
nach Bestätigung entfernen. Fremde Sitzungs-/Bereichs-IDs werden abgewiesen.
Ein indizierter Sitzungs-Fremdschlüssel entfernt Gästedaten bei Sitzungslöschung.
Migration: `0059_sleepy_ender_wiggin.sql`.

Über „Gast hinzufügen“ bzw. „Änderungen übernehmen“ werden die Formulardaten in
Gremio gespeichert. Nicht übernommene Entwürfe bleiben bei Fehlern erhalten und
blockieren das Speichern/Neuladen der Cloud-Datei, statt unbemerkt ausgelassen
zu werden. Das aktualisierte Protokoll wird weiterhin ausdrücklich gespeichert.
Beide Tabellen stehen standardmäßig gemeinsam unter `## Anwesenheit`, auch bei leeren Listen.
In den beiden Seitenleistenreitern kann der jeweilige Abschnitt über „Aus Protokoll
entfernen“ ausgeblendet und über „Zum Protokoll hinzufügen“ wieder erzeugt werden.
Personendaten bleiben erhalten; eigene Notizen innerhalb des entfernten Abschnitts
werden nach Bestätigung mit entfernt. Die Auswahl wird durch unsichtbare
`gremio:attendance:members:hidden` bzw. `gremio:attendance:guests:hidden`-HTML-Kommentare
in der Protokolldatei gespeichert und beim Laden, Aktualisieren und serverseitigen
Speichern respektiert. Eine leere Anwesenheitsüberschrift wird entfernt; andere
Anwesenheitsnotizen und Unterabschnitte bleiben erhalten. Keine Datenbankmigration.
Unter der Mitgliedertabelle wird `### Gäste` mit „Name“, „Zugehörigkeit“ und
„Anliegen“ gepflegt. Bestehende Gästeabschnitte werden wiederverwendet und bei
Bedarf hinter die Mitglieder verschoben; passende unmarkierte Tabellen werden
übernommen, eigene Notizen und Codebeispiele bleiben erhalten. Beide Tabellen
werden beim Laden im Editor und serverseitig beim Speichern konsistent erzeugt.

### Datei-Upload und PDF-Editor

Im Dokumenteditor lädt „Bild einfügen“ ein Bild in `attachments` neben der
geöffneten Markdown-Datei. Der Server prüft die Dokumentberechtigung und
Dateiidentität, dekodiert PNG/JPEG/WebP/GIF (maximal 5 MB und 16 Megapixel) und
legt eine metadatenbereinigte PNG-Datei mit eindeutigem Namen exklusiv ab.
GIFs werden dabei als Standbild übernommen. Der relative Markdown-Verweis
`![Bild](attachments/name.png)` wird an der gemerkten Cursorposition eingefügt;
während des Uploads eingegebener Text bleibt erhalten. Bilddateien werden sofort
hochgeladen; Verweis und Größenänderungen folgen dem normalen Dokument-Speichern.
Entfernen eines Verweises oder Rückgängig löscht keine Datei in Nextcloud.

Strg/Cmd+V fügt Bilddateien aus der Zwischenablage über denselben Uploadweg ein,
in Live-Vorschau und Bearbeiten. Der Paste-Handler fängt nur Bilder innerhalb
des bearbeitbaren Dokuments ab; Text-Paste und Formulare bleiben unverändert.
Bild-Paste verwendet die aktuelle Auswahl, nicht die zuletzt für den Dateidialog
gemerkte Position. Pro Einfügevorgang wird ein Bild übernommen; mehrere Bilder
oder Einfügen während eines laufenden Vorgangs zeigen eine Meldung statt eines
teilweisen Uploads. Clipboard-HTML wird nicht nach externen Bild-URLs durchsucht.

In der Live-Vorschau erscheinen beim Überfahren des Bildes vier ziehbare Ecken.
Skalierung erhält das Seitenverhältnis und speichert die Breite als
`![Bild](attachments/name.png){width=420}` (Markdown-Attributliste). Drag-Vorschauen
ändern nur die Darstellung; Loslassen erzeugt genau einen Undo-Schritt, Escape
bricht ab. Live-/Lesevorschau teilen denselben Bildrenderer. Relative Bildpfade
werden ausschließlich über den berechtigten Image-Endpunkt geladen; externe
URLs, Elternpfade, SVG/HTML und Data-URLs werden nicht als Bilder eingebunden.
Der PDF-Export lädt lokale Unterordnerbilder in seine Ressourcen-Allowlist und
übernimmt ausschließlich geprüfte numerische Breiten, keine freien CSS-Styles.

Die Sitzungsdateiliste öffnet Unterordner über deren Namen oder „Öffnen“ innerhalb
von Gremio (`?folder=Anlagen%2FUnterordner`). Die Pfadnavigation und „Übergeordneter
Ordner“ führen zurück. `lib/protocol-paths.ts` validiert jedes relative Segment;
absolute Pfade, Traversal und interne WebDAV-Trenner sind verboten. Die
Protokollerkennung bleibt auf die oberste Ebene des Sitzungsordners beschränkt.
Uploads, PDF-/Bildvorschau, PDF-Bearbeitung, Markdown-Editor und Dateilöschung
übernehmen den geöffneten Unterordner. Im Markdown-Editor führt Zurück wieder
in diesen Ordner; gleichnamige Markdown-Dateien in Unterordnern sind keine
zusätzlichen Sitzungsprotokolle.

Unter der Sitzungsdateiliste lädt `ProtocolFileUpload` eine Datei sofort nach der
Auswahl in den geöffneten Nextcloud-Ordner (1 Byte bis 25 MB, beliebige Dateitypen).
Ein zusätzlicher Upload-Klick entfällt; bei Fehlern ist „Erneut versuchen“ möglich.
Dateinamen bleiben erhalten; Pfade, versteckte und überlange Namen werden abgewiesen.
Der Upload ist atomar mit `If-None-Match: *`: gleichnamige Dateien bleiben erhalten.
Nach Erfolg wird die Liste aktualisiert; nach Fehler bleibt die Dateiauswahl bestehen.

„Markdown-Datei erstellen“ legt nach Eingabe eines Dateinamens eine leere `.md`
im aktuell geöffneten Ordner an und öffnet sie direkt im Dokumenteditor. Fehlendes
`.md` wird ergänzt. Der Server prüft dieselben Bereichs-, Sitzungs-, Ordner- und
Dateinamengrenzen wie beim Upload; `createWebDavTextExclusive` verhindert das
Überschreiben vorhandener Dateien. Fehler bleiben im Dialog, ohne bestehende
Dateien zu öffnen oder zu ersetzen. Die Erstellung ist ratenbegrenzt.

PDF-Dateien in der Sitzungsdateiliste öffnen über ihren Dateinamen den vorhandenen
`AttachmentLink`/`PdfViewerModal` mit Freitext-/Formularbearbeitung und der vorhandenen
optionalen Signaturfunktion. `pdf/fields?name=...` liefert Formularfelder über denselben
berechtigten Lesepfad. `saveProtocolPdfEditsAction` verwendet `applyEditsAndSign` und
ersetzt beim Speichern das Original in Nextcloud. Bereichsrechte, Sitzungszuordnung,
Ordner- und Dateiidentität werden serverseitig erneut geprüft; auch das Ergebnis darf
höchstens 25 MB groß sein. Fehlende Nextcloud-Datei-IDs im Standard-stat werden per
explizitem Depth-0-PROPFIND ergänzt. Upload und PDF-Speichern sind ratenbegrenzt;
beide halten Nextcloud-Zugangsdaten und Dateiinhalte aus PostgreSQL heraus.
`GET /api/protokolle/{areaId}/sitzung/{sessionId}/pdf?name=...` prüft Anmeldung,
Bereichszugriff und Sitzungszuordnung. Der Dateipfad wird ausschließlich aus
konfiguriertem Wurzelpfad, gespeichertem Sitzungsordner, optionalem validiertem
Unterordner (`folder`) und direktem Dateinamen gebildet; Nextcloud-Zugangsdaten
bleiben serverseitig. Der geschützte
WebDAV-Client lädt maximal 25 MB mit 30 Sekunden Zeitlimit, prüft Dateityp und
PDF-Kennung und zählt die tatsächlichen Bytes. Antworten sind `private, no-store`
und `nosniff`; WebDAV-Fehlerdetails werden nicht an den Browser weitergegeben.

PNG-, JPEG-, GIF- und WebP-Dateien öffnen über ihren Dateinamen
denselben Viewer im Bildmodus. `GET .../sitzung/{sessionId}/image?name=...` verwendet
dieselben Bereichs-/Sitzungsprüfungen und den begrenzten WebDAV-Lesepfad wie PDFs.
Der Antwort-MIME-Typ wird anhand der Dateikennung ermittelt; SVG/HTML werden
nicht als Bilder ausgeliefert. Andere Formate bleiben über Nextcloud erreichbar.

### Explizites Löschen

Auf der Sitzungsseite können Bereichsmitglieder einzelne Dateien über „Datei
löschen“ entfernen. In der Sitzungsübersicht steht neben „Öffnen“ ein rotes
„Löschen“. Dieses öffnet den Bestätigungsdialog mit der erforderlichen Eingabe
`LÖSCHEN` und entfernt die gesamte Nextcloud-Collection einschließlich aller
Dateien und Unterordner. Beide Aktionen verwenden den vorhandenen
In-App-Bestätigungsdialog; Gremio bietet keine Wiederherstellung an. Andere
Sitzungen und der konfigurierte Wurzelordner sind keine zulässigen Löschziele.

Serverseitig werden Bereichszugriff, Sitzungszugehörigkeit, direkte Dateinamen
ohne Traversal und der aktuelle Typ/die bekannte Datei-ID geprüft. Umbenannte
oder ersetzte Ziele werden abgewiesen. Für DELETE wird ein frisch gelesener
starker ETag korrekt zitiert als `If-Match` verwendet, wenn vorhanden (dieser
Löschschutz ist unabhängig vom bewusst überschreibenden Editor-Speichern).
404 ist für Wiederholungen zulässig; andere WebDAV-Fehler brechen ab.

Beim Löschen des registrierten Protokolls oder der ganzen Sitzung werden zuerst
auch die Zugriffe auf alle tatsächlich verknüpften Antragsboards geprüft. Erst
nach erfolgreichem Cloud-DELETE werden die Relationen und Metadaten in einer
Datenbanktransaktion bereinigt. Automatische Beschlussreferenzen fallen auf eine
verbleibende automatische Sitzungsreferenz zurück oder werden geleert; manuelle
Werte, Kartenstatus und -position bleiben erhalten. Beim Löschen einer anderen
Datei bleiben Protokoll und Relationen unverändert. Die Protokolldatei kann nach
ihrem Löschen in derselben Sitzung neu angelegt werden. Scheitert die lokale
Bereinigung nach dem Cloud-DELETE, bleibt eine explizite Fehlermeldung im Dialog;
dieselbe Löschaktion kann die Bereinigung wiederholen. Es gibt weiterhin keine
automatischen Lösch- oder Aufräumjobs.

### Vorlagen, Markdown und Finanzkarten

Die Protokolleinstellungen verwenden dieselbe `CollapsibleSection` wie die
Board-Einstellungen (eingeklappte Karten, gemeinsame Abstände und Seitenbreite).
WebDAV ist als URL/Pfad, darunter Benutzername/Passwort angeordnet. Formular-
Inhalte bleiben beim Einklappen gemountet; ungültige Pflichtfelder öffnen ihre
Karte. Auswahlfelder und Sitzungskalender verwenden die vorhandenen `Select`
und `DatePicker`, auch bei Mitglieder-Stimmübertragung und in Mini-Editoren.
Der optionale `AnchoredPopover`-Portalmodus verhindert abgeschnittene Menüs in
Toolbars und scrollbaren Modals und begrenzt ihre Position auf den Viewport.
Der übrige App-Einsatz dieser Komponenten behält den bisherigen Inline-Modus.
Sitzungsdaten und Bestätigungen verwenden `Modal`/`ConfirmDialog`, Logoentfernung
`DeleteConfirm`; der Sitzungsdialog erhält durch `keepMounted` nicht übernommene
Formulareingaben auch beim Schließen. Fokus wird beim Öffnen/Schließen geführt.
Nur der Dateiauswahldialog und die unvermeidliche Browserwarnung beim Schließen
oder Neuladen des gesamten Tabs bleiben betriebssystem-/browserseitig.

Markdown-Dateinamen (`.md`/`.markdown`) im Sitzungsordner öffnen das Modul
`/dokumente/[areaId]/[sessionId]?name=…`. Die Ordnerseite lädt keinen Editor und
keinen Markdown-Inhalt mehr. `lib/markdown-documents.ts` prüft bei Laden/Speichern
Bereichsrechte, Sitzungszuordnung, validierte Unterordnerpfade, Dateityp, Größenlimit und
bekannte Nextcloud-Datei-IDs. Nur die registrierte Protokolldatei erhält die
optionale Protokollerweiterung des `DocumentEditor`; andere Markdown-Dateien
werden unverändert ohne Anwesenheits- oder Finanzsynchronisierung gespeichert.
Eine inzwischen geänderte Protokollzuordnung erfordert erneutes Öffnen.

Der Editor füllt den Viewport ohne äußeren Seitenscroll. Kopfzeile und separate
Formatierungsleiste bleiben sichtbar; Dokument und rechte Werkzeugliste scrollen
unabhängig. Mobil wird die Werkzeugliste über dem Dokument eingeblendet. Die
Gliederung navigiert zu Überschriften, markiert den aktuellen Abschnitt und schreibt
kein Inhaltsverzeichnis in den Quelltext. Protokolle mit Board erhalten zusätzlich
kompakte Finanzanträge mit Suche, Filtern, TOP-Eingabe, Drag-and-drop und Sprung zum TOP.
„Sitzungsdaten“ enthält die seltener benötigten Protokolleingaben.
Der Kopfbereich ist kompakt; der Chevron rechts in der grauen Werkzeugleiste
blendet nur den Dateikopf mit Speichern, Neu laden, Exportieren und Sitzungsdaten aus
bzw. wieder ein. Ansichtsauswahl, Suchen und die abgetrennten Formatierungswerkzeuge
(einschließlich „Tabellen“ ohne Zusatzsymbol) bleiben in dieser Reihenfolge in der
grauen Leiste. „Tagesordnung aktualisieren“ folgt für Protokolle nach den Werkzeugen.
Seitenleisten-Schalter und Chevron liegen außerhalb des horizontal scrollenden
Bereichs und bleiben auch mobil erreichbar. Suchfeld und Fehlerhinweise bleiben
bei Bedarf unter der Leiste sichtbar; Strg/Cmd+S und Strg/Cmd+F funktionieren auch eingeklappt.

Die Formatierungsleiste nutzt reine Texttransformationen in `markdown-formatting.ts`:
H1/H2/H3, Aufzählungen, nummerierte Listen, Fett, Kursiv, Unterstreichen (`<u>`),
Zitat, Inline-Code und Tabellenraster. Tabellen bleiben im gewählten Modus mit
markierter erster Kopfzelle. Live- und Quelltextmodus unterstützen Rückgängig/
Wiederholen; Strg/Cmd+B/I/U formatiert, Strg/Cmd+S speichert. Vorschau bleibt
schreibgeschützt. Die Bedienung benötigt keine neue Produktionsabhängigkeit.

„Suchen“ bzw. Strg/Cmd+F öffnet die feste In-Dokument-Suchleiste (`DocumentSearch`).
Die Suche ist wörtlich und ignoriert Groß-/Kleinschreibung; Enter/Umschalt+Enter
und die Pfeilbuttons navigieren zyklisch durch Treffer, Escape schließt die Suche.
Live/Vorschau durchsuchen nur sichtbare Textblöcke (auch über Inline-Formatierungen
hinweg und innerhalb von Tabellenzellen), der Quelltextmodus die gesamte Markdown-Datei.
CSS Custom Highlights markieren Treffer ohne DOM-/Quelltextänderung. Die statischen
`::highlight`-Regeln werden erst beim Öffnen der Suche als Style-Element
registriert, da der CSS-Parser von Next 15/Turbopack diese Selektoren zurückweist.
Beim Schließen werden Regeln und Highlight-Registrierungen entfernt. Für Browser
ohne diese API und im Textfeld wird der aktive Treffer als positionsgetreues Overlay
markiert. Such-/Scrollzustand verändert keine gespeicherten Inhalte.

Protokollvorlagen liegen als verwaltete Vorlagen in PostgreSQL; erlaubt sind
`{{session.date}}`, `{{session.date_de}}`, `{{session.folder_name}}`,
`{{protocol_area.name}}` und `{{created_at}}`. Unbekannte Variablen werden beim
Speichern und Erzeugen abgewiesen. Ordner-/Dateimuster erlauben eine begrenzte
Platzhaltermenge und verbieten leere, versteckte oder pfadübergreifende Namen.
Alternativ wählt ein Bereich „Eigene“: `protocol_areas.template_id = NULL`
aktiviert `custom_template_markdown`, ohne eine globale Vorlage anzulegen.
Der Entwurf bleibt beim Wechsel auf eine Systemvorlage erhalten. Beide Wege
werden beim Erstellen einer Sitzung und beim nachträglichen Anlegen ihres
Protokolls über `protocolTemplateSource` aufgelöst. Änderungen wirken nur auf
neu erzeugte Dateien; eine leere eigene Vorlage ist zulässig.
`MarkdownSettingsEditor` verwendet denselben Live-Renderer und dieselben
Formatierungswerkzeuge wie der Dokumenteditor (einschließlich Quelltext,
Vorschau, Tabellen und Undo/Redo), aber ohne Dateiablage oder Sitzungswerkzeuge.
Die eigene Vorlage ist in den Einstellungen einklappbar und beim erneuten
Öffnen zunächst eingeklappt. Gespeichert wird mit dem Bereichsformular.
Der Editor startet in „Live Vorschau“: `MarkdownLiveEditor` bearbeitet formatierte
Blöcke direkt per `contentEditable`, auch während des Tippens. Überschriften,
Listen und Inline-Formatierung bleiben sichtbar; Tabellen haben einzeln editierbare
Zellen mit Tab/Shift+Tab-Navigation. „Vorschau“ nutzt denselben Blockbaum und dieselben
Layoutklassen im `readOnly`-Modus (ohne editierbare Felder, mit anklickbaren Links).
Dadurch bleiben Zeilenhöhen, Abstände, Umbrüche und Tabellengeometrie beim
Moduswechsel identisch; der Browsertest vergleicht Geometrie und Screenshots.
Jede Änderung wird auf den zugehörigen
Markdown-Quellbereich zurückgeführt; YAML und unsichtbare Verwaltungsmarker bleiben
erhalten. `markdown-rich-editor.ts` liefert Struktur-/Zellenbereiche und ausschließlich
selbst erzeugtes, escaptes Inline-HTML. Browser-veränderte DOM-Kinder werden nicht
durch React reconciliert; die Auswahl wird über Quelltextpositionen wiederhergestellt.
Eingefügter Text wird ausschließlich als Klartext übernommen, Pipes in Zellen werden
escaped. Klick, Pfeiltasten, Zeilenumbrüche, mehrzeiliges Einfügen und Undo/Redo
werden unterstützt. Codeblöcke bleiben im Live-Modus als Quelltext editierbar.
„Bearbeiten“ bietet weiterhin das vollständige Markdown-Textfeld, „Vorschau“
bleibt schreibgeschützt. Im Live-Modus werden verwaltete Anwesenheit und
Tagesordnung beim Verlassen des Editors abgeglichen, damit während des Tippens
keine automatisch eingefügten Zeilen die Cursorposition verschieben.
Finanzanträge lassen sich auch dort per Button oder sichtbarer Drag-and-drop-
Einfügemarke platzieren. Es werden keine zusätzlichen Editor-Abhängigkeiten verwendet.

Der Editor lädt und speichert direkt per WebDAV, warnt vor ungespeicherten
Änderungen und verwaltet unter `## Tagesordnung` eine markierte Liste ausschließlich
der Überschriften, die mit `TOP` beginnen. „Tagesordnung aktualisieren“ nutzt einen
vorhandenen Abschnitt oder legt ihn einmalig an. Bestehende Tagesordnungslisten
werden übernommen, eigene Notizen bleiben erhalten; alte verwaltete
Inhaltsverzeichnisse werden umgestellt. Nach dem ersten Einfügen wird die Liste
bei Textänderungen automatisch aktualisiert. Tagesordnung und Vorschau verwenden
dieselbe Erkennung und deduplizierte Markdown-Anker; Codeblöcke sind ausgeschlossen.
Markdown-Dateien sind für die In-App-Bearbeitung auf 2 MB
begrenzt; größere Dateien bleiben über Nextcloud zugänglich.

Ein Protokollbereich kann optional genau ein normales Board und eine zugehörige
Quellspalte referenzieren. Der konfigurierende Nutzer muss auf dieses Board
zugreifen dürfen; Leih-System-Boards sind ausgeschlossen. Vorschläge verändern
weder Status noch Position der Karten. Nach Eingabe der TOP-Nummer können sie
per Button oder Drag-and-drop in den Markdown-Editor eingefügt werden. Beim
Ziehen zeigt eine sichtbare Einfügemarke die tatsächliche Textposition unter
der Maus (einschließlich Umbrüchen und Scrollposition); Ablegen ersetzt keine
vorherige Textauswahl. In der Vorschau ist auch das Einfügen deaktiviert.
Beim Einfügen entsteht ein zentral
formatierter Markdown-Block. Seine stabile Karten-ID steht nicht nur in
HTML-Kommentaren, sondern zusätzlich im normalen HTTPS-Link zur Kartenseite;
dadurch kann Gremio die Relation auch dann erkennen, wenn ein Editor Kommentare
entfernt. Die Markerhaltung muss bei einem konkret eingesetzten
Nextcloud-Text-Release vor Produktivfreigabe nochmals interoperabilitätsgeprüft
werden.

Die Bereichseinstellungen enthalten bei verknüpftem Board eine sortierbare
Kartenfeldauswahl (`finance_fields`: JSONB mit Schlüssel und Aktivierung).
Alle Felder starten ausgeschaltet, auch bei bestehenden Bereichen. Verfügbar
sind die sichtbaren `board_card_fields` sowie die immer sichtbaren Zeitstempel;
Titel wird bereits in der TOP-Überschrift verwendet. Auswahl und Reihenfolge
werden pro Bereich gespeichert, nicht am Board. Veraltete/ausgeblendete Felder
werden beim Speichern und Laden der Vorschläge herausgefiltert; neue Felder
starten ausgeschaltet. TOP-Überschrift und der stabile Kartenlink bleiben
unabhängig davon bestehen. Anhangsfelder übernehmen nur Dateinamen, keine
Dateien, Serverpfade oder öffentlichen Zugriffstoken. Relationen (Zugewiesene,
Ersteller, Konto, Priorität) werden als Namen aufgelöst; Abfragen erfolgen erst
nach Board-Zugriffsprüfung. Status und Kartenposition bleiben unverändert.

`decision_template_enabled` und `decision_template_markdown` speichern eine
optionale Beschlussvorlage pro Bereich. Der Mini-Markdown-Editor ist nur bei
Aktivierung sichtbar; Deaktivieren erhält den Text. Beim Einplanen per Button
oder Drag-and-drop wird der Text hinter die ausgewählten Angaben und den
Kartenlink vor den Endmarker gesetzt: ohne Trimmen oder Variablenersetzung,
ohne zusätzliche Leerzeile davor, mit einer Trennzeile zum Endmarker danach.
Leer/deaktiviert fügt nichts hinzu. Bestehende
TOP-Blöcke werden bei Einstellungsänderungen nicht umgeschrieben. Markdown-
Eingaben sind serverseitig auf 200.000 Zeichen (eigene Protokollvorlage) bzw.
50.000 Zeichen (Beschlussvorlage) begrenzt. Migration: `0061_protocol_area_templates`.

`protocol_card_links` bildet Sitzung↔Karte als n:m-Beziehung ab und speichert TOP,
den zuletzt automatisch erzeugten Referenzwert und einen Konfliktstatus. Eine
Beschlussreferenz wird beim neuen oder erneuten Einplanen sowie bei geänderter
TOP-Nummer oder geändertem Referenzmuster immer automatisch gesetzt, auch über
einen manuellen Wert hinweg. Spätere manuelle Änderungen bleiben bei unverändertem
TOP erhalten. Der Editor merkt erneutes Einplanen bis zum erfolgreichen Speichern,
auch bei Entfernen und Wiedereinfügen desselben TOPs ohne Zwischenspeichern.
Da die Karte derzeit nur ein einzelnes Feld `decision_ref` besitzt, gilt bei
mehreren Sitzungsverknüpfungen: Der zuletzt erfolgreich gespeicherte verwaltete
TOP-Block liefert den aktiven automatischen Wert; beim Entfernen fällt Gremio
auf die zuletzt aktualisierte verbleibende Verknüpfung zurück.
Entfernt ein gespeichertes Protokoll den verwalteten Kartenblock, verschwindet
die Relation und damit die Anzeige „Behandelt in Sitzung“ auf der Karte.

WebDAV und PostgreSQL bieten keine gemeinsame Transaktion. Gremio schreibt daher
zuerst überschreibend nach Nextcloud und gleicht danach die idempotent aus den
Markdown-Markern rekonstruierbaren Relationen ab. Scheitert die Nachbearbeitung,
meldet die Oberfläche ausdrücklich „Datei gespeichert, Relation inkonsistent“;
erneutes Speichern wiederholt den Abgleich. Automatische Statuswechsel,
Webhooks, öffentliche Protokolle,
Volltextindexierung und Lösch-/Aufräumautomationen gehören nicht zu dieser
Ausbaustufe.

### Sitzungsinformationen, Logos und PDF-Export

Der Reiter „Sitzungsinformationen“ bearbeitet ausschließlich den YAML-Kopf der
Markdown-Datei, keine separaten Sitzungsfelder in der Datenbank. Unterstützt
werden `sitzungsdatum`, `beginn`, `ende`, `sitzungsort`,
`sitzungsleitung`, `protokollfuehrung` und `unterschriften`, einschließlich
der Alias-Schreibweisen aus dem ursprünglichen Konverter. „Übernehmen“ schreibt
in den Editor; erst „In Nextcloud speichern“ persistiert die Datei. Unbestätigte
Formulareingaben blockieren Speichern/Export, unbekannte YAML-Felder und
Kommentare bleiben erhalten. Fehlerhaftes YAML wird nicht still ersetzt.
Tagesordnung/Anwesenheit ändern den YAML-Kopf nicht; die Vorschau blendet ihn aus.
PDF-Titel und -Autor sind keine eigenen YAML-Optionen: Der Export verwendet die
erste gerenderte H1-Überschrift als Titel (ersatzweise den Markdown-Dateinamen
ohne Endung) und die Protokollführung als Autor (ohne Angabe leer). Alte YAML-Felder
`title` und `author` werden beim Export ignoriert; vorhandene Dateien bleiben erhalten.

`protocol_logos` (Migration 0060) enthält bereichsbezogene Logos als normalisierte
PNG-Bytes (Base64 in PostgreSQL), Namen und Standardmarkierung. Verwaltung nur
durch Bereichseigentümer/Admin, Abruf und Export nur mit Bereichszugriff.
Bereichssperre und partieller Unique-Index garantieren höchstens ein Standardlogo.
Das erste hochgeladene Logo wird Standard; beim Löschen des Standards rückt das
erste verbliebene nach. Kein Anzahl-Limit, je Upload maximal 5 MB / 16 Megapixel.
Es werden keine Logos aus anderen Bereichen oder private Serverpfade akzeptiert.

„Protokoll exportieren“ öffnet Dateiname und Logoauswahl mit vorausgewähltem
Standardlogo. Der Vorschlag ersetzt `.md` durch `.pdf`. Der Server liest die
gespeicherte Markdown-Datei erneut aus Nextcloud und übergibt sie unverändert an
den Renderer. Die YAML-Metadaten werden im Renderer aus dieser Datei gelesen.
Logos stammen ausschließlich aus den Bereichseinstellungen: verwendet wird das
beim Export ausgewählte Logo, ersatzweise das Standardlogo. YAML-`logo` und eine
Datei namens `logo.png` im Sitzungsordner werden nicht als Logo berücksichtigt.
Ohne hinterlegte Bereichslogos wird ohne Logo exportiert.
Die optionalen Unterschriftenblöcke enthalten Linien, Rollen und Namen, aber keine
Datumsbeschriftungen oder Datumsformularfelder.
Das PDF wird ausschließlich in denselben Sitzungsordner geschrieben, mit
atomarem `If-None-Match: *`: vorhandene Dateien werden nicht überschrieben.
Die Dateiliste wird nach Erfolg aktualisiert und verwendet den bestehenden
PDF-Viewer/-Editor. Ein Export speichert keine unbestätigten Editoränderungen.

`scripts/protocol-pdf/original.py` bewahrt den gelieferten Python-Konverter
unverändert. Der gehärtete Adapter verwendet dessen CSS, Kopfzeile,
Unterschriften und WeasyPrint mit gebündelten IBM-Plex-Schriften. Externe
Ressourcen und beliebige Serverdateien sind gesperrt, Body-HTML/CSS ist
eingeschränkt. Normale lokale Rasterbilder sind erlaubt (maximal 30 / 20 MB).
Node- und Worker-Limits schützen Laufzeit und Speicher. Rendering/Cloud-Zugriffe
finden außerhalb von Datenbanktransaktionen statt.

Docker installiert Python/Pango und die gepinnten WeasyPrint-Abhängigkeiten;
lokale Einrichtung und Sicherheitsgrenzen stehen in
`scripts/protocol-pdf/README.md`. `PROTOCOL_PDF_PYTHON` wählt den Interpreter.
Die Logo-Daten gehören zum PostgreSQL-Backup, die PDFs weiterhin zu Nextcloud.

```sql
protocol_templates   (id, name UNIQUE, description, markdown, created_at)
protocol_areas       (id, name, description, owner_id, nc_url, nc_username,
                      nc_password_enc, root_path, folder_pattern, file_pattern,
                      template_id, board_id NULL, source_status_id NULL,
                      decision_ref_pattern, created_at)
protocol_area_access (id, area_id, user_id NULL, group_id NULL,
                      CHECK genau ein Freigabesubjekt, UNIQUE je Subjekt)
protocol_sessions    (id, area_id, folder_name, session_date NULL,
                      folder_file_id NULL, folder_etag NULL, protocol_path NULL,
                      protocol_file_id NULL, protocol_etag NULL,
                      protocol_last_modified NULL, last_synced_at, created_at,
                      UNIQUE(area_id, folder_name))
protocol_card_links  (id, session_id, card_id, top, last_auto_decision_ref NULL,
                      decision_ref_conflict, created_at, updated_at,
                      UNIQUE(session_id, card_id))
```

---

## Umfragen & Feedback

Öffentliches Feedback unter `/feedback` — fachlich wie das Antragsformular, nur ohne Dateien. Statt **Standorten** gibt es **Feedback-Bereiche** (`feedback_areas`), die der Admin unter `/admin/umfragen` („Umfragen & Feedback-Routing") verwaltet: anlegen, umbenennen, löschen, Ziel-Board + Ziel-Spalte setzen, aktivieren/deaktivieren. Es gelten dieselben Regeln wie bei Standorten — nur aktivierte und **vollständig geroutete** Bereiche erscheinen öffentlich, die Zielspalte muss zum Ziel-Board gehören, **Leih-System-Boards scheiden als Ziel aus**, und Board/Spalte sind gegen Löschen geschützt (`ON DELETE RESTRICT` + verständliche Meldung).

Eine Einreichung erzeugt eine **normale Kanban-Karte**:
- `cards.applicant` = Name des Einreichers — **optional**; ohne Angabe wird `Anonym` gespeichert (`normalizeSubmitterName`, gilt für Formular und API). `cards.notes` = **vollständiger** Feedbacktext
- `cards.title` = automatisch aus dem Text abgeleitet (auf 120 Zeichen gekürzt, mit `…`)
- `cards.location_id` = NULL (Feedback läuft nicht über das Standort-Routing)
- Status-Token, Aktivitätseintrag und Kartennummer wie bei Anträgen

Dazu entsteht in **derselben Transaktion** ein unveränderlicher Snapshot in `feedback_submissions`. Er hat zwei Aufgaben: Feedback-Karten zuverlässig von Antragskarten unterscheiden (auch nachdem der Bereich gelöscht wurde) und die **Originaleinreichung** festhalten. Die öffentliche Statusseite und das PDF zeigen deshalb den Snapshot — bearbeitet das Gremium intern `applicant`/`notes`, ändert das die öffentliche Ansicht nicht.

**Getrennte Statusrouten:** `/status/{token}` und `/feedback/status/{token}` weisen den jeweils fremden Token-Typ mit **404** ab (inklusive der PDF-Routen). Intern zeigt die Kartendetailansicht „Herkunft: Feedback" samt Bereichsnamen und beschriftet `applicant` als **„Einreicher"** statt „Antragsteller" (nur die Anzeige — Spalte und API-Feld heißen weiter `applicant`).

Die Fachlogik liegt in `lib/public-feedback-submission.ts` und wird von **beiden** Wegen genutzt: der Server-Action des Formulars und dem API-Handler `POST /api/public/v1/feedback`. Das Formular hat zusätzlich Honeypot, signierte Zeitfalle und einen eigenen Rate-Limit-Scope (`feedback-submit`, 100/min — `FEEDBACK_FORM_RATE_LIMIT`); die API stattdessen verpflichtende Idempotenz (Scope `public-feedback`) und eigene Limits.

```sql
feedback_areas       (id, name UNIQUE, enabled DEFAULT false, position,
                      target_board_id  FK→boards         NULL ON DELETE RESTRICT,
                      target_status_id FK→board_statuses NULL ON DELETE RESTRICT,
                      created_at)

feedback_submissions (id, card_id UNIQUE FK→cards ON DELETE CASCADE,
                      area_id FK→feedback_areas NULL ON DELETE SET NULL,
                      area_name, submitter_name, feedback_text, created_at)
-- area_name/submitter_name/feedback_text = Snapshot der Einreichung; bleibt auch
-- nach Umbenennen oder Löschen des Bereichs erhalten.
```

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
- **Binäres Board-Zugriffsmodell:** Jedes Board-Mitglied darf Karten/Anhänge bearbeiten **und löschen** (kein separates Lese-/Lösch-Recht). Seit v2.7.9 dürfen auch Antragsnummer, Anweisungsdatum und Überweisungsdatum von jedem Mitglied geändert werden, sofern am Board aktiviert (UI **und** REST-API). Board-Einstellungen bleiben Eigentümer/Admin vorbehalten. Beim Archiv-Status gilt: **manuelles Archivieren kann niemand** (nur der Done-Sweep archiviert), **Wiederherstellen darf jedes Board-Mitglied** — in Web und API identisch.
- **REST-API ⊆ Web-App (nie mehr Rechte):** Board-Zugriff via `canAccessBoard`, Token-`scope` (read/write) und Board-Beschränkung schränken nur **ein**. Deaktivierte Board-Felder (`board_card_fields`) werden über die API **weder gelesen noch geschrieben** — exakt wie die Web-Oberfläche sie ausblendet.
- **REST-Vertragsabgleich:** Umfang bleibt Boards/Karten sowie öffentliche Anträge/Feedback. `POST` kann Haushaltspositionen atomar anlegen, `PATCH` ersetzt sie mit `budgetRevision`; `lib/api-card-response.ts` liest Summen/Revision/Positionen im selben Snapshot. Reine Zuständigen-PATCHes einschließlich `[]` werden gespeichert. Trigger-Metadaten für Quittungen/Überweisungen sind für Board-Verwalter vollständig; Listen liefern Summen, Details die Positionen. Siehe `docs/API_PARITY_AUDIT.md` für Abdeckung und bewusst nicht externe Web-Funktionen.
- **Öffentliche allgemeine Uploads sind append-only**, unabhängig vom Quittungs-Gate (bis 30 PDFs je Karte) — gewollt; Archiv-Trigger sperren sie, gegen Missbrauch zusätzlich ratenbegrenzt.
- **Öffentliches Inventar ist eine Whitelist, keine Blacklist:** `PUBLIC_INVENTORY_FIELD_KEYS` listet auf, was *nach außen darf* (Bezeichnung, Kategorie, Verfügbarkeit) — neue Item-Felder sind damit automatisch **nicht** öffentlich. Standort, Preis, Seriennummer, Belege und „aktuell bei" bleiben intern; öffentlich erscheint nur die Ausleihfrist ohne Person.
- **Leih-System-Boards sind serverseitig gegen Verwaltung gesperrt:** `requireBoardManage` weist Boards mit `inventory_board_id` mit 404 ab — sonst ließen sich Done-Spalte/Archiv-Trigger/Nextcloud darauf aktivieren und würden laufende Leihkarten wegräumen. Ihre Zugriffs- und Mitgliederliste spiegelt bewusst das Inventar statt eigener Freigaben (eine Freigabequelle, kein Auseinanderlaufen).
- **Drei öffentliche Status-Wege, drei getrennte Tokens:** Antrag → `/status/{cards.token}`, Feedback → `/feedback/status/{cards.token}` (getrennt über den `feedback_submissions`-Snapshot), Ausleihe → `/inventar/status/{inventory_loans.token}` — ein **eigener** Token an der Vorgangszeile. Die Tracking-Karte eines Leihvorgangs hat zwangsläufig auch ein `cards.token` (die Spalte ist NOT NULL UNIQUE), das aber **kein** Status-Link ist: Alle Antrags-Einstiege (`/status/{token}`, dessen PDF, Anhang-Route, SSE-Stream und die öffentlichen Server Actions) weisen es mit 404 ab, und die interne Kartenansicht zeigt dafür keinen Link mehr. Sonst gäbe es zu einem Leihvorgang eine zweite, ungewollte öffentliche Seite samt PDF-Upload. Die Sperre sitzt in `lib/public-status.ts` (`resolveApplicationCardId` / `getApplicationStatusByToken` / `isPublicCardStreamToken`) — der Feedback-Weg und der Ausleih-Weg bleiben unberührt.
- **Leihvorgänge sind kartengeführt:** Die Kartenspalte ist die *einzige* Quelle des Vorgangsstatus (auch rückwärts). Wer das Leihboard sehen darf, kann damit den Ausleihstatus ändern — bewusst, weil das Gremium ohnehin im Kanban arbeitet und zwei getrennte Statusquellen auseinanderliefen. **Ausnahme sind die Endzustände `rejected`/`withdrawn`:** Sie erreicht `syncLoanFromCard` nicht mehr, ihre Tracking-Karte bleibt aber liegen — solche Vorgänge belegen deshalb nie Bestand, egal in welcher Spalte ihre Karte landet.
- **Proxy-Header werden vertraut:** Hinter **genau einem** vertrauenswürdigen nginx werden `X-Forwarded-*`/`X-Real-IP` direkt genutzt (Schema/Host/Client-IP). `AUTH_TRUST_HOST` ist bei der eigenen iron-session-Auth ein No-op.
- **SSO-Vertrauensannahme (JIT):** `preferred_username` muss vom SSO autoritativ/unveränderlich vergeben werden (das muss der eingesetzte OIDC-Provider garantieren); darauf basieren Konto-Adoption und die `ADMIN_USER`-Beförderung.
- **Rate-Limiting ist in-memory** (ein Container = eine Instanz). Bei horizontaler Skalierung → geteilter Speicher (Redis) nötig. Der Speicher ist **nach Scope-Familie getrennt** (`lib/rate-limit.ts`): Jede Familie hat einen eigenen Deckel, und läuft einer voll, werden die **ältesten Zähler verdrängt** statt neue Schlüssel abzuweisen. Ein gefluteter öffentlicher Scope kann damit die Anmeldung nicht mehr aussperren — im Ausnahmefall wirkt das Limit dort kurzzeitig schwächer, was der bessere Ausfallmodus ist.
- **DB-Verbindung ohne TLS** ist im privaten Docker-Netz ok; bei **externem** Postgres `ssl` aktivieren.
- **CSP** setzt nur `frame-ancestors 'none'` (+ `X-Frame-Options`, `nosniff`); **HSTS** terminiert nginx. Eine strikte `script-src`-CSP (Nonces) ist bewusst zurückgestellt.
- **Upload-Validierung** prüft MIME/Endung (keine Magic-Bytes); ausgeliefert wird mit erzwungenem Content-Type + `nosniff` → kein Stored-XSS, Restrisiko nur „Müll-PDFs".
- **Dependencies (Audit 04.09.2026):** `npm audit` ist inklusive Entwicklungsbaum ohne Befund. `@esbuild-kit/core-utils` verwendet über einen gezielten Override esbuild ^0.25.12; kein Drizzle-Downgrade. Auch `pip-audit` meldet für die gepinnten PDF-Renderer-Abhängigkeiten keine bekannten Schwachstellen. Der Stand ist zeitgebunden; Details und Grenzen stehen in `docs/SECURITY_AUDIT_SINCE_2.7.0.md`.
- **Eingangsbereinigung freier Texte** (`lib/text.ts`): `sanitizeSingleLine` für Titel/Namen, `sanitizeMultiLine` für Freitext. Entfernt NUL (das PostgreSQL ablehnt) und C0-Steuerzeichen (an denen der WinAnsi-Encoder der PDF-Bestätigung wirft) an der **Eingangsgrenze** — Formular, REST-API und öffentliche API laufen alle darüber. `winAnsiSafe` in `lib/pdf.ts` bleibt als zweite Verteidigungslinie.
- **Öffentliche Zeitfalle ist an den Client gebunden** (`lib/antispam.ts`): Das signierte Token deckt Zeitstempel **und** eine pseudonyme Client-Kennung ab und gilt **6 Stunden**. Abgelaufen/fremd ist KEIN stiller Verwurf mehr, sondern eine sichtbare Meldung samt frischem Token — die stille Fake-Bestätigung bleibt Honeypot und „zu schnell ausgefüllt" vorbehalten (dort soll der Bot nicht lernen, woran er scheitert).
- **Idempotenz-Schlüssel der öffentlichen API verfallen nach 30 Tagen** (`IDEMPOTENCY_TTL_DAYS`, Tages-Sweeper aus `runStartupBootstrap`). Ein Retry NACH Ablauf legt eine zweite Einreichung an — so in `docs/PUBLIC_API.md` und in der OpenAPI-Beschreibung zugesichert.
- **Idempotenz-Schlüssel sind an den Client gebunden** (`api_idempotency_keys.client_hash`, HMAC der Client-IP wie beim Rate-Limit — nie die IP selbst). Ein Replay liefert den geheimen Status-Link zurück; ohne diese Bindung genügte ein erratener Schlüssel samt identischer Daten, um an einen fremden Vorgang zu kommen (beim Feedback besteht der Fingerprint nur aus Bereich, Name und Text). Abweichende Kennung → 409 mit **derselben** Meldung wie bei abweichenden Daten (die Antwort soll nicht verraten, ob ein Schlüssel schon vergeben ist). Bewusster Trade-off: Ein Client, der zwischen Absenden und Retry das Netz wechselt, bekommt 409 statt eines Replays und muss einen neuen Schlüssel erzeugen — besser als eine stille Dublette. Hinter gemeinsamem NAT wirkt die Bindung nicht; sie ersetzt kein zufälliges UUID-v4-Schlüsselmaterial. Altbestand ohne `client_hash` bleibt replay-fähig und verfällt über die TTL.
- **Body-Grenzen der öffentlichen API greifen beim Lesen** (`readLimitedBody`), nicht über `Content-Length`: Der Header fehlt bei `Transfer-Encoding: chunked` und oft bei HTTP/2.
- **Signatur-Zertifikate liegen verschlüsselt am Nutzer:** `.p12` (Privatschlüssel) **und** Passphrase werden AES-256-GCM-verschlüsselt (ENCRYPTION_KEY) in `users` gespeichert, damit „einmal hinzufügen" genügt. Trade-off: Wer DB **und** `ENCRYPTION_KEY` hat, kann als der Nutzer signieren — bewusst gewählt für die Bequemlichkeit (Alternative wäre Passphrase je Signatur). Signiert wird nur serverseitig.

---

## PDF-Viewer, -Editor & digitale Signatur

Anhänge werden **in-app** in einem Modal geöffnet (kein Browser-Tab). Der Viewer ist zugleich Editor:
- **Anzeigen:** `react-pdf` (pdf.js) rendert PDF-Seiten; Bilder (Studierendenausweis) werden als `<img>` gezeigt. Auf der **öffentlichen Statusseite** ist der Viewer **read-only**.
- **Bearbeiten (intern, Board-Mitglieder):** Freitext per Klick platzieren und vorhandene **AcroForm-Formularfelder** über ein Seitenpanel ausfüllen. Beim Speichern werden die Änderungen serverseitig mit `pdf-lib` ins PDF geschrieben (`lib/pdf-edit.ts`).
- **Alte Formularstruktur:** `lib/pdf-widget-compat.ts` ordnet getrennte Kopien in
  `AcroForm/Fields` und Seiten-`Annots` anhand vollständigem Feldnamen, Feldtyp,
  Wert, Rechteck und Optionszustand zu. Mehrfachplatzierungen werden zusätzlich
  über Seitenreferenz/Appearance unterschieden. Native Verknüpfungen haben Vorrang;
  widersprüchliche oder mehrdeutige Zuordnungen bleiben im Seitenpanel. Das Öffnen
  schreibt keine PDF-Bytes um (auch keine vorhandenen Signaturen). Erst beim
  ausdrücklichen Bearbeiten werden Werte und Appearances eindeutig zugeordneter
  Seitenkopien synchronisiert. Alte Radiogruppen ohne Radio-Flag werden an ihren
  unterschiedlichen Widget-On-Zuständen erkannt; wiederholte Checkboxen bleiben Checkboxen.
- **Signieren:** sichtbare Signatur-Box platzieren → serverseitige **PAdES-Signatur** mit dem persönlichen `.p12` des Nutzers (`lib/sign.ts`, `@signpdf`). Verlangt ein in den Konto-Einstellungen hinterlegtes Zertifikat (`lib/cert.ts`, `inspectP12`).
- **Speichern:** „neue Datei" (zusätzlicher `other`-Anhang, Original bleibt) **oder** „Original ersetzen" — Server-Action `savePdfEditsAction` (`app/intern/card/[id]/pdf-actions.ts`), Board-Zugriff erforderlich, Aktivitätseintrag.
- **Feld-Metadaten:** `GET /api/attachment/{id}/fields` liefert die ausfüllbaren Felder fürs Seitenpanel.
- **Zertifikatsverwaltung:** `/intern/konto` → Abschnitt „Signatur-Zertifikat" (`.p12` + Passwort hochladen/ersetzen/entfernen; Inhaber/Gültigkeit werden angezeigt). Spalten an `users`: `cert_p12_enc`, `cert_pass_enc`, `cert_subject`, `cert_not_after`, `cert_uploaded_at`.

> Hinweis: pdf.js (v5) benötigt `Promise.withResolvers` (moderne Browser ≥ 2024). Der pdf.js-Worker wird als statisches Asset ausgeliefert (kein CDN).

---

## Ergänzungen aus dem Audit seit 2.7.0

Ausgeblendete Kartenfelder werden vor der Übergabe von Client-Props entfernt,
auch in Karteneditor, Kanban-Suchtext, Aufgabenübersicht und den Basisdaten der
Protokollvorschläge. Die Feldsichtbarkeit gilt damit ebenfalls für Werte, die
nicht als sichtbares Formularelement gerendert würden; gespeicherte Werte bleiben erhalten.

Die Finanzverknüpfungs-Bereinigung prüft vor einem Cloud-Schreibzugriff auch die
Berechtigung auf bisher verknüpfte Boards, wenn die Bereichskonfiguration inzwischen
geändert wurde. Entfernte Board-Verknüpfungen hinterlassen keine veralteten
automatischen Beschlussreferenzen. Relationensynchronisation und Löschbereinigung
sperren Sitzung und betroffene Karten in stabiler Reihenfolge, bevor sie Referenzen
lesen/ändern; widersprüchliche automatische Referenzen werden nicht als Rückfallwert
verwendet. Das ausdrücklich überschreibende Speichern des Markdown-Inhalts in
Nextcloud bleibt bestehen.

## Hinweise

### Dokumentation im Repo
- **`AGENTS.md`** — Arbeitsregeln und Einstieg für Coding-Agenten; verweist auf die kanonischen Fach-/API-Dokumente.
- **`CLAUDE.md`** (diese Datei) — Fachkonzept, Datenmodell, bewusste Entscheidungen. Bei fachlichen Änderungen **mitpflegen**.
- **`README.md`** — Betrieb: Setup, `.env`, Deployment, Backups. Aktuell.
- **`docs/API.md`** — REST-API `/api/v1` (Tokens, Scopes, Endpunkte).
- **`docs/PUBLIC_API.md`** — öffentliche API `/api/public/v1` (ohne Anmeldung, Idempotenz, Limits).
- **`docs/API_PARITY_AUDIT.md`** — Abgleich seit v2.7.7 einschließlich noch nicht veröffentlichter Änderungen, Regressionen und Abgrenzung der REST-API.
- **`lib/db/schema.ts`** — die **maßgebliche** Schemaquelle (Drizzle). Die SQL-Blöcke hier sind konzeptionelle Beschreibung; im Zweifel gilt das Schema.
- **`tests/`** — Regressionstests, ausgeführt mit `npm test` (Node-Test-Runner über `tsx`, **keine** zusätzliche Test-Abhängigkeit). DB-Tests nur gegen eine isolierte, migrierte Testdatenbank ausführen; neuere Suiten schlagen ohne DB bewusst fehl, ältere überspringen sich teilweise. Migrationstest benötigt zusätzlich eine explizite leere Upgrade-Testdatenbank. `api-parity.test.ts` prüft echte Route Handler und Rechte, `api-contract.test.ts` sichert Schemas, Beispiele, Routeninventar und generierte YAML-Dateien ab.
- ⚠️ **`IMPLEMENTATION_PLAN.md` ist historisch** (Bauplan der Erstumsetzung) und in Teilen überholt — er nennt noch SQLite, die Tabelle `antraege`, `/intern/antrag/{id}` und lokale Passwörter. **Nicht als Referenz verwenden.**

### Sonstiges
- Credentials nicht in den Code committen → `.env`-Datei verwenden
- Board-eigene Nextcloud-Zugangsdaten werden **verschlüsselt** in der DB gespeichert (AES-256-GCM, Schlüssel aus `.env`), nie im Klartext
- Signatur-Zertifikate (`.p12` + Passphrase) werden ebenfalls **verschlüsselt** gespeichert (gleicher `ENCRYPTION_KEY`)
- DSGVO: Token nur lokal anzeigen
- Antragsteller-E-Mail wird nicht erfasst
