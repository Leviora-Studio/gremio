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
4. **Vorlagen** (`/vorlagen`) — Board- und Finanzvorlagen
5. **Sitzungen** (`/intern/sitzungen`) — eigenständige Sitzungsplanung, Themenspeicher und Tagesordnung

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
2. **Board-Eigentümer** — `owner_id` und zusätzliche Einträge in `board_owners`, `finance_board_owners` bzw. `inventory_board_owners` bilden gleichberechtigte Eigentümer. Wer ein Board erstellt, bleibt zunächst dessen einziger Eigentümer. Alle Eigentümer dürfen es vollständig verwalten; Admins dürfen unabhängig davon jedes Board verwalten.
3. **Board-Freigabe** (`board_access`) — Eigentümer/Admin geben ein Board **an einen Nutzer oder eine Gruppe** mit **Lesend** (`read`) oder **Lesend und schreibend** (`write`) frei. Direkte und Gruppenfreigaben werden kombiniert; jede passende Schreibfreigabe hat Vorrang. Das *Verwalten* des Boards bleibt Eigentümer/Admin vorbehalten.

> **Gruppen erstellen/verwalten darf nur der Admin.** User können vorhandene Gruppen nur zu ihren eigenen Boards einladen, aber keine Gruppen anlegen/ändern.

### Entscheidungen
- **Login ausschließlich über SSO/OIDC.** Konten entstehen per **JIT-Provisioning** beim ersten Login; die App legt selbst keine Konten an und kennt keine Passwörter.
- **Login-Kennung:** `preferred_username` aus dem SSO (System-E-Mails über instanzweites SMTP). Verknüpfung zum SSO-Konto über `users.sub` (OIDC-Subject).
- **Benutzername unveränderlich:** kommt vom SSO, in dieser App von niemandem änderbar
- **Passwort/Anzeigename/E-Mail:** werden **zentral im SSO** gepflegt, nicht in Gremio. `/intern/konto` zeigt sie nur an und bietet „Profil neu abgleichen" (`resyncProfileAction`). Es gibt **keine** Passwort-Ändern- oder Passwort-Reset-Funktion.
- **Konten:** `/admin/users` vergibt Rollen und kann Konten lokal deaktivieren/reaktivieren. Die Sperre wird bei jeder Anfrage geprüft, ändert das SSO-Konto nicht, widerruft über `users.session_version` alle bisherigen Browsersitzungen. Reaktivierung erfordert eine neue Anmeldung. Selbstdeaktivierung und das Deaktivieren des letzten aktiven Admins werden verhindert. Eine endgültige Kontolöschung erfolgt weiterhin im SSO.
- **Profilbild:** optional je Nutzer (Upload/Ersetzen/Entfernen unter `/intern/konto`). Ohne Bild → generierter Avatar aus den **Initialen des Benutzernamens** (z.B. deterministische Farbe). Bild wird quadratisch zugeschnitten/verkleinert gespeichert.
- **Board-Stati:** pro Board konfigurierbar (siehe Workflow); Archiv-Trigger pro Board wählbar
- **Board-Zugriff:** Lesen oder Lesen und Schreiben; Verwalten bleibt Eigentümern/Admins vorbehalten
- Ein Nutzer kann in **mehreren Gruppen** sein (n:m)
- **Mehrere Eigentümer:** Eigentümer und Admins dürfen aktive Personen zusätzlich ernennen. Nur Admins dürfen andere Eigentümer entfernen; jede Person darf selbst austreten. Alle Änderungen verlangen serverseitig `ERNENNEN` bzw. `ENTZIEHEN`. Der letzte Eigentümer kann auch von Admins nicht entfernt werden.
- **Eigentümer deaktiviert:** Das Board bleibt bestehen. Es gibt keine automatische Ernennung eines Admins; ein Admin muss sich bei Bedarf ausdrücklich zum Eigentümer machen, bevor er den letzten anderen entfernt. `owner_id` bleibt als kompatibler Verweis auf genau einen tatsächlichen Eigentümer erhalten. Beim Austritt dieser Person wird unter Ressourcensperre ein verbleibender Eigentümer eingetragen. Zusätzliche Eigentümer erzeugen keine impliziten Quell-Board-Freigaben für Finanzboards.

### Datenmodell (PostgreSQL)

> Konzeptionelle Spezifikation. Umgesetzt wird das Schema in **Drizzle ORM** (TypeScript, pg-core); die folgende SQL-Notation beschreibt Tabellen, Beziehungen und Constraints. Die Karten-Tabelle heißt `cards`.

```sql
users          (id, username UNIQUE,                     -- preferred_username aus dem SSO
                sub UNIQUE NULL, name NULL, email NULL,  -- OIDC-Subject + Profil aus dem SSO
                password_hash NULL,                      -- ALTLAST: seit der SSO-Umstellung nie gelesen
                role TEXT CHECK(role IN ('admin','template_manager','user')), is_active, session_version,
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
--   Bei aktiviertem Feld durch jeden Board-Nutzer mit Schreibrecht editierbar; Zähler bleibt davon unberührt.
--   Keine Eindeutigkeitsgarantie (Dubletten durch Reset/leere Blöcke bewusst erlaubt).

board_instruction_forms (board_id PK FK→boards ON DELETE CASCADE,
                         enabled DEFAULT false,
                         filename, path, size, uploaded_at, uploaded_by NULL)
-- Board-Eigentümer/Admin hinterlegen genau eine PDF-Vorlage. Aktivierung ist
-- nur mit einer unverschlüsselten, lesbaren Vorlage mit mindestens einer Seite
-- möglich. Board-Nutzer mit Schreibrecht erstellen daraus im Karten-PDF-Editor neue Anhänge:
-- <Antragsnummer>_Anweisung1.pdf, <Antragsnummer>_Anweisung2.pdf, ... .
-- Die aktuelle Antragsnummer wird unter Kartensperre übernommen; ohne Nummer
-- heißen die Dateien Anweisung1.pdf usw. Die nächste Nummer folgt auch auf
-- passend benannte manuelle Uploads und alte Namen wie Anweisung 1.pdf,
-- auch nach Änderung der Antragsnummer. Ersetzen/Deaktivieren/Löschen
-- wird gegen parallele Erstellung versioniert und unter Board-Sperre gespeichert.

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
- **Ansichten:** Kanban, gruppierte Liste, Tabelle und Kalender auf demselben Board. Suche und Filter bleiben beim Wechsel erhalten; alle Ansichten beachten die aktivierten Kartenfelder und zeigen nur nicht archivierte Karten.
- **Liste:** Board-Spalten erscheinen in ihrer bestehenden Reihenfolge als aufklappbare Kategorien mit Trefferanzahl. Einzelne oder alle Kategorien auf-/zuklappen; unter „Gruppen auswählen“ persönlich ausblenden, unten im Bereich „Ausgeblendet“ mit Trefferanzahl wieder einblenden. Suche/Filter zeigen passende ausgeblendete Gruppen vorübergehend, ohne die gespeicherte Auswahl zu ändern; Karten öffnen und Status über die vorhandene Verschiebeaktion ändern (einschließlich Status-Triggern).
- **Tabelle:** Titel und Status sowie auswählbare aktivierte Metadaten-/Betragsspalten; Sortierung über Spaltenüberschriften (Beträge numerisch, leere Werte zuletzt). Die Reihenfolge aller Tabellenspalten einschließlich Titel und Status ist per Drag-and-drop am Griff direkt in der Tabellenüberschrift oder in „Tabellenspalten auswählen“ persönlich änderbar und zurücksetzbar. Status direkt auswählbar. Anhänge und längere Notizfelder bleiben in der Kartendetailansicht.
- **Kalender:** Monatsraster oder Terminliste nach Deadline bzw. Sitzung, nur wenn das jeweilige Feld aktiviert ist; Monatsnavigation, Heute und separater Bereich für Karten ohne Datum. Auf kleinen Bildschirmen wird die Terminliste angezeigt. Kalenderdaten werden nicht per Drag&Drop verändert.
- **Suchnavigation:** Bei aktiver Suche oder Filtern scrollt Kanban horizontal zur ersten Treffer-Spalte; die Liste zeigt nur Treffergruppen und öffnet sie vorübergehend, ohne gespeicherte Klappzustände zu überschreiben. Die Tabelle setzt ihren horizontalen Ausschnitt auf den Titel zurück. Der Kalender behält einen Monat mit Treffern bei oder springt zum frühesten Treffer-Monat; reine Treffer ohne Datum erscheinen ohne leeres Monatsraster. Manuelle Monatsnavigation bleibt möglich, der Suchfokus bleibt erhalten.
- **Persönliche Anzeige:** Gewählte Ansicht, eingeklappte Kategorien und Reihenfolge/Sichtbarkeit der Tabellenspalten werden lokal im Browser pro Nutzer und Board gespeichert. Keine zusätzlichen API-Endpunkte oder Datenbankmigrationen.
- **Filter** (clientseitig): Textsuche (Titel/Antragsteller), Priorität, Zugewiesen, „nur überfällig" (Deadline < heute).
- **Karten sortierbar** per Drag&Drop innerhalb/zwischen Spalten (`cards.position`); Reihenfolge wird persistiert.
- **Kommentare** und **Aktivitäts-/Statushistorie** je Karte — nur in der internen Detailansicht, nicht auf der öffentlichen Statusseite.
- **Ausgeblendete Felder:** Auch Archiv und Statistik beachten die aktuellen Kartenfelder. Die Historie zeigt keine alten Deadlines/Zuweisungen ausgeblendeter Felder und verwendet für Datei-/Archivereignisse allgemeine Texte ohne historische Dateinamen oder Pfade. Gespeicherte Werte und Historieneinträge bleiben erhalten.

### Zugriff & Verwaltung (Logik)
- **Sehen** (`canAccessBoard`): `role='admin'` **oder** Eigentümer **oder** `board_access` mit eigener `user_id` **oder** mit einer `group_id` aus seinen Gruppen.
- **Verwalten** (`canManageBoard` — umbenennen, Stati, Freigaben, löschen): `role='admin'` **oder** Eigentümer.
- **Guards** (Server-Funktionen, werfen `notFound()`/`redirect()` — in *jedem* Handler aufrufen, nie nur im UI ausblenden):
  - `requireUser` / `requireAdmin` / `requireTemplateManager` (`lib/auth`)
  - `requireBoardAccess` / `requireBoardManage` (`lib/authz`)
  - `requireFinanceAccess` / `requireFinanceManage` (`lib/finance`)
  - `requireInventoryBoardAccess` / `requireInventoryBoardManage` (`lib/inventory`)
- Alle drei Board-Arten (Kanban, Finanzen, Inventar) benutzen dasselbe Muster: `canAccess*` erlaubt Lesen über jede passende Freigabe; `canEdit*` verlangt mindestens eine passende direkte oder Gruppenfreigabe mit `access_level='write'`. Admin/Eigentümer haben volle Rechte. `canManage*` bleibt Admin/Eigentümer vorbehalten. Leihvorgangsboards spiegeln auch die Schreibrechte des Inventars.
- **Bürokraft (normale Kanban-Boards):** In den Einstellungen einen bereits berechtigten aktiven Nutzer auswählen und Ausgangs-/Zielspalten getrennt freigeben. `board_office_roles` und `board_office_statuses` (Migration 0071) sind standardmäßig inaktiv und erteilen selbst keinerlei Leserecht. Direkte/Gruppen-Schreibrechte sowie Eigentümer/Admin-Rechte haben Vorrang und bleiben unverändert. Ohne Schreibrecht darf die Person ausschließlich aktive Karten von erlaubten Ausgangsspalten in erlaubte, andere Zielspalten bewegen; Karteninhalte, Kommentare, Anhänge, Anlage/Löschen, Wiederherstellung und reine Umsortierung bleiben gesperrt. Bewegte Karten werden ans Zielende angehängt. Normale Status-Automatismen laufen weiterhin. Entzogene Leserechte heben die Zusatzberechtigung sofort auf.
- **Bürokraft-Durchsetzung:** Kanban, Liste/Tabelle und Kartendetail bieten nur passende Ziele; Server Actions prüfen die aktuellen Spalten unter Kartensperre erneut. Die DB erzwingt, dass konfigurierte Spalten zum Board gehören. REST/MCP erlauben alternativ zu vollem Schreibrecht ausschließlich `PATCH /cards/{id}` mit genau `statusId` bei passender Bürokraft-Regel und weiterhin erforderlichem `scope=write`; Misch-Patches und andere Schreibaktionen bleiben gesperrt. Keine zusätzlichen externen Endpunkte.
- **Migration 0070:** Alle vorhandenen Personen- und Gruppenfreigaben in `board_access`, `finance_board_access` und `inventory_board_access` erhalten `access_level='write'` (`NOT NULL DEFAULT 'write'`, DB-Constraint für `read|write`). Neue UI-Freigaben starten mit Lesend; die Auswahl ist serverseitig validiert. Freigaben können geändert oder entfernt werden; die effektiven Rechte werden bei jedem Aufruf live geprüft.
- **Nur lesend:** keine Kartenanlage/-änderung/-löschung, Statuswechsel, Wiederherstellung, Kommentare, Uploads, PDF-Bearbeitung/Signierung, Datei-/Ordnerorganisation, Inventaränderungen, Mängel- oder Leihaktionen. Lesen, Suche, Filter und Downloads bleiben möglich. Status-Links mit öffentlichen Bearbeitungsmöglichkeiten werden nur Schreibern angezeigt.
- **Finanz-Schreibrecht:** Haushaltsplan über `/finanzen/{id}/plan` bearbeiten (Bestätigungsdialog vor Anzeige der Eingabefelder, auch bei Direktaufruf); Einstellungen, Konten/Quellen und Freigaben bleiben Eigentümer/Admin vorbehalten. Die Bearbeitung in den Einstellungen verwendet denselben Planeditor. Er weist auf automatisches Speichern hin; jede Position zeigt ausstehende Änderungen, laufendes Speichern, erfolgreichen Abschluss oder einen Fehler mit Wiederholungsmöglichkeit an. Fehler erhalten den Eingabeentwurf.
- **API/MCP:** Schreiben benötigt zugleich live Schreibrecht am Board und Token-/Grant-`scope=write`; reine Lesefreigaben ergeben bei Schreibaufrufen `403`. Externe Endpunkte und öffentliche Token-Verträge bleiben unverändert.

### Bootstrap & Sicherheit
- Erst-Admin via SSO: der in `.env` als `ADMIN_USER` gesetzte SSO-Benutzer wird beim **ersten Login** automatisch Admin (JIT-Provisioning; kein Passwort in dieser App, kein Admin-Seed)
- Secrets aus `.env`: `AUTH_SECRET` (Session/Cookies), `ENCRYPTION_KEY` (AES für Nextcloud-Credentials)
- Schutz: letzten Admin und sich selbst nicht entfernen/degradieren
- Cookie-Flags `HttpOnly`/`Secure`/`SameSite`, CSRF-Schutz (Server Actions prüfen Origin; Route Handlers entsprechend absichern), einfaches Rate-Limit am Login

---

## Nextcloud-Integration

> **WICHTIG — Abgrenzung:** Die App ist eigenständig. Anträge/Karten und Kanban-Boards leben **ausschließlich in PostgreSQL**, nicht in Nextcloud Deck. Nextcloud dient ausschließlich der optionalen, abschließenden Archivierung von Kartenanhängen.

- **Archivierung ist eine reine Board-Einstellung** (an/aus pro Board, Default: **aus**). **Keine globale Verbindung** — jedes Board bringt seine **eigene Nextcloud** mit: URL + Zugangsdaten + Zielordner.
- **Trigger-Status pro Board** (Status-Spalte mit `is_archive_trigger`). Erreicht ein Antrag diese Spalte **und** ist die Archivierung für das Board aktiv, werden die aktuell am Antrag hängenden Dateien automatisch in einen Unterordner des board-eigenen Zielordners hochgeladen.
- Konfiguriert wird das in den **Board-Einstellungen** (Eigentümer/Admin), nicht im globalen Admin Panel.
- Zugriff über WebDAV / Nextcloud-API; keine weitere Nextcloud-Funktionalität.
- **Sicherheit:** Zugangsdaten **verschlüsselt** in der DB (AES-256-GCM via Node-`crypto`, Schlüssel aus `.env`). Empfehlung: Nextcloud-**App-Passwort** statt Hauptpasswort. Passwortfeld im UI nur schreibend („gesetzt"-Anzeige, ersetzen statt anzeigen).
- Archivordner verwenden den konfigurierten, bereinigten Namen ohne automatisch ergänzte Karten-ID. Gleichnamige Ordner werden wiederverwendet. Uploads verwenden bedingtes Anlegen: Bereits vorhandene identische Dateien werden bei Wiederholungen wiederverwendet. Bei anderem Inhalt wird die Gremio-Datei daneben als `Name_Gremio.ext` abgelegt; weitere Konflikte verwenden `Name_Gremio_2.ext`, `Name_Gremio_3.ext` usw. Auch identische Ausweichdateien werden bei Wiederholungen wiederverwendet. Ausweichnamen respektieren die UTF-8-Bytegrenze und reservieren die Pfade anderer Anhänge; vorhandene Dateien werden nie überschrieben. Der Inhaltsvergleich liest höchstens bis zur ersten Abweichung und hat eine Zeitgrenze. Vorhandene abgeschlossene Archive werden nicht umbenannt.


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
> 8. **Trigger-Zuweisungen** — jeder Board-Trigger (Anweisungsdatum, Überweisungsdatum, Nachreichung, Rückmeldung, Done-Spalte, Nextcloud-Archiv) kann beim Auslösen optional **alle Zuweisungen entfernen** und/oder **zusätzlich Nutzer zuweisen** (siehe „Trigger-Zuweisungen").

### Trigger-Zuweisungen

Trigger-Spalten, Trigger-Zuweisungen und Bürokraft-Einstellungen behalten ihre aktuelle Formularauswahl nach dem Speichern und bei Validierungsfehlern. Ein nativer Reset-Listener verhindert, dass React beim Abschluss einer Server Action Häkchen auf veraltete Anfangswerte zurücksetzt.
In den Board-Einstellungen hat jeder Trigger zwei optionale Zuweisungs-Aktionen:
**„Alle Zuweisungen entfernen"** (Haken) und **„Zusätzlich zuweisen zu"**
(Nutzer mit Board-Zugriff; leer = niemand zusätzlich). Reihenfolge: erst
entfernen, dann zuweisen. Ausgelöst wird
- bei **Anweisungsdatum, Überweisungsdatum, Done-Spalte, Nextcloud-Archiv** durch
  das **Erreichen** der jeweiligen Spalte per Verschieben (Board, Kartendetail,
  REST/MCP, öffentliche Rückmeldung) — Nextcloud auch bei deaktivierter
  Archivierung, Done nicht erst beim Sweep. Neu angelegte Karten lösen nicht aus.
- bei **Nachreichung** durch das öffentliche Einreichen der Nachreichung,
- bei **Rückmeldung** durch das abschließende öffentliche Einreichen; danach
  folgen die Trigger der erreichten Zielspalte.

Lösen mehrere Trigger gleichzeitig aus, laufen sie in der Reihenfolge von
`TRIGGER_KINDS` (`lib/constants.ts`). Nutzer, die inzwischen keinen
Board-Zugriff mehr haben, werden übersprungen. Ist „Zugewiesen zu" am Board
ausgeblendet, passiert nichts. Jede tatsächliche Änderung erscheint als
Aktivität „Automatisch (Trigger „…")" ohne Nutzer (System). Bei einem
REST-PATCH mit Spaltenwechsel **und** `assigneeUserIds` gilt die explizite Liste.
Logik: `lib/trigger-assignments.ts`; Daten: `board_trigger_assignments`
(`board_id`, `trigger`, `clear_assignees`) + `board_trigger_assignees`
(`board_id`, `trigger`, `user_id` FK→users CASCADE), Migration 0069.

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
| E-Mail-Adresse | E-Mail | ✅ | Kontaktadresse, ausschließlich intern sichtbar |
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
- Beim Zuweisen eines Ziel-Boards sowie beim Aktivieren eines Standorts müssen `applicant`, `submitter_email`, `finance_request` und `student_card` bereits aktiviert sein. Fehlende Pflichtfelder werden namentlich gemeldet; optionale `annex_a`/`annex_b` bleiben konfigurierbar. Solange mindestens ein Standort (auch deaktiviert) auf das Board zeigt, sperren Oberfläche und Server das Deaktivieren dieser Pflichtfelder. Routing und Feldkonfiguration werden über dieselbe Board-Sperre serialisiert. Erst nach Entfernen aller entsprechenden Zuordnungen sind die Felder wieder frei konfigurierbar; ihre Werte bleiben erhalten. Migration `0087` korrigierte zuvor bereits aktive Zuordnungen.
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
/finanzen/{id}/einstellungen → Name, betroffene Konten (mehrere möglich; optionaler Teilmengen-Override für die Ausgaben-Berechnung Live/Tatsächlich), Quell-Boards mit optionaler Verfallen-Spalte je Quelle, Freigaben, Haushaltsplan-Editor (Eigentümer/Admin)
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
/vorlagen                → Vorlagen-Bereich (Admin ODER Template-Verwalter): Einstieg zu Board- und Finanzvorlagen
/vorlagen/boards         → Board-Templates: Liste + anlegen/umbenennen/löschen/duplizieren
/vorlagen/boards/{id}    → Board-Template bearbeiten: Spalten anlegen/umbenennen/per Drag&Drop sortieren/löschen
/vorlagen/finanzen       → Finanz-Templates: Liste + anlegen/umbenennen/löschen/duplizieren
/vorlagen/finanzen/{id}  → Finanz-Template bearbeiten: Haushaltsplan-Positionen (Auto-Speichern)
/admin                   → Admin Panel (nur für Admins sichtbar)
/admin/users             → Nutzerverwaltung (Rollen, lokale Deaktivierung/Reaktivierung; endgültiges Löschen im SSO)
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
- **Boards** (`/intern/boards`), **Finanzen** (`/finanzen`), **Inventar** (`/intern/inventar`), **Meine Aufgaben** (`/intern/aufgaben`) — jeder Nutzer
- **Neues Board erstellen** — jeder Nutzer
- **Mein Konto** (`/intern/konto`) — jeder Nutzer; Benutzername/Anzeigename kommen aus dem SSO und sind hier nicht änderbar
- **Vorlagen** (`/vorlagen`) — nur für Admin **und** Template-Verwalter sichtbar
- **Admin Panel** (`/admin`) — nur für Admins sichtbar
- **Logout**

Die Startseite zeigt standardmäßig **Meine Aufgaben**, **Boards**,
**Finanzübersichten** und **Inventare**. Über „Startseite
anpassen“ kann jeder Nutzer diese vier Abschnitte unabhängig ein- oder ausblenden
und ihre Reihenfolge per Drag-and-drop am Ziehgriff festlegen. Die Einstellung
liegt im vorhandenen `user_task_prefs.config`-JSONB; bei älteren Einstellungen
werden fehlende Abschnitte ergänzt und entfernte Abschnitte ignoriert, ohne
zuvor ausgeblendete Abschnitte wieder einzuschalten.

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
| Beantragter Betrag | Euro | `requested_amount` (Cent) |
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
- **Interne Dateiordner:** Board-Nutzer mit Schreibrecht können direkt am Ticket Ordner erstellen,
  sichtbare Anhänge umbenennen (Dateiendung bleibt erhalten) und zwischen diesen
  Ordnern und dem Ticket-Hauptordner verschieben. Eine Ebene von Unterordnern;
  die Dokument-Slots und ihre Sichtbarkeitsregeln bleiben erhalten. Die Zuordnung
  ist DB-Metadatum, der lokale Speicherpfad bleibt unverändert. Slotersatz und
  PDF-Kopien übernehmen die Ordnerzuordnung. Öffentliche Antragsteller und
  Bearer-/MCP-APIs erhalten keine Ordnerverwaltung oder Ordner-Metadaten.
  Nextcloud archiviert die Struktur einschließlich leerer Ordner; das interne
  ZIP enthält die Ordner der sichtbaren Dateien. Kollisionen von Archivnamen
  erhalten deterministische ID-Suffixe, damit keine Datei überschrieben wird.
  Bereits erfolgte Nextcloud-Archivierungen bleiben Momentaufnahmen.
- **Ausgeblendete Anhangfelder sind eine serverseitige Grenze:** Die interne
  Download-/Formularfeld-Route, das Karten-ZIP sowie Bearbeiten und Löschen
  liefern bzw. verändern nur aktuell sichtbare Anhänge. Automatisch erstellte
  Anweisungen bleiben als ausdrücklich eigenständiger Workflow sichtbar, auch
  wenn „Weitere PDFs" ausgeblendet ist. Das bestehende öffentliche Statusmodell
  bleibt davon getrennt: Der Studierendenausweis ist dort immer ausgeschlossen.
- **PDF-Dateiänderungen sind konfliktgeschützt:** Ersetzen und Kopieren prüfen
  unter Kartensperre, ob der Quellanhang noch unverändert existiert; parallele
  Änderungen werden abgewiesen und neu geschriebene Dateien aufgeräumt. Auch
  bearbeitete/signierte Ergebnisse unterliegen der Grenze von 25 MB.
- **Titel**, **Erstellungszeitpunkt** und **Letzte Änderung** sind immer sichtbar (nicht abschaltbar).
- **Aktivierte Felder sind optional:** Aktiviert ein Board ein Feld, erscheint es auf allen Karten des Boards, **darf aber leer bleiben** (keine Pflichteingabe). Ausnahme bleiben die automatisch gesetzten Werte (Titel, Erstellungszeitpunkt, Letzte Änderung).

### Datenmodell (Ergänzung)
```sql
attachments       (id, card_id FK→cards ON DELETE CASCADE,
                   kind TEXT,   -- finance_request|annex_a|annex_b|student_card|other
                   folder_id NULL, -- composite FK (card_id, folder_id) → attachment_folders
                   filename, path, mime, size, uploaded_at, uploaded_by FK→users NULL)
attachment_folders (id, card_id FK→cards ON DELETE CASCADE, name,
                    UNIQUE(card_id, name), UNIQUE(card_id, id))
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


```sql
board_templates        (id, name UNIQUE, description, created_at)

board_template_statuses(id, template_id FK→board_templates ON DELETE CASCADE, name,
                        position INTEGER, is_archive_trigger INTEGER DEFAULT 0)
-- beliebig viele Archiv-Trigger; beim Kopieren vollständig übernehmen
```

---

## Haushaltspositionen und öffentliche Einreichung (Migration 0062)

Bestehende Karten bleiben `budget_mode='single'`: bisherige Felder und optionale
Kontozuordnung bleiben unverändert. Je Karte sind höchstens 100 Positionen
zulässig (`MAX_BUDGET_POSITIONS`, Web, REST und MCP). `card_budget_positions` speichert im Modus
`positions` UUID, Karten-FK (CASCADE), Reihenfolge, Haushaltstitel, Bezeichnung,
verpflichtende Konto-FK (RESTRICT) und drei nullable Centbeträge. `cards.account_id`
und `cards.budget_title` sind dann NULL; die drei Kartenbeträge sind atomar mit den
Positionen gespeicherte Gesamtsummen. Es gibt keine zweite Kontozuordnung.
Je Betragsart gilt: ausschließlich vorhandene Werte summieren, alle leer → NULL,
echte Null → 0; Positionswerte und Gesamtsummen maximal 2.000.000.000 Cent.
Die Live-Ausgabe verwendet je Position tatsächlich, sonst genehmigt, sonst 0.
Pro Finanzübersicht und Quell-Board kann optional eine **Spalte für Verfallen**
(`finance_board_sources.expired_status_id`) gewählt werden. Karten, die aktuell
in dieser Spalte stehen, werden vollständig aus den Live-Ausgaben ausgeschlossen
(Einzelbetrag und Budgetpositionen, einschließlich Export). Antragsübersicht und
tatsächliche Ausgaben bleiben unverändert. Ohne Auswahl gilt die normale
Berechnung; beim Verlassen der Spalte zählt die Karte wieder. Die Spalte muss
zum Quell-Board gehören. Eigentümer/Admin der Finanzübersicht verwalten diese
Einstellung; Quell-Boards ohne aktuellen Zugriff des Finanzboard-Eigentümers
bleiben ausgeblendet. Beim Löschen der Spalte wird die Auswahl zurückgesetzt.
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
Archivpfad, Kanban-Suche und Aufgabenübersicht verwenden bei
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

Interne Gegenstandslisten und -details filtern optionale ausgeblendete Metadaten vor der Übergabe an Client-Komponenten, einschließlich Suchdaten. Das betrifft Nummer, Seriennummer, Gruppen-/Kategorien-/Standortzuordnung, Zustandsnotiz, aktuelle Person/Frist, Preis, Kaufdatum, Händler und Notizen. Im Inventararchiv bleiben ausgeblendete Nummern und Zustandsnotizen ebenfalls verborgen. Operative Bestands-, Zustands- und Verfügbarkeitsdaten bleiben für die Ausleihsteuerung verfügbar; eigenständige Vorgangs- und Mängelhistorien behalten ihr bestehendes Rechtemodell.

Ausgeblendete Kategorien und Standorte entfernen auch ihre Auswahlkataloge aus internen Client-Props. Die öffentliche Inventarliste enthält bei deaktivierter Kategorie weder Kategorienamen/-IDs noch Kategorieoptionen oder Suchwerte. Bei aktivierter Kategorie werden ausschließlich Optionen öffentlich sichtbarer Gegenstände übertragen; interne und ungenutzte Kategorien bleiben verborgen. Gespeicherte Zuordnungen bleiben erhalten.

Eigenständiges Modul (seit 2.0.0) zur Verwaltung von Gegenständen und deren Ausleihe. **Inventar-Boards sind keine Kanban-Boards** — eigene Tabellen, eigene Listenansicht. Sie teilen sich mit den Kanban-Boards nur Nutzer, Gruppen und das **identische Zugriffsmodell**: Zugriff = Admin ∨ Eigentümer ∨ Freigabe an Nutzer/Gruppe (read/write, höchste Stufe gilt); Verwalten = Admin ∨ Eigentümer (`lib/inventory.ts`, gleiche Struktur wie `lib/authz/index.ts`). Jeder eingeloggte Nutzer darf ein Inventar-Board erstellen und ist dann dessen Eigentümer.

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
- **Inventar als Finanzquelle:** Bei Leih-System-Boards wird der vollständige Board-Kontext geprüft. Maßgeblich sind ausschließlich die aktuellen Inventarfreigaben und Inventareigentümer, auch bei zusätzlichen Eigentümern. Alte normale Board-Freigaben/-Eigentümer gewähren weder Finanzquellenzugriff noch einen Eintrag in Board-Listen oder boardübergreifenden API-Suchen.
- **Archivierte Karten zählen in der Finanzauswertung mit** (Done-Archiv blendet nur die Board-/Aufgaben-Ansicht aus). Für „tatsächliche Ausgaben" sollen abgeschlossene Anträge mitzählen.
- **„Weitere PDFs" (`other`) sind über den Status-Token öffentlich** herunterladbar (Spec) — dort **keine** vertraulichen internen Dokumente ablegen. Der **Studierendenausweis** bleibt intern.
- **Board-Zugriffsmodell:** Leser sehen Inhalte; Nutzer mit Schreibrecht dürfen Karten/Anhänge bearbeiten und löschen sowie aktivierte Nummern und Triggerdaten ändern. Einstellungen bleiben Eigentümer/Admin vorbehalten. Manuelles Archivieren bleibt ausgeschlossen; Wiederherstellen erfordert Schreibrecht.
- **REST-API ⊆ Web-App (nie mehr Rechte):** Board-Lese-/Schreibrecht via `canAccessBoard`/`canEditBoard`, Token-`scope` (read/write) und Board-Beschränkung schränken nur **ein**. Deaktivierte Board-Felder (`board_card_fields`) werden über die API **weder gelesen noch geschrieben** — exakt wie die Web-Oberfläche sie ausblendet.
- **REST-Vertragsabgleich:** Die interne API umfasst Boards/Karten einschließlich Katalogen, Suche, Kommentaren, Verlauf und Anhängen (siehe `docs/API.md` und `docs/MCP.md`). Die öffentliche API bleibt auf Anträge/Feedback begrenzt. `POST` kann Haushaltspositionen atomar anlegen, `PATCH` ersetzt sie mit `budgetRevision`; `lib/api-card-response.ts` liest Summen/Revision/Positionen im selben Snapshot. Reine Zuständigen-PATCHes einschließlich `[]` werden gespeichert. Trigger-Metadaten für Quittungen/Überweisungen sind für Board-Verwalter vollständig; Listen liefern Summen, Details die Positionen. Siehe `docs/API_PARITY_AUDIT.md` für Abdeckung und bewusst nicht externe Web-Funktionen.
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
- **Dependencies (Audit 01.11.2026):** Per `npm audit fix` ohne Major-Sprünge aktualisiert und als Mindestversionen festgeschrieben: `next` ^15.5.28, `node-forge` ^1.4.2, `sharp` ^0.35.5 (auch als Override), `@modelcontextprotocol/sdk` ^1.32.2. Offen bleiben ausschließlich Befunde, die einen Major-Wechsel verlangen: `zod` < 4.6.6 (zod 3 prüft nach verletztem `.max()` dennoch jedes Element; Abmilderung: `limitArrayLength` in `lib/zod-limits.ts` weist übergroße Arrays vor der Elementprüfung ab, REST-Karten-Bodies sind auf 1 MB begrenzt, öffentliche API und MCP begrenzen Bodies beim Lesen; Server Actions erlauben bis 150 MB — Upgrade auf zod 4 separat einplanen), `minimatch` über `webdav` sowie die ESLint-Entwicklungskette (moderat, nur Entwicklungsbaum). `@esbuild-kit/core-utils` verwendet über einen gezielten Override esbuild ^0.25.12; kein Drizzle-Downgrade. Der Stand ist zeitgebunden; ältere Details und Grenzen stehen in `docs/SECURITY_AUDIT_SINCE_2.7.0.md`.
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
- **Bearbeiten (intern, Board-Nutzer mit Schreibrecht):** Freitext per Klick platzieren und vorhandene **AcroForm-Formularfelder** über ein Seitenpanel ausfüllen. Beim Speichern werden die Änderungen serverseitig mit `pdf-lib` ins PDF geschrieben (`lib/pdf-edit.ts`).
- **Alte Formularstruktur:** `lib/pdf-widget-compat.ts` ordnet getrennte Kopien in
  `AcroForm/Fields` und Seiten-`Annots` anhand vollständigem Feldnamen, Feldtyp,
  Wert, Rechteck und Optionszustand zu. Mehrfachplatzierungen werden zusätzlich
  über Seitenreferenz/Appearance unterschieden. Native Verknüpfungen haben Vorrang;
  widersprüchliche oder mehrdeutige Zuordnungen bleiben im Seitenpanel. Das Öffnen
  schreibt keine PDF-Bytes um (auch keine vorhandenen Signaturen). Erst beim
  ausdrücklichen Bearbeiten werden Werte und Appearances eindeutig zugeordneter
  Seitenkopien synchronisiert. Alte Radiogruppen ohne Radio-Flag werden an ihren
  unterschiedlichen Widget-On-Zuständen erkannt; wiederholte Checkboxen bleiben Checkboxen.
- **Text & Zeichensatz:** Werte laufen durch `sanitizeWinAnsi` (Helvetica/WinAnsi).
  Zeilenumbrüche bleiben in Freitext und mehrzeiligen Feldern erhalten; in
  einzeiligen Feldern werden sie zu Leerzeichen (der Editor verhindert Enter dort).
  Zerlegte Umlaute werden zusammengesetzt, typografische WinAnsi-Zeichen
  (`„" – … • ™ €`) bleiben, Zeichen ohne Glyphe werden auf den Grundbuchstaben
  zurückgeführt (`Ł`→`L`); nur der Rest (z. B. Emoji) wird zu „?". Freitext-Boxen
  werden mit der echten Schrift vermessen; geleerte/entfernte Freitexte löschen
  ihr Feld samt Widget. Der Editor sendet nur neue, geänderte und entfernte
  Freitexte und fragt vor dem Verwerfen ungespeicherter Änderungen nach. Alle
  Speicherpfade (Karte, Inventar, Anweisungsvorlage) nutzen `applyEditsAndSign`.
- **Freitext setzen:** Klick setzt einen leeren, fokussierten Text (12 pt,
  unabhängig vom Zoom; A−/A+ ändert die Größe, 6–64 pt). Leer gelassen
  verschwindet er wieder. Die Vorschau folgt dem pdf-lib-Layout (Maße,
  Zeilenabstand, Grundlinie), die Box bleibt vollständig auf der Seite.
  Positionen beziehen sich wie in pdf.js auf die **CropBox** (auch die Signatur).
- **Signatur-Box auf gedrehten Seiten:** `placeVisibleBox` (`lib/pdf-edit.ts`)
  bildet die im Browser aufgezogene Box über Seitenrotation und CropBox ins PDF
  ab; `drawSignatureBox` (`lib/sign.ts`) zeichnet Rahmen, Bild, Name und Datum in
  einem lokalen, aufrechten Koordinatensystem. Die Box bleibt auf der Seite.
- **Signieren:** sichtbare Signatur-Box platzieren → serverseitige **PAdES-Signatur** mit dem persönlichen `.p12` des Nutzers (`lib/sign.ts`, `@signpdf`). Verlangt ein in den Konto-Einstellungen hinterlegtes Zertifikat (`lib/cert.ts`, `inspectP12`).
- **Speichern:** „neue Datei" (zusätzlicher `other`-Anhang, Original bleibt) **oder** „Original ersetzen" — Server-Action `savePdfEditsAction` (`app/intern/card/[id]/pdf-actions.ts`), Board-Schreibrecht erforderlich, Aktivitätseintrag.
- **Feld-Metadaten:** `GET /api/attachment/{id}/fields` liefert die ausfüllbaren Felder fürs Seitenpanel.
- **Zertifikatsverwaltung:** `/intern/konto` → Abschnitt „Signatur-Zertifikat" (`.p12` + Passwort hochladen/ersetzen/entfernen; Inhaber/Gültigkeit werden angezeigt). Spalten an `users`: `cert_p12_enc`, `cert_pass_enc`, `cert_subject`, `cert_not_after`, `cert_uploaded_at`.

> Hinweis: pdf.js (v5) benötigt `Promise.withResolvers` (moderne Browser ≥ 2024). Der pdf.js-Worker wird als statisches Asset ausgeliefert (kein CDN).

---

## Ergänzungen aus dem Audit seit 2.7.0

Ausgeblendete Kartenfelder werden vor der Übergabe von Client-Props entfernt,
auch in Karteneditor, Kanban-Suchtext und Aufgabenübersicht. Die Feldsichtbarkeit gilt damit ebenfalls für Werte, die
nicht als sichtbares Formularelement gerendert würden; gespeicherte Werte bleiben erhalten.

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
- Öffentliche Einreichungen benötigen eine interne Kontakt-E-Mail; Bestätigung optional pro Board/Art durch den Admin.


## Interne API-Erweiterungen und MCP

Die authentifizierte REST-API umfasst jetzt zusätzlich boardgebundene Nutzer-,
Konten- und Prioritätskataloge, feldsichtbare Suche/Filter/Pagination, Kommentare
(lesen/anlegen, eigene bearbeiten, Autor/Verwalter löschen), unveränderlichen
Aktivitätsverlauf und sichtbare Kartenanhänge (Liste/Download/Upload). Datei-Uploads
verwenden dieselben Größen-/MIME-/Sichtbarkeitsregeln und sperren die Karte bei
Dateizuordnung/Slotersatz; Dateisystemoperationen laufen außerhalb der Transaktion.
Die API-Kartenlöschung sperrt ebenfalls die Karte gegen parallele Uploads.

`/api/mcp` bildet alle 22 internen API-Methoden auf Werkzeuge ab (Vertragstest).
Der MCP-Server verwendet dieselben Handler über einen nicht über HTTP setzbaren
Request-Kontext. OAuth-Zugangstokens sind ausschließlich für MCP gültig; REST
behält persönliche API-Tokens. Beide prüfen die aktuellen Boardrechte und
sichtbaren Felder. Keine öffentlichen Status-Tokens oder Speicherpfade werden
über neue Antworten ausgegeben. Historische Datei-/Archivdetails sind im Verlauf
bewusst verallgemeinert, ausgeblendete Feldwerte werden dort nicht ausgegeben.

Gremio bleibt OIDC-Client des bestehenden SSO und ist zusätzlich OAuth-Server für
MCP. Public Clients registrieren exakte Redirects und verwenden PKCE S256. Auf der
Freigabeseite werden standardmäßig Lesen und keine Boards ausgewählt. Alle Boards
(einschließlich künftiger) müssen ausdrücklich gewählt werden. Der OAuth-Scope
`gremio` bezeichnet die Verbindung; konkrete Rechte (`read`/`write`, ausgewählte
Boards) liegen in einer live geprüften Freigabe. Dadurch greifen Änderungen und
Widerruf unter `/intern/konto/verbindungen` ab dem nächsten Aufruf. Ein leerer
beschränkter Board-Satz bedeutet keinen Zugriff, niemals alle Boards.

Migration 0065 ergänzt `mcp_clients`, `mcp_grants`, `mcp_grant_boards`, `mcp_codes`
und `mcp_tokens`. Codes/Tokens werden nur gehasht gespeichert. Codes: 5 Minuten,
Access: 15 Minuten, rotierende Refresh-Tokens: 30 Tage. Erneute Verwendung eines
bereits verbrauchten Refresh-Tokens widerruft die Verbindung. Der Bootstrap räumt
abgelaufene Credentials stündlich auf. Bestehende OIDC-Tokens verlassen die
Web-Session nicht. Finanz-/Inventarverwaltung, PDF-Bearbeitung und
Board-Verwaltung bleiben außerhalb der API/MCP-Freigabe.

Verträge und Betriebsgrenzen: `docs/API.md`, `docs/MCP.md`. Die älteren Aussagen in
`docs/API_PARITY_AUDIT.md` beschreiben den damaligen Umfang, nicht diese Erweiterung.

## Entferntes Protokoll-Feature

Sitzungs- und Ergebnisprotokolle sowie deren Vorlagen, Editor, Server Actions,
Dateiproxys und Python-PDF-Renderer sind entfernt. Alte URLs unter
`/intern/protokolle`, `/vorlagen/protokolle`, `/api/protokolle` und `/dokumente`
liefern 404. Migration 0066 löscht ausschließlich die neun `protocol_*`-Tabellen.
Vorhandene Karten einschließlich Beschlussreferenzen bleiben unverändert;
Nextcloud-Dateien und lokale Logo-Reste werden nicht gelöscht. Veraltete
`protocols`-Einträge in persönlichen Startseiten-Einstellungen werden von
`normalizeHomePref` ignoriert, die übrige Reihenfolge und Sichtbarkeit bleibt erhalten.
Die Nextcloud-Archivierung von Karten und der PDF-Editor für Anhänge bleiben bestehen.

## MCP-Dateidownload und PDF-Textextraktion

`download_attachment` liefert einen `resource_link` auf die unveränderte Datei,
keinen Base64-Blob. Signierte, an Anhang/Karte und ursprünglichen Zugriffstoken
gebundene Tickets gelten höchstens fünf Minuten. Der Download unter
`/api/mcp/attachments/{cardId}/{attachmentId}` prüft Tokenablauf, Widerruf,
Nutzer, Boardrechte und Anhangsichtbarkeit erneut. Tickets nicht protokollieren.
`read_attachment_text` und die entsprechende interne REST-Route `/text` lesen
Seitentext und gespeicherte Formularwerte mit PDF.js in einem begrenzten
Node-Worker. Keine Python-Laufzeit, keine OCR, keine Änderung der Originaldatei.
Seitenauswahl und Grenzen sowie Fehlerverhalten stehen in `docs/MCP.md`.


## System-E-Mails und öffentliche Kontaktadressen

`lib/email.ts` verwendet Nodemailer, verschlüsselte `smtp_settings` und eine dauerhafte `email_outbox`. Der Worker startet nach Produktionsmigration bzw. in der Dev-Instrumentierung. SMTP bleibt initial deaktiviert. SMTP- und Bestätigungseinstellungen sind adminpflichtig, Spaltenregeln erfordern Board-/Inventarverwaltung. Keine neuen REST- oder MCP-Konfigurationsendpunkte.

`board_email_rules` sind statusgebunden; ein transaktionaler PostgreSQL-Trigger auf Kartenanlage und echten `status_id`-Wechsel erfasst UI, Server Actions, REST und MCP. Er schreibt je Empfänger einen Outbox-Eintrag mit Titel, Board-/Spaltenname und interner Karten-ID; niemals Notizen, Budgets oder Anhänge. SMTP findet außerhalb von DB-Sperren statt; Claims verwenden `FOR UPDATE SKIP LOCKED`. Nach Absturz werden nach zehn Minuten verwaiste Claims wiederholt.

`email_confirmation_settings` schaltet je normalem Board und Art (`application`/`feedback`) bzw. Inventarboard (`inventory`) Bestätigungen. Gemeinsame Einreichungsfunktionen validieren Pflicht-E-Mail für Standort-Anträge und Inventar; Umfragen akzeptieren eine fehlende/leer gelassene Adresse, validieren aber jede angegebene Adresse. Ohne Adresse wird kein Bestätigungsauftrag erzeugt. Sie speichern `cards.submitter_email` bzw. die vorhandene Inventar-Kontaktadresse und schreiben Bestätigung plus Karte/Vorgang in derselben Transaktion. Replay/Rollback erzeugen keine zusätzliche Bestätigung. Die E-Mail gehört zum Idempotenz-Fingerprint. Das konfigurierbare interne Kartenfeld `submitter_email` verwendet dieselbe Spalte: Board-Schreiber können eine gültige Adresse setzen, ändern oder leeren; Leser können sie nur bei aktiviertem Feld sehen. Das Feld erscheint in Karteneditor, neuer Karte, Board-Suche und Board-Ansichten. Ausblenden entfernt den Wert aus Client-Props und Suchtexten, ohne ihn zu löschen. Migration `0087` aktiviert das neue Feld für bestehende Boards. REST-/MCP-Karten liefern weiterhin keine Kontaktadresse und nehmen sie nicht als Schreibfeld an. Legacy-Karten dürfen NULL behalten. Öffentliche Statusansichten und API-Serializer geben Kontaktadressen nicht aus. Feedback-Name und E-Mail bleiben optional. Nur freiwillig angegebene Kontaktadressen sind intern bekannt.

Bestätigungen nutzen eingefrorene Einreichungsdaten und die vorhandenen PDF-Builder, `PUBLIC_BASE_URL` sowie den korrekten Token-Typ. Studierendenausweise und Uploads werden nie angehängt. Erfolgreiche Outbox-Inhalte werden gelöscht, nach sieben Tagen auch Metadaten. Terminal fehlgeschlagene Inhalte verbleiben für Admin-Retry. Zustellung ist mindestens einmal mit stabiler Message-ID; SMTP-Annahme und DB-Abschluss sind nicht atomar. Details und Betrieb: README, öffentlicher Vertrag: docs/PUBLIC_API.md.


## Eigenständige Sitzungen und Tagesordnungen

Sitzungen liegen in eigenständigen Sitzungsbereichen (`meeting_areas`). `meetings.area_id` ist verpflichtend. Der Bereich hält Bezeichnung, Beschreibung und Eigentümer. `meetings` hält Titel, Beginn, Ort/Videokonferenz, Sitzungsleitung, Einreichungsfrist, Status und Revision. Das bisherige manuelle Gremium-Feld entfällt: Bereichsname und Eigentümer werden bei jedem Laden aus dem Bereich abgeleitet; die alten Spalten sind ausschließlich Kompatibilitätskopien. Termine werden in Europe/Berlin eingegeben/angezeigt und als UTC-Zeitstempel gespeichert; ungültige Kalenderdaten und Sommerzeit-Lücken werden abgelehnt. `meeting_area_access` kombiniert Personen-/Gruppenfreigaben mit read/write; jede passende Schreibfreigabe gewinnt. Diese Rechte gelten unmittelbar für sämtliche bestehenden und zukünftigen Sitzungen des Bereichs, TOPs, PDFs und Unterlagen. Eigentümer/Admin verwalten den Bereich und Freigaben; Bereichsschreiber dürfen Sitzungen anlegen und deren Rahmen/Tagesordnung bearbeiten. Es gibt keine separaten Sitzungsfreigaben.

`meeting_topics` hält eigenständige, ausdrücklich eingegebene TOP-Inhalte: Titel, Beschreibung, Beschlussvorschlag, Vortragende, Art, Dauer, Status und Ergebnisnotiz. Ohne `meeting_id` bleibt ein Thema im persönlichen Themenspeicher (Autor/Admin). Sitzungsleser dürfen bis zur Einreichungsfrist Vorschläge einreichen; der Server erzwingt dabei proposed und kein Ergebnis; vertrauliche Vorschläge ohne Verwaltungsrecht werden abgewiesen. Schreiber bearbeiten die Tagesordnung. Vertrauliche TOPs und deren Dateien sind ausschließlich Eigentümer/Admin sichtbar. Abgeschlossene Sitzungen sperren TOP-Änderungen; die Verwaltung kann sie wieder öffnen.

Die Tagesordnung besteht aus scheduled/treated/deferred/withdrawn TOPs. Vertagte und zurückgezogene TOPs bleiben mit roter Statuskennzeichnung in der Tagesordnung und zusätzlich im jeweiligen Reiter sichtbar. Auch nach Weitergabe bleiben sie in beiden Quellansichten enthalten. Das Tagesordnungs-PDF enthält sie ebenfalls mit roter Statuszeile. Drag-and-drop ist mit Pointer und Tastatur bedienbar; Revisionen verhindern veraltete Reihenfolgen und TOP-Edits. Schreiber ohne Verwaltungsrecht können keine vertraulichen TOPs einsortieren oder deren Position überschreiben. Angezeigte Nummern und Zeiten beziehen sich ausschließlich auf sichtbare TOPs. Themenspeicher-Einträge bleiben privat erhalten; Vorschläge an Sitzungen sind über `origin_topic_id` verknüpfte eigenständige Einträge. Übernahmen aus früheren Sitzungen verwenden Dateikopien und die unten beschriebenen zustandsabhängigen Verlaufsregeln. Der neue Teilnehmerkreis muss ausdrücklich bestätigt werden.

**Zugriffsgrenze:** `meeting_boards` darf nur jemand mit Verwaltungsrecht an Sitzung UND Board anlegen/entfernen. Die Anbindung vergibt keine Board-Rechte. `meeting_topic_cards` darf nur jemand mit TOP-Schreibrecht und aktuellem Lesezugriff auf die Karte setzen. Gewöhnliche Kartenverknüpfungen verschieben keine Karten und verändern deren `meeting`-Feld nicht. Die ausdrückliche Finanzanträge-Einplanung ist der unten beschriebene gesonderte Schreibablauf. Sichtbare Referenzen werden bei jeder Anfrage anhand der bestehenden Board-/Inventarrechte gefiltert; ohne Board-Recht werden weder ID, Titel, Nummer noch Board-Name oder Quellanhänge serialisiert. Keine persistente Kopie von Kartentiteln in TOP-Titel; Finanz-Unter-TOPs zeigen eine aktuelle, berechtigungsgefilterte Projektion.

`meeting_documents` speichert eigenständige Sitzungsunterlagen mit neuen Dateipfaden. Upload und Übernahme erfordern TOP-Schreibrecht und eine ausdrückliche Freigabe. Quellübernahme zusätzlich nur mit Board-Schreibrecht, vorhandener Kartenverknüpfung und sichtbarem Anhang; student_card ist ausgeschlossen. PDFs/PNG/JPEG bis zum bestehenden Uploadlimit sind zugelassen. Eine freigegebene Kopie bleibt nach Entzug der Board-Rechte oder Löschen der Quelldatei eigenständig verfügbar; TOP-/Sitzungsrechte werden bei jedem Download geprüft. Ändern von vertraulich auf offen erfordert eine zusätzliche Bestätigung für Inhalt UND Dateien. Dateiverarbeitung findet außerhalb von DB-Sperren statt.

Dokument- und Kartenverknüpfungsänderungen sperren vor dem DB-Schreiben zuerst die offene Sitzung und anschließend den TOP, prüfen den Zugriff erneut und erhöhen dieselbe Sitzungsrevision wie Inhaltsänderungen. Dadurch werden alte TOP-Formulare nach einer Unterlagenänderung abgewiesen; ein paralleler Sitzungsabschluss, eine Weitergabe oder Löschung verhindert nachträgliche Uploads. Fehlgeschlagene Uploads entfernen ausschließlich ihre neu angelegte Datei. Beim Löschen eines TOPs/einer Sitzung wird die Liste zu entfernender Dateien innerhalb derselben DB-Sperre ermittelt und erst nach dem Commit physisch gelöscht.

PDF-Export `/api/meetings/[id]/pdf` ist sitzungsgebunden und ausschließlich Eigentümern/Admins zugänglich: sämtliche sichtbaren Tagesordnungs-TOPs einschließlich vertraulicher Inhalte, deren eigene Texte und freigegebene Dateinamen. Die Darstellung bleibt unabhängig von der optionalen Wordvorlage. Gewöhnliche Kartenreferenzen werden nicht expandiert; Finanz-Unter-TOPs ergänzen die unten beschriebenen Finanzangaben nach aktuellen Board-/Feldrechten des Exportierenden. Downloads `/api/meeting-document/[id]` und PDF-Export sind ausschließlich sessiongebunden, mit no-store/no-referrer; keine Erweiterung der Bearer-API oder MCP-Scopes. Neue Kernlogik: `lib/meetings/`; Migrationen `0073_standalone_meetings.sql` und `0074_meeting_areas.sql`. Die Bereichsmigration legt für jede bestehende Sitzung einen eigenen Bereich mit exakt ihren bisherigen Freigaben an; gleiche Bezeichnungen werden niemals automatisch zusammengeführt. TOPs, Dokumentpfade und IDs bleiben erhalten.

Prüfungen: `tests/meetings-db.test.ts` und `tests/browser/meetings-production.cjs`, ausschließlich mit isolierter migrierter PostgreSQL-Testdatenbank und temporärem Upload-Verzeichnis. Einladungsversand, Kalenderexport und Protokolleditor gehören nicht zu dieser ersten Version.


Sitzungs-UI verwendet dieselben Komponenten wie Boards: `DatePicker` (Kalender) mit den vorhandenen `Select`-Feldern für Uhrzeiten, `FileInput`, `Avatar`, `ACCESS_LEVEL_OPTIONS`, `CollapsibleSection` und `DeleteConfirm`. Bereichsfreigaben haben dieselbe Nutzer-/Gruppenauswahl sowie direkte Rechteänderungs- und Entfernen-Zeilen wie Board-Freigaben. Prüfen mit `tests/meeting-areas-migration.test.ts` (zusätzliche leere Upgrade-Testdatenbank über `TEST_MEETING_AREA_MIGRATION_DATABASE_URL`) und `tests/browser/meetings-production.cjs`.

Sitzungsunterlagen verwenden `MeetingDocumentLink`: PDFs öffnen den vorhandenen `AttachmentLink`/`PdfViewerModal` mit `editable=false` ohne kartenbezogene Editor-Endpunkte. Andere MIME-Typen sind normale Downloads, einschließlich Bildern. Der sessiongebundene Datei-Endpunkt behält seine bisherigen Berechtigungen und Download-Header.


### Unter-TOPs

Migration `0075_meeting_subtopics.sql` ergänzt `meeting_topics.parent_id`. Unterstützt wird genau eine Ebene: Haupt-TOP und Unter-TOP. Nur Bereichsschreiber/Verwaltung können Unter-TOPs neu anlegen oder vorhandene Vorschläge beim Einplanen zuordnen. Lesende Vorschlagende können auch mit manipulierten Requests ausschließlich normale TOPs einreichen. Ein Haupt-TOP mit Kindern kann nicht selbst untergeordnet werden. Selbstbezüge, andere Sitzungen und weitere Ebenen werden auch durch einen DB-Trigger abgewiesen.

Gemeinsame Reihenfolge/Nummerierung über `lib/meetings/agenda.ts`: 1, 1.1, 1.2, 2. Haupt-TOPs bewegen ihre sichtbaren Unter-TOPs als Gruppe; Unter-TOPs werden innerhalb ihrer Gruppe sortiert, die Zuordnung wird im TOP geändert. Die eigene Dauer des Haupt-TOPs und die Dauern seiner Unter-TOPs werden addiert. Ein Unter-TOP erscheint nur in der Tagesordnung, wenn er und sein Haupt-TOP eingeplant/behandelt sind. Der PDF-Export verwendet dieselbe Hierarchie und Nummerierung.

Vertraulichkeit eines Haupt-TOPs schützt auch seine Unter-TOPs und Dateien. Loslösen aus einem vertraulichen Haupt-TOP erfordert eine ausdrückliche Freigabe. Beim Löschen eines Haupt-TOPs bleiben Unter-TOPs eigenständig erhalten; geerbte Vertraulichkeit wird dabei als eigene Vertraulichkeit festgeschrieben. Übernahme in spätere Sitzungen kopiert einen Haupt-TOP mit den zugänglichen Unter-TOPs samt Dateien; der Quell-TOP bleibt als historischer Datensatz erhalten und wird bei bisherigem Status `scheduled` aus der Quellübersicht ausgeblendet.

## Laufende SSO-Prüfung und lokale Nutzersperren

Die gemeinsamen Board-, Finanz- und Inventar-Berechtigungshelfer weisen deaktivierte
Konten einschließlich Eigentümern und Admins ab. Das gilt auch bei stellvertretender
Prüfung für Finanzquellen: Ein deaktivierter Finanzboard-Eigentümer vermittelt keine
Quellrechte. Rollenänderungen prüfen nach Erwerb der Admin-Sperren erneut die aktuelle
Rolle und Aktivierung der handelnden Person; zwischenzeitlich entzogene Rechte können
nicht durch eine bereits gestartete Anfrage wiederhergestellt werden.

`resolveSessionUser` prüft für jede Browser-Anfrage die aktuelle lokale Aktivierung und `session_version` aus der DB. Das Cookie enthält dieselbe Versionsnummer; alte Cookies ohne Nummer gelten als Version 0. Eine lokale Deaktivierung/Reaktivierung erhöht die Version. Die serverseitige Admin-Action sperrt aktive Admins und Zielkonto transaktional, schützt das eigene/letzte Admin-Konto. Inhalte, Eigentum und Freigaben bleiben erhalten. Lokale Deaktivierung greift auch für bestehende API-/MCP-Tokens über deren bestehende `isActive`-Prüfung. Ihre unabhängigen Token-Verträge werden nicht erweitert.

Neue Browser-Anmeldungen fordern `openid profile email offline_access` mit Zustimmung an. Der Login-Callback verlangt ein Refresh-Token mit Offline-Berechtigung, prüft das ID-Token und bindet dessen Subject an den Hash des erhaltenen Refresh-Tokens im verschlüsselten Cookie. Das Cookie enthält eine feste Ablaufzeit von 14 Tagen. Profilaktionen verlängern diese Frist nicht. Kurzlebige Access-Tokens werden bei neuen Anmeldungen nicht gespeichert; „Profil neu abgleichen“ bezieht bei Bedarf über den Refresh-Grant ein neues Access-Token. Ein ID-Token dient nur als Logout-Hinweis und kann bei großen Cookies entfallen. SSO-Tokens werden nicht in der DB gespeichert.

`lib/auth/sso.ts` prüft bei aktiver Nutzung spätestens alle fünf Minuten über den Discovery-`introspection_endpoint` den aktuellen Status des Offline-Refresh-Tokens. Der vertrauliche Client authentifiziert sich mit Client-ID/Secret. `active`, `client_id`, ein vorhandenes `sub` und ein positiver `exp` müssen passen. Keycloaks Offline-Token mit `token_type:Offline` und `exp:0` wird bis zur festen Gremio-Ablaufzeit akzeptiert. Fehlt das optionale `sub`, gilt die beim verifizierten Code-Austausch versiegelte Subject-/Token-Bindung; bei älteren Sitzungen ohne Bindung ist ein passender Live-UserInfo-Nachweis nötig. Ein expliziter Widerspruch wird niemals überschrieben. Ergebnisse werden höchstens fünf Minuten ab Prüfbeginn und nie über die Gremio-/Tokenfrist hinaus gecacht. Nur Hashes und Ergebnisse liegen im begrenzten Prozesscache; parallele Prüfungen werden zusammengefasst. Fehler/negative Ergebnisse werden fünf Sekunden gecacht und berechtigen nicht zum Zugriff. Auch der Callback verlangt eine erfolgreiche Live-Prüfung.

Der Provider muss Offline-Zugriff und Introspection unterstützen und bei Nutzerlöschung, Deaktivierung oder Widerruf der Offline-Berechtigung `active:false` liefern. Der Client und die Nutzer benötigen `offline_access`; Offline-Leerlauf-/Maximalfristen müssen mindestens 14 Tage erlauben. Normale SSO-Web-Logouts und das Ende der normalen SSO-Sitzung widerrufen die Offline-Berechtigung nicht: Gremio bleibt bis zu 14 Tage angemeldet. Gremio-Logout widerruft sein Refresh-Token. Provider ohne diese Semantik müssen separat geprüft werden. Das Introspection-Ziel liegt unter derselben Origin wie der konfigurierte interne Issuer. Netzwerkfehler und fehlende Unterstützung sperren nach Ablauf der letzten Bestätigung den Zugriff.

Geschützte Board- und Inventar-SSE-Verbindungen prüfen bei jeder Änderungsnachricht und alle 25 Sekunden beim Heartbeat dieselbe SSO-/lokale Sitzungsprüfung und aktuelle Board-Rechte erneut. Bei Ablehnung/Fehler werden sie geschlossen. Öffentliche Status-Streams bleiben unverändert. Bereits ausgelieferte Inhalte und bereits zugelassene Aktionen werden nicht zurückgenommen. Separate Bearer-API-/MCP-Anmeldungen erhalten keine neue SSO-Token-Abhängigkeit; sie werden durch lokale Deaktivierung gesperrt.

Sitzungsoberfläche: Bereichsübersicht mit getrennten anstehenden/vergangenen Sitzungen, kompakte Termindaten, Tagesordnung als Standardansicht und separate Reiter für Vorschläge, vertagte und zurückgezogene Themen. Lesende reichen TOPs über einen Dialog ein; bei abgelaufener Frist oder abgeschlossener Sitzung entfällt die Einreichung. Schreibende können Vorschläge/vertagte TOPs über `scheduleTopicAction` mit aktueller Sitzungsrevision direkt einplanen; die bestehende `saveTopic`-Berechtigungs-/Vertraulichkeitsprüfung bleibt maßgeblich und Inhalte werden unverändert übernommen. TOP-Seiten zeigen zunächst Inhalte/Unterlagen; Bearbeitung erfolgt im Dialog. Kartenverknüpfungen und Übernahmefunktionen werden nur bei Bedarf aufgeklappt. Alle Zähler/Client-Daten basieren auf aktuell sichtbaren TOPs.

## Mehrfacheigentümer und Empfangsbestätigungen

`lib/board-ownership.ts` ist der gemeinsame Writer für Ernennung, Austritt und Admin-Entzug für alle drei Boardarten. Die Ressource wird transaktional gesperrt; aktive Rolle, tatsächliche Eigentümerliste, Texteingabe und mindestens ein verbleibender Eigentümer werden live geprüft. `owner_id` bleibt für bestehende Integrationen und die bisherige Finanz-Quellfreigabe als ein tatsächlicher Eigentümer erhalten. Die übrigen Eigentümer stehen in FK-gesicherten Zuordnungstabellen. Inventar und Leih-Systemboard verwenden dieselben Eigentümer. Eigentümerrechte werden zentral auch für Boardlisten, Mitgliederlisten, Karten-/Dateiverwaltung, API und MCP ausgewertet; Bearer-Scopes und Boardbeschränkungen bleiben einschränkend. Es gibt keine neue externe API zur Eigentümerverwaltung.

Unter `/admin/empfangsbestaetigung` verwalten ausschließlich Admins `receipt_branding` (Organisation, normalisiertes PNG-Logo). PNG/JPEG bis 2 MB werden geprüft, begrenzt dekodiert und ohne Metadaten als PNG gespeichert. Die private sessiongebundene Vorschau `/api/receipt-logo` ist nur Admins zugänglich. `buildConfirmationPdf` und `buildFeedbackConfirmationPdf` erhalten das Branding für öffentliche Downloads und E-Mail-Anhänge gleichermaßen; die PDF-Builder selbst benötigen keine DB. Das gemeinsame A4-Brieflayout enthält Vorgangsnummer, Eingangsdatum, Absender, vertraulichen klickbaren Status-Link sowie Seitenzahlen und wiederholten Briefkopf auf Folgeseiten. Die Empfangs-E-Mail erhält zusätzlich eine maskierte HTML-Version und ein optionales eingebettetes CID-Logo; Statusbenachrichtigungen und SMTP-Transportregeln bleiben unverändert. Das originäre geometrische Testlogo in `tests/fixtures/receipt-logo.svg` ist CC0.

## Appweite Live-Aktualisierung

`components/AppLiveRefresh.tsx` koordiniert im Root-Layout Live-Aktualisierungen. In `/intern`, `/finanzen`, `/admin` und `/vorlagen` wird genau eine cookiegebundene SSE-Verbindung pro Tab zu `/api/app/stream` gehalten; einzelne interne Board-Subscriptions entfallen. Öffentliche Status-/Inventarstreams bleiben unverändert berechtigt und reichen ihre Aktualisierung an denselben Eingabeschutz weiter.

Migrationen 0078/0079 installieren Statement-Trigger mit Transition Tables auf fachlichen Tabellen einschließlich Freigaben, Eigentümern, Sitzungen, Vorlagen, Kontoeinstellungen und Versandstatus. Leere Schreibanweisungen melden nichts, PostgreSQL liefert nur nach Commit. Rein technische OAuth-/Idempotenzdaten und reine `last_used_at`-Updates von API-Tokens/MCP-Grants lösen keine Neuabfrage aus. Die Benachrichtigung ist vollständig inhaltsfrei: keine Tabellen, IDs, Namen, Tokens, Datensätze oder Zähler werden übertragen. `lib/app-realtime.ts` verwendet eine LISTEN-Verbindung je Prozess und bündelt Meldungen. Nach Reconnect wird nachgezogen. Die globale SSE-Obergrenze gilt weiterhin, aktive lokale Sitzung/Version und SSO werden pro Meldung und Heartbeat erneut geprüft. Jeder RSC-Refresh prüft die aktuellen Ressourcenrechte unabhängig vom Stream. `/api/app/stream` ist keine Bearer-/MCP-API.

`LiveRefreshGuard` erfasst Formulardaten ausschließlich flüchtig im aktuellen Browser-Tab, ohne Übertragung oder persistente Speicherung. Refreshes warten bei aktiven Eingaben, geänderten Formularen, Dialogen, Popovers, Drag-and-drop, PDF-/Haushaltsentwürfen und laufendem Autosave. Nach Speichern, Zurücksetzen oder Schließen werden vorgemerkte Änderungen nachgezogen. Unveränderte fokussierte Felder, offene Dialoge und laufende Aktionen verzögern Updates still. Der Hinweis „Neue Änderungen verfügbar“ erscheint erst bei einem tatsächlichen Änderungsereignis und einem mindestens kurzzeitig bestehenden ungespeicherten Entwurf; Fokus und Wiederverbindung allein lösen ihn nicht aus. Vorübergehend deaktivierte Formularfelder beim Speichern verändern den Entwurfsvergleich nicht. Filter/Suchzustände werden von Entwürfen unterschieden; React-Zustände/Scrollposition bleiben beim `router.refresh()` erhalten. Spezielle Editoren markieren `data-live-refresh-block` bzw. `data-live-refresh-dirty`; neue Editoren müssen diesen Schutz für außerhalb nativer Formulare verwaltete Entwürfe ebenfalls setzen. Hintergrundtabs und Offline-Zeiten lösen keine automatischen RSC-Abfragen aus; Fokus, Sichtbarkeit und Wiederverbindung holen den aktuellen Stand nach.

## Finanzanträge in der Tagesordnung

Sitzungsbereiche können ein reguläres Antragsboard (`meeting_areas.finance_board_id`), mehrere Quellspalten (leere Auswahl = alle) und eine Zielspalte verknüpfen. Die Konfiguration erfordert Bereichsverwaltung und Verwaltungsrechte auf dem Quellboard. Ein Haupt-TOP je Sitzung wird ausdrücklich als Finanzanträge-TOP markiert; ein partieller Unique-Index schützt diese Eindeutigkeit. `lib/meetings/finance.ts` plant nicht archivierte Karten aus den konfigurierten Spalten mit Schreibrechten sowohl für Sitzung als auch Board als Entscheidungs-Unter-TOPs ein. Ein Sitzungsdatum ist erforderlich. Sitzungsrevision, Doppel-Einplanung, Unter-TOP, Kartenverknüpfung, Statuswechsel und das aktivierte Kartenfeld `meeting` (Sitzungsdatum in Europe/Berlin) werden gemeinsam transaktional geschrieben. Bei unveränderter Zielspalte bleibt die Kartenposition bestehen. Statuswechsel führen anschließend die bestehenden Datums-/Zuweisungs-/Archivtrigger aus. Haushaltspositionen, Beträge und Budgetrevision bleiben unberührt. Entfernen eines Unter-TOPs löscht/verschiebt die Karte nicht zurück und löscht ihr Sitzungsdatum nicht.

Finanz-Unter-TOPs speichern ausschließlich einen neutralen Titel und eine FK-gesicherte Kartenreferenz, keine Kopie geschützter Kartendaten. `finance-projection.ts` löst Antragsnummer + Kartentitel sowie Antragsteller, Konto, Haushaltstitel und beantragten Betrag bei jedem Lesen mit aktuellen Board-/Feldrechten auf. Mehrere Haushaltspositionen werden mit ihren Konten/Titeln und der kanonischen beantragten Gesamtsumme angezeigt. Fehlender Boardzugriff oder gelöschte Karten ergeben einen neutralen Platzhalter ohne Kartenlink. Der PDF-Export enthält diese Finanzprojektion einschließlich klickbarem internem Kartenlink nur für den berechtigten Exportierenden; gewöhnliche Kartenverknüpfungen werden weiterhin nicht expandiert, vertrauliche TOPs sind für Eigentümer/Admins enthalten. Ein Export kann daher je nach Boardrechten unterschiedliche Angaben enthalten. Bereichsfreigaben erweitern niemals Kartenrechte. Finanz-TOPs können als Vorschläge in spätere Sitzungen übernommen werden. Ein eigenständiger Finanz-Unter-TOP benötigt dort einen bestehenden Finanz-Haupt-TOP, ein übernommener Haupt-TOP darf nicht mit einem anderen aktiven Finanz-Haupt-TOP kollidieren. Erst erneutes Einplanen aktualisiert die Karte über den gemeinsamen Finanz-Writer mit aktuellen Board-Schreibrechten. Umhängen von Finanz-Unter-TOPs und Entfernen der Finanzmarkierung/des Haupt-TOPs mit noch eingeplanten Finanzanträgen werden weiterhin abgewiesen. Die externen Bearer-/MCP-Verträge werden nicht erweitert. Migration 0080 ergänzt die Felder/Constraints; vorhandene Live-Trigger auf Bereichen und TOPs erfassen die Änderungen automatisch.

### Standort- und umfragebezogene Empfangsbestätigungen

Migration 0081 ergänzt auf `locations` und `feedback_areas` jeweils `receipt_branding_enabled`, `receipt_organization` und `receipt_logo_png`. In `/admin/standorte` und `/admin/umfragen` gibt es pro Eintrag einen zunächst zugeklappten Bereich „Empfangsbestätigung gestalten“. Die gemeinsame `ReceiptBrandingForm` und der gemeinsame Admin-Writer verwenden dieselbe Namens-/Bildvalidierung wie der instanzweite Standard (PNG/JPEG bis 2 MB, normalisiertes PNG ohne Metadaten). Die eigene Gestaltung ist ausdrücklich aktivierbar; ausgeschaltet bleibt der globale Standard maßgeblich. Gespeicherte eigene Werte bleiben beim Ausschalten für spätere Wiederverwendung erhalten. Eine aktive eigene Gestaltung erbt kein globales Logo; ohne eigenen Gremiennamen gilt der Standort-/Umfragenname. Inventaranfragen und nicht angepasste Standorte/Umfragen verwenden weiterhin den instanzweiten Standard.

`getReceiptBranding(scope)` löst die tatsächliche Formularquelle auf, nicht das Ziel-Board. Zwei Standorte/Umfragen auf demselben Board können dadurch unterschiedliche Briefköpfe haben. Die Bestätigungswarteschlange speichert dazu eine interne `receiptScope` mit Typ und Quell-ID. Der PDF-Download für Anträge nutzt `cards.location_id`, für Feedback die unveränderliche Zuordnung in `feedback_submissions.area_id`. Bei gelöschter Quelle oder alten Jobs ohne Quellangabe gilt der globale Standard. PDF-Downloads und E-Mail-Anhänge verwenden dieselbe Auflösung zum jeweiligen Erzeugungszeitpunkt; keine zusätzlichen Logo-Kopien in den Versanddaten. Globale SMTP-Konfiguration, Versandaktivierung und Statusmails bleiben unverändert. Öffentliche Listen-/API-Projektionen enthalten keine neuen Einstellungs- oder Bildfelder. Die vorhandenen Live-Trigger erfassen die Einstellungsänderungen.

Die private Admin-Logovorschau `/api/receipt-logo` unterstützt zusätzlich `?kind=location|feedback&id=...`; sie zeigt nur das gespeicherte eigene Logo und ist weiterhin ausschließlich Admin-Sessions zugänglich. `lib/receipt-copy.ts` bündelt die persönliche Du-Ansprache für PDF, Text- und HTML-E-Mail, getrennt nach Antrag, Inventaranfrage und Feedback, einschließlich Status-Link, Vertraulichkeitshinweis und Hinweis auf die noch ausstehende inhaltliche Entscheidung.

## TOP-Verlauf und persönliche Vorschläge

Migrationen 0082/0083 ergänzen `meeting_topics.origin_topic_id` (privater Ursprung), `previous_topic_id` (unmittelbarer Vorgänger), `transferred` und `hidden_after_transfer`. Es werden keine früheren Verläufe erfunden. Der private Ursprung bleibt bei Vorschlägen mit `meeting_id = NULL` bestehen; ein neuer Teilnehmerkreis erhält einen eigenständigen vorgeschlagenen TOP samt bewusst freigegebener Dateikopien und weiterhin geschützter Kartenreferenzen. Lesende dürfen eigene Themenspeicher-Einträge bis zur Einreichungsfrist vorschlagen. Ein privates Thema hat höchstens einen aktiven, nicht weitergegebenen vorgeschlagenen/eingeplanten Sitzungseintrag. Ursprungssperre, Sitzungsrevisionen und erneute Statusprüfung verhindern parallele Doppel-Einplanungen. Eine weitere Einreichung nach Vertagung/Zurückziehen hängt im Verlauf am letzten Sitzungseintrag.

`setTopicStatus` ändert ausschließlich den Status, ohne Inhalt, Dateien oder Vertraulichkeit zu ersetzen. Die Sitzungsübersicht bietet dafür eine direkte Auswahl bei jedem bearbeitbaren TOP. „Vertagt“ ersetzt den bisherigen gemischten Reiter „Zurückgestellt“; „Zurückgezogen“ hat einen eigenen Reiter. Unter-TOPs, deren Haupt-TOP nicht eingeplant ist, bleiben in dessen Statusgruppe sichtbar. Vertagte Unter-TOPs bleiben zusätzlich in der Tagesordnung; falls ihr Eltern-TOP dort nicht enthalten ist, werden sie für die Darstellung eigenständig nummeriert. Historisch weitergegebene Einträge sind schreibgeschützt. Bei Übernahme in eine andere Sitzung wird die Quelle nur dann aus der Übersicht ausgeblendet, wenn ihr bisheriger Status `scheduled` war; alle anderen Zustände bleiben mit ihrem ursprünglichen Status und einem berechtigungsgefilterten Zielverweis sichtbar. Bei gemischten Haupt-/Unter-TOP-Gruppen gilt dies je Eintrag; verbleibende Unter-TOPs unter ausgeblendeten Eltern werden in der Übersicht eigenständig dargestellt, ohne den Vertraulichkeitsschutz zu verlieren. Auch abgeschlossene Quellsitzungen können in offene Zielsitzungen weitergeben; ihre Inhalte bleiben gesperrt.

`syncPersonalCompletion` verschiebt den privaten Ursprung nach Behandlung einer Sitzungsausprägung aus den aktuellen in die vergangenen persönlichen Themen; der Datensatz wird nicht gelöscht. Wird die Behandlung zurückgenommen und gibt es keine andere behandelte Ausprägung, erscheint er wieder. `history.ts` gibt Sitzungsnamen, Status und Links nur nach aktueller TOP-/Sitzungsberechtigung aus; eine private Ursprungsreferenz verleiht keine zusätzlichen Sitzungsrechte. Vertrauliche Inhalte und Karten bleiben getrennt geschützt. Bei Finanz-Unter-TOPs aktualisiert erneutes Einplanen Status und Sitzungsdatum über `finance-status.ts` in derselben Transaktion; Board-Schreibrechte und aktiviertes Datumsfeld bleiben maßgeblich. Aktive Finanz-Unique-Indizes ignorieren historische weitergegebene Einträge. Die Finanzantragsauswahl hat keine Suche und keine willkürliche 100-Karten-Abschneidung mehr. Der Sitzungsstatus `closed` heißt in der Oberfläche „Abgeschlossen (Protokoll veröffentlicht)“; der gespeicherte Wert bleibt kompatibel. Keine Erweiterung von Bearer-API oder MCP. Vorhandene App-Live-Trigger erfassen sämtliche Änderungen.

### Dauerhaftes Aktivitätsprotokoll im Themenspeicher

Migration 0084 ergänzt `meeting_topic_activity` mit privatem Ursprung, referenzierter Sitzungsausprägung, Status, Ereigniszeitpunkt und einer Kennzeichnung für übernommene Altstände. Datenbanktrigger protokollieren die Erstellung einer Sitzungsausprägung sowie tatsächliche Änderungen von Status bzw. Zuordnung innerhalb derselben Transaktion. Dadurch bleiben „Vorgeschlagen“, „Eingeplant“, „Vertagt“, erneutes Vorschlagen, Behandlung und spätere Rücknahmen als getrennte Ereignisse erhalten. Gleicher Status oder reine Inhalts-/Weitergabemarkierungsänderungen erzeugen keine doppelten Ereignisse. Rollbacks verwerfen auch das Ereignis. Es gibt keine UI-/API-Funktion zum Bearbeiten einzelner Ereignisse. Die bisherigen App-Live-Benachrichtigungen werden auch für die neue Tabelle eingerichtet.

`personalTopicHistory` liest diese Ereignisse chronologisch nach Ereigniszeit und ID, statt den jeweils aktuellen Status der Sitzungseinträge zu einer vermeintlichen Historie umzudeuten. `TopicTrail` zeigt jeden Schritt mit Sitzung und Zeitpunkt. Namen und Links werden weiterhin nur nach aktuellen TOP-/Sitzungsrechten aufgelöst; gelöschte oder nicht mehr zugängliche Ausprägungen werden nicht offengelegt. Fremde persönliche Ursprünge bleiben gesperrt. Normale Zielverweise in Sitzungsübersichten zeigen dagegen weiterhin den aktuellen Zustand der Zielsitzungsausprägung. Bei ausdrücklichem Löschen eines persönlichen Ursprungs werden auch dessen Ereignisse entfernt; beim Löschen einer Sitzungsausprägung bleiben die Ereignisdatensätze mit leerer Referenz erhalten, werden aber nicht als zugänglicher Verlauf ausgegeben.

Vorhandene Sitzungsausprägungen erhalten ausschließlich einen als solchen gekennzeichneten bekannten Altstand. Überschriebene frühere Zustände werden nicht rekonstruiert oder mit erfundenen Zeitpunkten versehen. Die Oberfläche zeigt dafür „Bisheriger Stand“ und einen Hinweis auf den unbekannten früheren Änderungszeitpunkt. Ab der Migration ist jede tatsächliche Zustandsänderung ein zusätzliches Ereignis. Das Einsortieren behandelter Themen unter „Vergangene Themen“ und die Aufbewahrung vertagter TOPs bleiben unverändert.

### Vergangene persönliche Themen

`personalTopics(user, "active" | "past")` trennt die eigenen privaten Ursprünge nach Behandlung, ohne sie zu löschen oder den Zugriff zu erweitern. Der persönliche Themenspeicher zeigt aktuelle Themen und einen zugeklappten Bereich „Vergangene Themen“ mit eigenem Zähler, Titel/Detail-Link, Behandelt-Markierung und demselben vollständigen, berechtigungsgefilterten Aktivitätsprotokoll. Vergangene Einträge bieten keine erneute Vorschlagsaktion an. Wird die Behandlung der Sitzungsausprägung zurückgenommen und der private Ursprung wieder aktiv, wechselt er automatisch aus dem vergangenen in den aktuellen Bereich zurück. Der Gesamtzähler enthält beide Bereiche. Es sind keine Schema- oder API-/MCP-Vertragsänderungen erforderlich.

### Zurückgezogene TOPs und privates Erledigen

Zurückgezogene TOPs bleiben wie vertagte in Tagesordnung, PDF und eigenem Reiter erhalten und tragen dieselbe rote Statusdarstellung. Anders als vertagte TOPs werden sie nicht in andere Sitzungen übernommen, auch nicht als Kind eines weitergegebenen Haupt-TOPs. Der Status einer zurückgezogenen Sitzungsausprägung bleibt sowohl über die schnelle Auswahl als auch im vollständigen TOP-Formular nach den normalen Schreibrechten und Revisionsregeln änderbar. Die einreichende Person kann stattdessen ihr persönliches Thema als neuen Vorschlag einreichen. Bei einem neuen Vorschlag oder privaten Abschluss bleibt der zurückgezogene Quell-TOP unverändert. Wird er über die Statusauswahl wieder aktiv eingeplant oder vorgeschlagen, wird ein privater Erledigt-Vermerk aufgehoben, damit das Thema wieder im aktuellen Themenspeicher erscheint.

Migration 0085 ergänzt `meeting_topics.resolved_at` für einen persönlichen Abschluss und den Aktivitätstyp `resolved`. `resolvePersonalTopic` ist ausschließlich für die eigene private Herkunft zulässig, wenn die letzte Sitzungsausprägung zurückgezogen ist, aktuell zugänglich ist und kein aktiver Vorschlag/eingeplanter Eintrag existiert. Abschlusszeitpunkt und zusätzlicher Aktivitätseintrag werden gemeinsam gespeichert. Der persönliche Ursprung erscheint danach unter „Vergangene Themen“ als „Erledigt“; die Sitzungsausprägung bleibt weiterhin „Zurückgezogen“. Wiederholter Abschluss ist idempotent. Erledigte private Themen können nicht erneut vorgeschlagen werden.

Eigene direkt in Sitzungen eingereichte zurückgezogene TOPs ohne privaten Ursprung erscheinen ebenfalls im aktiven persönlichen Speicher, jedoch nur mit aktuellem Zugriff auf den Quell-TOP. `personalTopicForAction` übernimmt sie bei Neu-Vorschlag oder Abschluss in einen privaten Ursprung, ohne ihren Sitzungsstatus zu ändern. Inhalte, zugängliche Kartenreferenzen und Dateikopien werden unter erneuter Berechtigungsprüfung übernommen; Vertraulichkeit einschließlich Elternschutz bleibt gewahrt. Dateioperationen liegen außerhalb der DB-Sperren, Fehler und verlorene Parallelrennen räumen nur die neu angelegten Kopien auf. Die bestehende Zurückziehung wird als bekannter Altstand mit unbekanntem früherem Zeitpunkt markiert, nicht als erfundenes neues Ereignis. Ab dann bleibt die vollständige Aktivität chronologisch erhalten. Die persönlichen Aktionen bleiben sessiongebundene Server Actions; keine Erweiterung der externen APIs oder MCP-Rechte.

Weitergaben erhalten `created_by` als ursprüngliche einreichende Person statt die aktuell planende Person einzutragen. Migration 0086 stellt diese Zuordnung für vorhandene Kopien anhand der gespeicherten Vorgängerkette wieder her; Zyklen werden abgefangen, gelöschte/unbekannte ursprüngliche Personen werden nicht geraten. Die Sitzungsberechtigung bleibt unabhängig davon unverändert und wird für persönliche direkte Zurückziehungen weiterhin geprüft.

Der Themenspeicher ordnet seine Inhalte als „Thema anlegen“, aktuelle Themen und vergangene Themen. Jeder aktuelle und vergangene Themeneintrag verwendet eigene, standardmäßig geschlossene native Details mit Titel/Status in der Zusammenfassung; Verlauf, Detail-Link und gegebenenfalls Aktionen werden erst beim Aufklappen sichtbar. Native Tastaturbedienung und offene Zustände bei Live-Aktualisierungen bleiben erhalten.

Die Löschaktion eines privaten Themas heißt in Button und Bestätigungsdialog „Thema löschen“. Der Dialog erläutert, dass das persönliche Thema samt Unterlagen und Verlauf gelöscht wird, während bereits vorgeschlagene oder eingeplante Sitzungsausprägungen erhalten bleiben. Bei Sitzungs-TOPs lautet die Aktion weiterhin „TOP löschen“; maßgeblich ist der geöffnete Datensatz, unabhängig von zusätzlichen Schreibrechten der Person.

Sitzungsoberflächen verwenden für Status-/Formularauswahlen und Datumspicker die vorhandenen portalierten `AnchoredPopover`-Menüs. Diese verlassen abgeschnittene Listen und scrollbare Dialogkörper, öffnen bei wenig Platz nach oben und bleiben innerhalb des Viewports. Die Tagesordnung ordnet Griff/Nummer auf schmalen Bildschirmen oberhalb des Inhalts an, damit Unter-TOPs und ihre Aktionen die verfügbare Breite nutzen. Bereichsfreigaben begrenzen flexible Formulare und Auswahlfelder auf die Containerbreite; Avatare behalten ihre Größe, lange Namen, Sitzungsorte und Verlaufstitel umbrechen. Aktionsbuttons dürfen bei wenig Platz oder vergrößerter Schrift mehrzeilig werden, ohne Text abzuschneiden. Die Rechte und Speicherabläufe bleiben unverändert.

Sitzungsaktionen verwenden einheitlich die normale Kontrollhöhe (`min-h-10`) und Textgröße statt einer Mischung mit kleinen Buttons. Aktionszeilen richten Controls am oberen Rand aus, damit Speicher- oder Fehlerhinweise unter der Statusauswahl die benachbarten Buttons nicht vergrößern. Reicht die Breite für eine vollständige Aktionszeile nicht, wechseln Controls in die nächste Zeile; lange Beschriftungen bleiben mehrzeilig lesbar. Kompakte Freigabeformulare behalten die Ausrichtung am unteren Feldrand und verwenden ebenfalls die normale Buttonhöhe.

## Öffentliche und nicht öffentliche Tagesordnungsbereiche

Migration `0088_meeting_agenda_sections.sql` ergänzt `meeting_topics.section` (`public` / `non_public`). Jede Sitzung zeigt beide Bereiche, auch wenn einer leer ist. Bestehende TOPs bleiben öffentlich eingeordnet; der separate Vertraulichkeitsschutz bleibt unverändert. Beide Bereiche sind für die nach bisherigen Regeln berechtigten Sitzungsteilnehmer sichtbar. Nicht öffentlich bedeutet keine zusätzliche Zugriffsbeschränkung und wird niemals automatisch als vertraulich behandelt.

Vorschlagende erhalten keine zusätzliche Auswahl; lesende Einreichungen und persönliche Themen starten mit `public`. Die Sitzungsplanung entscheidet beim Einplanen über „Einplanen: öffentlich“ / „Einplanen: nicht öffentlich“ und kann den Bereich im TOP-Formular ändern. Unter-TOPs einschließlich Finanzanträgen übernehmen den Bereich ihres Haupt-TOPs; DB-Trigger erzwingen und aktualisieren diese Zuordnung auch für nicht sichtbare Kinder. Beim Loslösen oder Löschen des Haupt-TOPs bleibt die zuletzt gespeicherte Einordnung erhalten. Vertagung, Zurückziehen, erneutes Einplanen und Weitergabe bewahren den Bereich und verwenden die bestehenden Status-, Rechte-, Unterlagen- und Verlaufsregeln.

Unter Bereichseinstellungen → Tagesordnung verwalten Eigentümer/Admin `public_numbering`, `non_public_numbering` (`arabic` / `roman`) und `first_section`. Standard: öffentlich zuerst, öffentliche Haupt-TOPs 1, 2, 3; nicht öffentliche Haupt-TOPs I, II, III. Regularien und öffentlicher Teil teilen sich eine fortlaufende Nummerierung; der nicht öffentliche Teil beginnt unabhängig bei eins. Unter-TOPs erhalten beispielsweise 1.1 oder I.1. Die Einstellungen gelten unmittelbar für sämtliche Sitzungen im Bereich und erhöhen deren Revisionen. `agenda.ts` steuert Reihenfolge und Nummerierung in Übersicht, TOP-Details und PDF; Zeiten laufen über beide Bereiche weiter. Drag-and-drop sortiert innerhalb eines Bereichs und der bisherigen Haupt-/Unter-TOP-Gruppen. Der sitzungsgebundene PDF-Export enthält beide gekennzeichneten Teile einschließlich vertraulicher Inhalte und ist ausschließlich Eigentümern/Admins zugänglich. Keine Erweiterung externer APIs/MCP.

Prüfungen: `tests/agenda-deferred.test.ts`, `tests/meeting-sections-db.test.ts` und `tests/browser/meetings-production.cjs`; DB-/HTTP-Prüfungen ausschließlich gegen eine isolierte migrierte Testdatenbank.

## Wordexport aus Sitzungsbereichsvorlagen

Migration `0089_meeting_word_templates.sql` ergänzt optionale Vorlagenmetadaten, die Formatvorlagen-/Einfügekonfiguration und eine eigene Vorlagenrevision an `meeting_areas`. Eigentümer/Admins laden unter Bereichseinstellungen → Wordexport eine makrofreie `.docx` oder `.dotx` hoch (max. 25 MB). Die Originaldatei bleibt unter einem eigenen UUID-Pfad unverändert erhalten und ist ausschließlich über den sessiongebundenen Download `/api/meeting-areas/[id]/word-template` für die Bereichsverwaltung abrufbar. Ersetzen/Entfernen sowie Konfigurationsänderungen prüfen die Vorlagenrevision, erhöhen die Sitzungsrevisionen und entfernen alte Dateien erst nach dem Commit. Dateioperationen liegen außerhalb der DB-Sperren.

Die Zuordnung verwendet vorhandene **Absatzformatvorlagen** für Fließtext, Bereichsüberschriften, öffentliche TOPs erster/zweiter Ordnung und nicht öffentliche TOPs erster/zweiter Ordnung. Erkannte Namen (z. B. TOP 1, TOP 2, NÖ TOP 1, NÖ TOP 2) sind nur überprüfbare Vorauswahlen. Ein Musterbereich kann anhand der Absätze/Tabellen begrenzt werden; das gewählte Endelement bleibt erhalten (z. B. Unterschriften). Alternativ wird ein alleinstehender, auch über mehrere Runs verteilter Absatz `{{TAGESORDNUNG}}` ersetzt oder am Dokumentende eingefügt. Bei der mitgelieferten StuRa-Struktur werden Formalien und Unterschriften erhalten und die vorhandenen Seitenabschnitte ihren öffentlichen/nicht öffentlichen Bereichen entsprechend angeordnet; geerbte Kopf-/Fußzeilenreferenzen werden vor dem Umordnen aufgelöst. Andere nicht sicher zuordenbare komplexe Abschnittsstrukturen werden ausdrücklich abgewiesen und erfordern eine vorbereitete Platzhaltervorlage. Die Vorschauauswahl und die exportierte Datei müssen vor offiziellem Einsatz geprüft werden.

`word-template.ts` bearbeitet das bestehende OOXML-Paket gezielt: Originalstile, Themen, Schriftdefinitionen, Kopf-/Fußzeilendateien, Bilder, Beziehungen und andere unveränderte Bestandteile bleiben bytegleich. Neue Nummerierungsinstanzen nutzen die Geometrie der zugeordneten Vorlagenstile und die Bereichseinstellungen; dadurch entsteht keine doppelte manuelle/automatische Nummerierung. DOTX wird durch den Haupt-Content-Type zu einer normalen DOCX. Übernommene Inhaltsverzeichnisse erhalten neue zwischengespeicherte Einträge statt alter Muster-TOPs; `updateFields=false` unterbindet die vom Export angeforderte automatische Feldaktualisierung beim Öffnen, die in Word eine allgemeine Rückfrage zu möglichen externen Dateien auslösen kann. Auch eine aktivierte Vorgabe aus der Vorlage wird überschrieben, unabhängig vom XML-Präfix. Das Inhaltsverzeichnis bleibt ein editierbares Word-Feld und wird nach dem Öffnen manuell über „Felder aktualisieren“ / „Gesamtes Verzeichnis aktualisieren“ mit den korrekten Seitenzahlen gefüllt. Der Server berechnet keine Seitenzahlen und rät keine Werte; es gibt keine neue Laufzeitabhängigkeit. Der Export speichert die Datei nicht durch LibreOffice neu.

Bekannte Textplatzhalter `{{SITZUNGSTITEL}}`, `{{GREMIUM}}`, `{{DATUM}}`, `{{BEGINN}}`, `{{ORT}}`, `{{SITZUNGSLEITUNG}}` werden in ihren Text-Runs ersetzt. Gleichnamige einfache Inhaltssteuerelemente für Datum, Beginn, Ort und Sitzungsleitung werden ohne Neubau ihrer Struktur befüllt; Platzhalterformatierung wird beim Befüllen entfernt. Gebundene/komplexe Steuerelemente werden unverändert belassen. Anwesenheit, Stimmen und unbekannte Protokollangaben werden nicht erfunden. TOP-Beschreibung, Beschlussvorschlag, vorhandene Ergebnisnotiz, Status, Dauer, Vortragende und Unterlagen-Dateinamen sowie berechtigungsgefilterte Finanzangaben werden übernommen; Quelldateien werden nicht eingebettet.

`/api/meetings/[id]/word` liefert den optionalen Wordexport ausschließlich an Eigentümer/Admins. Die Oberfläche zeigt den Link nur bei vorhandener Vorlage/Konfiguration. **PDF- und Wordexport enthalten vertrauliche TOPs**, der Zugriff von Lesenden und gewöhnlichen Schreibenden ist serverseitig gesperrt. Die PDF-Formatierung bleibt erhalten, einschließlich der bestehenden Finanzfeldfilterung; das bisherige Ausschließen vertraulicher TOPs entfällt. Beide Exporte sind sessiongebunden, mit `private, no-store`, `no-referrer` und `nosniff`, ohne Bearer-/MCP-Erweiterung. Parser validieren ZIP-Struktur/CRC, Größen und XML und lehnen DTDs, Makros und signierte Pakete ab. `fast-xml-parser` ist dafür als direkte, bereits transitiv vorhandene Abhängigkeit deklariert.

Prüfungen: `tests/word-template.test.ts` (synthetische alternative Vorlagen; optional `GREMIO_WORD_TEMPLATE_FIXTURE` für ein lokales Original), `tests/meeting-word-db.test.ts` sowie `tests/browser/meeting-word-production.cjs`. Visuelle Vergleiche werden ausschließlich mit temporären Exporten durchgeführt; Originaldateien bleiben unverändert.

## Sitzungsbereichsvorlagen und Standard-TOPs

Migration `0090_meeting_area_templates.sql` ergänzt zentrale `meeting_area_templates`, die unabhängige JSON-Kopie `meeting_areas.default_topics` samt Quelle und Revision sowie `meetings.defaults_applied`. Unter `/vorlagen/sitzungsbereiche` verwalten Admins und Vorlagenverwalter benannte Vorlagen mit Haupt-/Unter-TOPs, Beschreibung, Beschlussvorschlag, Vortragenden, Art, Dauer, Bereich und optionaler Vertraulichkeit. Bereichseigentümer/Admins wählen unter Bereichseinstellungen → Standard-TOPs eine zentrale Vorlage aus und bearbeiten die übernommene Kopie. Änderungen oder Löschung der zentralen Vorlage ändern keine Bereichskopie oder Sitzung. Entfernen der Vorlage setzt lediglich die Quellenreferenz auf NULL. Revisionsprüfungen verhindern veraltete Änderungen. Neue Vorlagen lösen die bestehende inhaltsfreie App-Live-Benachrichtigung aus.

`saveMeeting` sperrt den Bereich beim Anlegen und kopiert dessen aktuelle Standard-TOPs in derselben Transaktion als normale `scheduled`-TOPs mit neuen IDs und Elternbezügen. Für Sitzungen, die noch keine Defaults übernommen haben, gibt es die ausdrückliche Aktion „Standard-TOPs übernehmen“; Sitzungsrevision und `defaults_applied` verhindern parallele oder wiederholte Übernahme. Automatische Nachträge in vorhandene Sitzungen gibt es nicht. Standard-TOPs sind in der Sitzung nach denselben Regeln bearbeitbar, sortierbar, vertagbar und löschbar wie andere TOPs. Leser können weder Vorlagenkonfiguration ändern noch Defaults übernehmen. Vertrauliche Defaults sind nach der Übernahme weiterhin nur für Eigentümer/Admins sichtbar.

`opening` ist der dritte TOP-Bereich für „Begrüßung und Regularien“. Die Übersicht zeigt immer Regularien zuerst, danach öffentlich/nicht öffentlich entsprechend `first_section`. Regularien und öffentliche TOPs verwenden dieselbe fortlaufende Nummerierung gemäß `public_numbering`, z. B. Regularien 1 / 1.1 und später öffentliche TOPs 2, 3; nicht öffentliche TOPs I, II bleiben unabhängig. Unter-TOPs erben auch `opening` durch die bestehenden DB-Trigger. Die bisherige Reihenfolgeoption umfasst weiterhin ausschließlich öffentlich/nicht öffentlich. Word und PDF verwenden dieselbe gemeinsame Agenda-Reihenfolge. In Word werden Regularien ohne doppelte Bereichsüberschrift vor dem ersten vorhandenen Abschnittswechsel eingefügt; die beiden übrigen Seitenabschnitte bleiben ihren Bereichen zugeordnet.

Der Wordexport erzeugt keinen zusätzlichen Dokumenttitel und keinen separaten Block mit Gremium, Beginn oder Sitzungsleitung mehr. Feste Vorlagentitel bleiben erhalten; Sitzungsdaten befüllen nur ausdrücklich vorgesehene Steuerelemente oder Textplatzhalter der Vorlage. Die bisherige Titel-Formatvorlagenrolle entfällt, alte gespeicherte Zuordnungen bleiben ohne Migration lesbar. Finanzkarten erhalten echte externe OOXML-Hyperlink-Beziehungen zu den internen HTTP(S)-Kartenadressen, mit kollisionsfreien Relationship-IDs und vorhandener Hyperlink-Zeichenformatvorlage (sonst Unterstreichung). Es werden ausschließlich aktuell berechtigte Finanzprojektionen verlinkt; normale Text-URLs werden nicht automatisch umgewandelt. Die PDF-Gestaltung bleibt davon unberührt.

Die zentrale Beispielvorlage „StuRa – Begrüßung und Regularien“ kann mit `regularitiesDefaults` aus der gelieferten DOTX angelegt werden. Sie enthält den Haupt-TOP und die fünf Unterpunkte Beschlussfähigkeit, Tagesordnung, fristgemäße Einladung, Protokollbestätigung und Beschlusskontrolle. Enthaltene Platzhalter sind bewusst manuell zu vervollständigender Vorlagentext, keine erfundenen Sitzungsergebnisse. Die Anlage in einer lokalen Instanz erfolgt nur ausdrücklich, nicht automatisch in Migrationen.

Prüfungen: `tests/meeting-area-templates-db.test.ts`, zusätzliche Agenda-/Word-/Finanzregressionen und `tests/browser/meeting-templates-production.cjs`, ausschließlich mit isolierter migrierter Testdatenbank. Kein Ausbau der Bearer- oder MCP-Verträge.


Die Bereichsoption `include_miscellaneous` (Migration `0091_meeting_miscellaneous_topic.sql`) ergänzt bei Übernahme der Standard-TOPs einen öffentlichen Haupt-TOP „Sonstiges“ mit `is_miscellaneous=true`. Enthält die Vorgabe bereits einen öffentlichen Haupt-TOP dieses Namens, wird dieser verwendet statt ein Duplikat anzulegen. Der Haken ist unabhängig von der zentralen Vorlagenauswahl und gilt für neue bzw. ausdrücklich ergänzte Sitzungen. Die Agenda sortiert diesen TOP unabhängig von gespeicherten Positionen immer ans Ende des öffentlichen Teils; weitere öffentliche TOPs werden davor einsortiert. Der TOP besitzt keinen Verschiebegriff. Die serverseitige Reihenfolgeprüfung schützt auch manipulierte Requests. Er kann nicht untergeordnet, in einen anderen Bereich versetzt, als Finanz-Haupt-TOP verwendet oder an andere Sitzungen weitergegeben werden. DB-Constraint und partieller Unique-Index sichern Form und Eindeutigkeit pro Sitzung. Unter-TOPs und Inhalts-/Statusänderungen folgen den normalen Regeln; die Bereichsoption ändert keine schon erzeugten Sitzungen.

PDF- und Word-Tagesordnungsexporte ergänzen direkt unter jedem nicht leeren Beschlussvorschlag die vollständig fett gedruckte Zeile „Abstimmung: Dafür / Dagegen / Enthaltung“. TOPs ohne Beschlussvorschlag erhalten keine Abstimmungszeile.

## Financial agenda motion templates

`meeting_areas.finance_motion_template` (migration `0092_meeting_finance_motion.sql`) stores an optional motion template next to the finance board/status configuration. The settings editor offers visible card fields as insertion buttons and shows a sample-data preview. `finance-motion.ts` defines the explicit placeholder allowlist (`{{requested_amount}}`, `{{title}}`, etc.); unknown or hidden field placeholders are rejected when saving. Amounts use the shared Euro formatter, dates use German day/month/year presentation, and account/budget title fields support multiple budget positions.

Planning copies the template into the new finance child TOP's `motion` in the existing atomic transaction; later changes to area settings affect future planning only. The stored motion retains placeholders, never resolved card data. `projectFinanceTopics` resolves them for each viewer and export using current board access and visible fields; inaccessible values become `Nicht freigegeben`, missing values `—`. This also applies after card deletion or board access revocation. Resolved motions appear in the agenda and TOP details; TOP editing retains the editable placeholder source. Ordinary manually entered text is unchanged. PDF/Word therefore include the resolved proposal and the existing bold voting line.

Area settings opt into `MeetingActionForm.preserveValues` to prevent React's automatic successful-action reset from clearing native input/checkbox state. Finance board drafts use controlled checkboxes, target selection and template text; changing boards retains each board's draft. Saving no longer remounts the finance panel, Word style selects or default-topic editor. The default-topic editor synchronizes changed saved content without remounting; Word style controls reset only when the uploaded file changes; the upload confirmation remains mounted. Upload/create forms keep their existing reset behavior.

Public routing checks the explicitly required card fields before assigning or enabling a location/feedback area. It never silently enables fields. Locations require applicant, submitter_email, finance_request and student_card; optional annex_a/annex_b remain configurable. Feedback requires notes, not email or applicant. Inventory tracking boards require applicant, submitter_email and notes; tracking cards copy the existing borrower contact to the private card email field. Inventory date/quantity/ID requirements stay in the inventory request model. Any linked route (also disabled) locks its required fields until detached. Routing and field updates serialize on the board row; activation rechecks the same target and mandatory fields. Admin editors name missing fields and link to board settings; field settings show locked controls and explain the association. Existing inconsistent boards show a named warning and can be repaired by saving the required fields. No schema migration is needed.
