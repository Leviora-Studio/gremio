# Gremio

Der Bug- und Security-Audit ab einschließlich 4.2.0 ist in
[docs/SECURITY_AUDIT_SINCE_4.2.0.md](docs/SECURITY_AUDIT_SINCE_4.2.0.md)
dokumentiert. Die Korrekturen sichern aktuelle Berechtigungen auch nach
Nutzersperren und Rollenentzug, beschränken das Wiederöffnen abgeschlossener
Sitzungen auf deren Verwaltung, entfernen private PDF-Feldwerte aus Fehlerlogs
und begrenzen kollidierende Archivnamen. Zod 4 und gezielte minimatch-Updates
beheben die gemeldeten Sicherheitslücken der Produktionsabhängigkeiten.

Der ergänzende Audit ab `c6e053a` verhindert eine unbeabsichtigte Ausweitung von
API-Tokens bei veralteter Board-Auswahl und sichert die Token-Obergrenze bei
paralleler Anlage. Ausgeblendete Inventarkategorien und Standortoptionen werden
vor der Browserausgabe entfernt, einschließlich öffentlicher Suchdaten.
Nextcloud-Archivordner verwenden den konfigurierten Namen ohne automatisch
ergänzte Karten-ID. Gleichnamige Ordner und identische Dateien werden
wiederverwendet. Bei anderem Inhalt wird die
Gremio-Datei daneben als `Name_Gremio.ext` abgelegt; weitere Namenskonflikte
erhalten `_Gremio_2`, `_Gremio_3` usw. Vorhandene Dateien werden nie überschrieben.
Abgeschlossene Archive behalten ihre bisherigen Namen.

Das interne Kartenfeld „E-Mail-Adresse“ ist pro Board konfigurierbar und für
Board-Schreiber bearbeitbar. Standort-Zuordnungen aktivieren die Felder des
Antragsformulars automatisch; aktive Standorte schützen diese vor Deaktivierung.
Migration `0087_application_card_fields.sql` ergänzt die Feldkonfiguration
bestehender Boards und korrigiert bereits aktive Standort-Zuordnungen.

### 4.5.0: Board-Ansichten, abgestufte Freigaben und System-E-Mails

Boards bieten zusätzlich gruppierte Listen, Tabellen und Kalender; Suche und
Drag-and-drop-Spaltenreihenfolge unterstützen die jeweilige Ansicht. Personen-
und Gruppenfreigaben unterscheiden lesenden und schreibenden Zugriff. Bestehende
Freigaben erhalten beim Update weiterhin Schreibrechte; das jeweils höhere Recht
gewinnt. Die optionale Bürokraft-Rolle erlaubt bestehenden Lesern ausschließlich
konfigurierte Statuswechsel. API und MCP beachten dieselben Berechtigungen.

Admins konfigurieren instanzweites SMTP und aktivieren Empfangsbestätigungen je
öffentlichem Finanzantrags-, Feedback- oder Inventarboard. Board-Verwaltungen
können pro Spalte E-Mail-Empfänger festlegen. Bestätigungen enthalten den
persönlichen Status-Link und das Eingangs-PDF; der Versand erfolgt über eine
dauerhafte Warteschlange mit Wiederholungen. SMTP und Bestätigungen bleiben beim
Update zunächst ausgeschaltet. Migrationen `0070` bis `0072` werden angewendet.

**Öffentliche Clients anpassen:** Neue Antrags- und Feedback-Einreichungen
benötigen jetzt `email`, auch wenn Bestätigungen ausgeschaltet sind. Die Adresse
bleibt intern; bestehende Einreichungen und Status-Links bleiben erhalten.

### 4.4.0: Trigger-Zuweisungen und PDF-Editor-Korrekturen

Jeder Board-Trigger (Anweisungsdatum, Überweisungsdatum, Nachreichung,
Rückmeldung, Done-Spalte, Nextcloud-Archiv) kann beim Auslösen optional alle
Zuweisungen entfernen und/oder Nutzer zusätzlich zuweisen. Änderungen erscheinen
im Aktivitätsverlauf der Karte. Migration `0069_trigger_assignments.sql` legt
die Tabellen an; bestehende Boards verhalten sich unverändert.

Im PDF-Editor bleiben Zeilenumbrüche erhalten, und „?" erscheint nur noch für
Zeichen ohne Glyphe (z. B. Emoji). Freitext wird zoomunabhängig mit 12 pt gesetzt,
ist in der Größe änderbar, landet auch bei zugeschnittenen PDFs an der richtigen
Stelle und springt nach dem Speichern nicht mehr. Die Signatur-Box sitzt auch auf
gedrehten Seiten korrekt und aufrecht. Ungespeicherte Änderungen werden vor dem
Schließen abgefragt.

### 4.3.0: Verfallene Anträge und Anweisungsdateinamen

Finanzübersichten können pro Quell-Board eine „Spalte für Verfallen“ auswählen.
Karten darin zählen nicht zu den Live-Ausgaben; Antragsübersicht und tatsächliche
Ausgaben bleiben unverändert. Dies gilt auch für Budgetpositionen und Exporte.
Migration `0068_finance_source_expired_status.sql` ergänzt die optionale Auswahl;
bestehende Quellen behalten ohne Auswahl ihre bisherige Berechnung.

Direkt erstellte Anweisungen übernehmen die aktuelle Antragsnummer der Karte:
`<Antragsnummer>_Anweisung1.pdf`, `…_Anweisung2.pdf` usw. Ohne Antragsnummer
heißen sie `Anweisung1.pdf` usw.; bestehende Dateinamen zählen weiter mit.

### 4.2.0: Interne Dateiordner am Ticket

Board-Nutzer mit Schreibrecht können im Anhangbereich Ordner erstellen, Dateien umbenennen
und zwischen dem Ticket-Hauptordner und selbst erstellten Unterordnern verschieben.
Die Dateiendung bleibt erhalten; Dokument-Slots und Sichtbarkeitsregeln gelten
weiterhin. Antragsteller erhalten keine Ordnerverwaltung.

Die Nextcloud-Archivierung übernimmt auch leere Unterordner; das interne ZIP
erhält die Ordnerstruktur der sichtbaren Dateien. Bestehende Cloud-Archive bleiben
Momentaufnahmen. Migration `0067_attachment_folders.sql` ergänzt ausschließlich
Ordner und eine optionale Anhangzuordnung; vorhandene Anhänge liegen zunächst
im Ticket-Hauptordner. Beim Start des aktualisierten Docker-Images wird die
Migration automatisch angewendet. Für lokale Entwicklungsinstanzen gilt
`npm run db:migrate`. Keine neuen Abhängigkeiten oder Umgebungsvariablen.

### Entfernung des Protokoll-Features

Sitzungs- und Ergebnisprotokolle, der zugehörige Markdown-Editor, Protokollvorlagen
und die Verknüpfungen zu Karten wurden entfernt. Migration `0066_remove_protocols.sql`
löscht ausschließlich die neun Protokolltabellen; Karten, Beschlussreferenzen,
Boards, Finanzen und MCP-Verbindungen bleiben erhalten. Historische Migrationen
bleiben für bestehende Installationen unverändert. Vor dem Update Datenbankbackup
und `npm run db:migrate` (bzw. bestehender Containerstart). Alte Nextcloud-Dateien
und lokale Logo-Dateien werden nicht angefasst; etwaige Reste können liegen bleiben.
Die Python-/WeasyPrint-Laufzeit wird im Docker-Image nicht mehr installiert.

### Migration: OAuth und integrierter MCP-Zugang

`0065_mcp_oauth.sql` ergänzt OAuth-Clients, Freigaben, Board-Zuordnungen sowie
gehashte Codes und Tokens. Vor dem Update Datenbankbackup und `npm run db:migrate`
(bzw. bestehender Containerstart). Keine neuen Geheimnisse oder Pflichtvariablen.
MCP liefert direkte Anhang-Downloads und PDF-Text einschließlich Formularwerten
(serverseitiges PDF.js, keine Python-Laufzeit und keine OCR).
MCP ist unter `APP_BASE_URL/api/mcp` erreichbar; Verbindungen werden unter
**Mein Konto → Verbundene Anwendungen** verwaltet. Der vorhandene OIDC-Login bleibt
bestehen. Reverse-Proxy-Anforderungen, Client-Kompatibilität und Token-Lebenszyklus:
[docs/MCP.md](docs/MCP.md). Die interne REST-API erhält Auswahlkataloge, Suche,
Kommentare, lesbaren Verlauf und Anhangzugriff; andere Bereiche bleiben bewusst
ausgeschlossen.

### Migration: Trigger-Zuweisungen

`0069_trigger_assignments.sql` legt `board_trigger_assignments` und
`board_trigger_assignees` an. Jeder Board-Trigger kann damit beim Auslösen alle
Zuweisungen entfernen und/oder Nutzer zusätzlich zuweisen; Änderungen erscheinen
im Aktivitätsverlauf der Karte. Bestehende Boards haben keine Aktionen
hinterlegt, ihr Verhalten bleibt unverändert. Keine neuen Umgebungsvariablen.

### Migration: Verfallen-Spalte für Live-Ausgaben

`0068_finance_source_expired_status.sql` ergänzt die optionale Spaltenauswahl
pro Quell-Board einer Finanzübersicht. Bestehende Quellen haben keine Auswahl;
ihre Berechnung bleibt unverändert. Vor dem Update wie üblich ein
Datenbankbackup anlegen und `npm run db:migrate` ausführen; der Containerstart
verwendet den bestehenden Migrationsablauf. Keine neuen Umgebungsvariablen.

### Migration: Anweisungsformular pro Board

`0063_hot_wolf_cub.sql` ergänzt die pro Board gespeicherte PDF-Vorlage für
Anweisungen. Vor dem Update wie üblich ein Datenbankbackup anlegen und
`npm run db:migrate` ausführen; der Containerstart verwendet weiterhin den
bestehenden Migrationsablauf. Keine neuen Abhängigkeiten oder
Umgebungsvariablen.

### Migration: Haushaltspositionen und öffentliche Uploads

`0062_card_budget_and_public_workflows.sql` ergänzt strukturierte Haushaltspositionen
mit eigener Kontozuordnung und serverseitigen Gesamtsummen, mehrere Quittungsquellen
je Board und einen expliziten Uploadzweck. Bestehende Karten bleiben unverändert im
Einzelmodus; bisherige Quittungs- und Archivkonfigurationen werden übernommen.
Der bisherige Ein-Trigger-Constraint für Board-Vorlagen entfällt. Vor dem Update wie
üblich ein Datenbankbackup anlegen und `npm run db:migrate` ausführen (Containerstart
verwendet weiterhin den bestehenden Migrationsablauf). Keine neuen Abhängigkeiten.

Öffentlich sind genehmigte Gesamtsummen sichtbar, nicht Positionskonten/-details.
Uploads unterstützen sofortige Mehrfachauswahl mit Einzelstatus/Retry; nur der
Quittungsbereich benennt Dateien automatisch um. Bestehende PDF-/Größenlimits gelten.
Fachliche Details stehen in `CLAUDE.md`, API-Kontrakte in `docs/API.md` und
`docs/PUBLIC_API.md`. Der [API-Abgleich seit v2.7.7](docs/API_PARITY_AUDIT.md)
dokumentiert die nachgezogenen Schnittstellenänderungen und die bewusst
unveränderte Abgrenzung zu reinen Web-Funktionen. Neue Karten können per REST
direkt mit Haushaltspositionen angelegt werden; bestehende Einzelkarten bleiben
kompatibel. Coding-Agenten starten bei [AGENTS.md](AGENTS.md).


**Gremio** ist eine Web-App zur Verwaltung von Anträgen in Gremien — z. B.
Studierendenvertretungen, Vereinen, Verbänden oder Ausschüssen. Ein
**öffentliches Antragsformular** speist Anträge je nach Standort in **interne
Kanban-Boards** ein, auf denen das Gremium sie bearbeitet — mit Rollen & Gruppen,
optionaler Nextcloud-Archivierung und einer schmalen REST-API.

Fünf Module teilen sich Nutzer, Gruppen und dasselbe Freigabemodell:

| Modul | Bereich | Kurz |
|-------|---------|------|
| **Kanban / Anträge** | `/intern/board/{id}` | Anträge und beliebige andere Vorgänge auf Boards |
| **Finanzen** | `/finanzen` | Haushaltsplan und Ausgabenauswertung über Quell-Boards |
| **Inventar & Ausleihe** | `/intern/inventar`, `/inventar` | Gegenstände, Leihvorgänge, Anlagenverzeichnis |
| **Vorlagen** | `/vorlagen` | Board- und Finanzvorlagen |

Dazu kommt öffentliches **Feedback** (`/feedback`) als zweiter Eingangskanal
neben dem Antragsformular.

Die persönliche Startseite zeigt Aufgaben, Boards, Finanzübersichten und Inventare. Unter „Startseite anpassen“ lassen sich alle
Abschnitte ein- und ausblenden sowie in eine eigene Reihenfolge bringen.

Stack: **Next.js (App Router) + React + TypeScript**, **PostgreSQL** (`pg` +
Drizzle ORM), Tailwind CSS, `dnd-kit`, `zod`, iron-session, Custom-OIDC-Client
(`jose`), `sharp`, `pdf-lib`, `react-pdf` (Viewer), `@signpdf` + `node-forge`
(PAdES-Signatur), `webdav`.

API-Doku: [docs/API.md](docs/API.md) (interne Bearer-Token-API) ·
[docs/PUBLIC_API.md](docs/PUBLIC_API.md) (öffentliche Antrags- und Feedback-API für native
Apps, interaktiv unter `/api/public/docs`).

---

## Was die App kann

**Öffentlich (ohne Login)**
- **Antragsformular** mit Pflicht-Standortwahl; Uploads (Finanzantrag,
  Studierendenausweis, Anlage A/B). Spam-Schutz (Honeypot + signierte Zeitfalle),
  Ratenbegrenzung.
- **Eingangsbestätigung als PDF** mit einem zufälligen **Status-Token-Link**.
- **Statusseite** (`/status/{token}`): aktueller Status ansehen, Dokumente
  herunterladen (außer Studierendenausweis — bleibt intern) und **PDFs nachreichen**
  (append-only). In der Archiv-Spalte ist das Nachreichen gesperrt.
- **Feedback-Formular** (`/feedback`): wie das Antragsformular, nur ohne Dateien.
  Statt Standorten gibt es **Feedback-Bereiche** (`/admin/umfragen`), die ebenso
  auf Board + Spalte routen. Der Name ist optional (sonst „Anonym"); eine
  Einreichung erzeugt eine normale Karte plus einen unveränderlichen Snapshot,
  damit die öffentliche Ansicht die Originaleinreichung zeigt. Eigene
  Statusseite unter `/feedback/status/{token}`.
- **Inventar & Ausleihe** (`/inventar`): vom Admin freigegebene Inventare
  durchsuchen und einen Gegenstand **zur Ausleihe anfragen**. Öffentlich sichtbar
  ist eine bewusste Whitelist — Bezeichnung, Kategorie, Verfügbarkeit, ggf.
  „entliehen bis", **ohne Person**. Der Fortschritt läuft über
  `/inventar/status/{token}`: Vertrag herunterladen, unterschrieben hochladen,
  Anfrage zurückziehen.

**Intern (Login via SSO)**
- **Mehrere Kanban-Boards** mit pro Board konfigurierbaren Status-Spalten,
  Drag-&-Drop-Sortierung, Live-Aktualisierung (SSE), Filtern, Kommentaren und
  Aktivitäts-/Statushistorie je Karte.
- **Karten** mit pro Board ein-/ausschaltbaren Feldern (Antragsteller, Priorität,
  Deadline, Sitzung, beantragte/genehmigte/tatsächliche Beträge, Konto, Anweisungsdatum, automatische **Antragsnummer**,
  Haushaltstitel, Anhänge u. v. m.) — Erstellen/Bearbeiten speichert automatisch.
- **Standort-Routing**: pro Standort legt der Admin Ziel-Board + Ziel-Spalte fest;
  nur Standorte mit Ziel sind aktivierbar.
- **Finanzübersichten** mit Haushaltsplan (Einnahmen/Ausgaben), Live-/Ist-Ausgaben
  und Antragsübersicht; **XLSX-Export**. Unter „Quell-Boards“ lässt sich pro Board
  optional eine „Spalte für Verfallen“ auswählen: Karten darin werden nur aus
  den Live-Ausgaben ausgeschlossen, bleiben aber in der Antragsübersicht und
  bei den tatsächlichen Ausgaben erhalten. Die Regel gilt auch im Export.
- **Inventar & Ausleihe** (`/intern/inventar`): eigenes Modul mit eigenen Listen
  und Feldern, aber demselben Zugriffsmodell wie Boards. Gegenstände mit
  Stückzahlen, Obergruppen, Mängelhistorie, Belegen und Inventarnummern; defekte
  oder verlorene Stücke landen im Archiv. **Leihvorgänge sind kartengeführt:**
  Jedes Inventar bekommt ein automatisch angelegtes Kanban-Board, auf dem jeder
  Vorgang als Karte liegt — die Spalte der Karte bestimmt den Vorgangsstatus.
  Board-übergreifend gibt es das **Gesamtinventar** (`/intern/inventar/gesamt`)
  als Anlagenverzeichnis ab einem konfigurierbaren Mindestpreis, mit CSV-Export.
- **PDF-Viewer und -Editor**: Anhänge öffnen sich **in der App** statt im
  Browser-Tab. Freitext platzieren, vorhandene AcroForm-Felder ausfüllen und mit
  dem persönlichen `.p12` **kryptografisch signieren** (PAdES, serverseitig —
  der Privatschlüssel verlässt den Server nie). Speichern wahlweise als neue
  Datei oder als Ersatz des Originals.
- **Anweisungsformular pro Board**: Eigentümer/Admin hinterlegen in den
  Board-Einstellungen eine PDF-Vorlage und aktivieren die Funktion. Mitglieder
  öffnen sie auf einer Karte direkt im PDF-Editor; beim Speichern entsteht ein
  normaler Kartenanhang `<Antragsnummer>_Anweisung1.pdf`,
  `<Antragsnummer>_Anweisung2.pdf` usw. Die Antragsnummer wird beim Speichern
  von der Karte übernommen; fehlt sie, lautet der Name `Anweisung1.pdf` usw.
  Auch manuell hochgeladene Dateien dieses Namens und bisherige Namen wie
  `Anweisung 1.pdf` werden für die nächste Nummer berücksichtigt.
- **Meine Aufgaben** (`/intern/aufgaben`): board-übergreifende Liste der eigenen
  und zugewiesenen Karten, pro Board konfigurierbar.
- **Board-Statistik** (`/intern/board/{id}/statistik`) und **Board-Archiv** für
  erledigte Karten (der „Done"-Sweep räumt sie täglich weg, löscht aber nichts).
- **Vorlagen** für Boards und Finanzpläne (Admin oder Template-Verwalter).
- **Nextcloud-Archivierung** (optional, pro Board): erreicht ein Antrag die
  Trigger-Spalte, werden seine Dateien automatisch hochgeladen. Schlägt das fehl,
  wird **automatisch wiederholt**; nach > 24 h erscheint eine Warnung auf dem
  Dashboard.
- **REST-API** (`/api/v1`, persönliche Bearer-Tokens) — kann nie mehr als der
  Nutzer über die Weboberfläche. Siehe [docs/API.md](docs/API.md).

**Öffentliche API für native Apps**
- **Antragseinreichung ohne Login** (`/api/public/v1`) für direkte Android-/
  iOS-Clients: Standorte abrufen, Antrag als `multipart/form-data` einreichen.
  Verpflichtender `Idempotency-Key` macht Retries im Mobilfunk gefahrlos; eigene,
  großzügige Rate-Limits. Fachlich teilt sie sich die Einreichungslogik mit dem
  Browserformular. Siehe [docs/PUBLIC_API.md](docs/PUBLIC_API.md), interaktiv
  unter `/api/public/docs`.

**Rollen:** `admin` (alles, inkl. Admin-Panel), `template_manager` (zusätzlich
Vorlagen), `user` (eigene Boards + Freigaben). Freigaben erlauben Lesen oder Lesen und Schreiben; die höchste passende
Personen-/Gruppenfreigabe gilt. Verwalten bleibt Eigentümer/Admin vorbehalten.

---

## Entwicklung

```bash
npm install
cp .env.example .env          # Werte anpassen (siehe „Umgebungsvariablen")
docker compose up -d db       # PostgreSQL starten
npm run db:setup              # Migrationen + Seed (Standorte, Prioritäten, Board-Template — KEIN Admin)
npm run dev                   # http://localhost:3000
```

> **Der DB-Port ist absichtlich nicht veröffentlicht.** In `docker-compose.yml`
> ist das `ports`-Mapping des `db`-Dienstes auskommentiert — im Betrieb erreicht
> nur der App-Container die Datenbank über das Compose-Netz. Für `npm run dev`
> und `db:setup` **vom Host** braucht es den Port aber. Lege dafür eine
> (gitignorierte) `docker-compose.override.yml` an, statt die Hauptdatei zu
> ändern:
>
> ```yaml
> services:
>   db:
>     ports:
>       - "127.0.0.1:5432:5432"
> ```
>
> `DATABASE_URL` in der `.env` zeigt dann auf `localhost:5432`.

> Der erste Admin entsteht **über das SSO**: Der in `ADMIN_USER` gesetzte
> SSO-Benutzer wird beim **ersten Login** automatisch Admin (kein Admin im Seed,
> kein Passwort in dieser App).

### Skripte

| Skript | Zweck |
|--------|-------|
| `npm run dev` | Entwicklungsserver |
| `npm run build` / `npm start` | Produktions-Build / -Start |
| `npm run lint` | ESLint |
| `npm test` | Regressionstests (Node-Test-Runner über `tsx`) |
| `npm run db:generate` | Drizzle-Migration aus dem Schema erzeugen |
| `npm run db:migrate` | Migrationen anwenden |
| `npm run db:seed` | Startbestand: 4 Standorte, Prioritäten, Board-Template (kein Admin) |
| `npm run db:setup` | `db:migrate` + `db:seed` |
| `npm run openapi:yaml` | `docs/openapi-*.yaml` aus den TS-Quellen neu erzeugen |
| `npm run openapi:public:yaml` / `openapi:internal:yaml` | nur die jeweilige Spezifikation erzeugen |

Die Tests unter `tests/` prüfen Regressionen und API-Verträge. Eine vollständige
lokale Konfiguration gemäß `.env.example` und eine **isolierte, migrierte
Testdatenbank** sind erforderlich. Neuere DB-Suiten schlagen ohne Datenbank fehl;
ältere Tests überspringen sich teilweise. Niemals die normalen App-Daten oder
Produktionsdaten für Testläufe verwenden:

```bash
DATABASE_URL=postgres://gremio:PASSWORT@localhost:5432/gremio_test npm test
```

`tests/api-parity.test.ts` prüft die echten REST-Handler mit Test-Tokens;
`tests/api-contract.test.ts` gleicht Routen, Schemas, Beispiele und die generierten
YAML-Dateien ab. Browser-/HTTP-Prüfungen und der gesonderte Migrationstest sind
in [tests/browser/README.md](tests/browser/README.md) beschrieben. Der
API-Vertragsabgleich benötigt keine neue Migration zusätzlich zu `0062`.

---

## Umgebungsvariablen (`.env`)

Vorlage: [`.env.example`](.env.example) (ausführlich kommentiert in
[`.env.example.read`](.env.example.read)). **Ohne gültige Secrets startet die App
bewusst nicht.**

| Variable | Beschreibung |
|----------|--------------|
| `APP_BASE_URL` | Kanonische Basis der internen App und Quelle der OIDC-`redirect_uri`. Reine HTTP(S)-Origin ohne Zugangsdaten, Pfad, Query oder Fragment; muss exakt zur SSO-Registrierung passen. |
| `PUBLIC_BASE_URL` | Optionale getrennte HTTP(S)-Origin für Status-, PDF- und Download-Links, ebenfalls ohne Zugangsdaten, Pfad, Query oder Fragment. Fehlt sie, wird rückwärtskompatibel `APP_BASE_URL` verwendet. |
| `AUTH_SECRET` | Session-/HMAC-Basisgeheimnis, **min. 32 Zeichen** (`openssl rand -base64 48`). |
| `ENCRYPTION_KEY` | AES-256-Schlüssel für Nextcloud-Zugangsdaten, **64 Hex-Zeichen** (`openssl rand -hex 32`). |
| `OIDC_ISSUER` | Öffentlicher SSO-Issuer (Browser: authorize/logout, `iss`-Prüfung). In Produktion **https**. |
| `OIDC_INTERNAL_ISSUER` | Optional: containerinterner Issuer für Server-zu-Server-Calls (token/jwks/userinfo). Leer = `OIDC_ISSUER`. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | OAuth-Client aus der SSO-Registrierung. |
| `ADMIN_USER` | SSO-Benutzer, der beim **ersten Login** automatisch Admin wird. |
| `POSTGRES_PASSWORD` | Passwort des Postgres-Containers — **muss gesetzt sein** (docker-compose bricht sonst ab). |
| `DATABASE_URL` | PostgreSQL-Verbindung (im Container von docker-compose gesetzt). |
| `UPLOAD_DIR` | Verzeichnis für Anhänge + Profilbilder (Default `/app/uploads` im Container). |
| `AUTH_TRUST_HOST` | Hinter Reverse-Proxy auf `true`. |

---

## Deployment (Docker hinter nginx)

Der Container liefert **nur HTTP** auf Port 3000; **SSL/TLS terminiert nginx**
davor. Nach außen gemappt wird er auf **`127.0.0.1:3010`** — genau dorthin
proxyt das nginx-Beispiel. Persistente Volumes sind zwingend, sonst gehen DB und
Uploads beim Rebuild verloren.

```bash
cp .env.example .env          # echte Secrets eintragen (siehe oben)
docker compose up -d          # startet PostgreSQL (db) + App
```

Das App-Image wird **nicht lokal gebaut**, sondern fertig aus der GitHub
Container Registry gezogen (`ghcr.io/leviora-studio/gremio`, `pull_policy:
always`). Eine bestimmte Version pinnt `GREMIO_TAG`, z. B.
`GREMIO_TAG=2.7.7 docker compose up -d`; ohne Angabe gilt `:latest`. Wer aus dem
lokalen Quellstand bauen will, ergänzt einen `build:`-Abschnitt in einer
`docker-compose.override.yml`.

- Beim Start laufen automatisch **nur die Migrationen** (Instrumentation-Hook) —
  **kein** Auto-Seed. Startbestand bei Bedarf einmalig mit `npm run db:seed`.
- Daten liegen in `./pgdata` (PostgreSQL) und `./uploads` (Dateien) — **beides
  sichern**. Optionale Nextcloud-Archive werden separat gesichert.
- nginx-Beispiel: [`deploy/nginx.conf.example`](deploy/nginx.conf.example) — weist
  fremde Host-Header ab (`default_server` → 444), reicht
  `X-Forwarded-Proto`/`-For` + `Host` weiter und setzt `client_max_body_size 105m`
  (4 Dateien × 25 MB + Overhead).

```
Browser ──HTTPS──> nginx (SSL) ──HTTP──> App-Container (Next.js, Node) ──> PostgreSQL-Container
                                                              └──> /uploads (Volume)
```

---

## Worauf man achten muss

- **Echte Secrets setzen.** `AUTH_SECRET` und `ENCRYPTION_KEY` müssen zufällig
  sein; die Platzhalter aus `.env.example*` werden beim Start **abgelehnt**.
  `AUTH_SECRET` ändern ⇒ alle Sessions werden ungültig (einmal neu anmelden).
- **`POSTGRES_PASSWORD` ist Pflicht** (kein schwaches Default mehr). Ein nachträglich
  geändertes Passwort wirkt nur bei DB-Neuinitialisierung — sonst zusätzlich
  `ALTER USER gremio WITH PASSWORD '…'` im laufenden Container.
- **TLS für ausgehende Credentials:** In Produktion muss der `OIDC_ISSUER` **https**
  sein (über http zu einem öffentlichen Host bricht der Start ab). **Nextcloud-URLs
  müssen `https://`** sein — sonst gingen Zugangsdaten im Klartext.
- **Genau ein vertrauenswürdiger nginx davor:** Die App vertraut `X-Forwarded-*` /
  `X-Real-IP`. nginx **muss** fremde Host-Header abweisen (siehe Beispiel), sonst
  Host-Header-Injection.
- **Volumes nie verlieren:** `./pgdata` und `./uploads` liegen außerhalb des Images.
- **DSGVO:** Pflicht-Kontaktadresse bei öffentlichen Einreichungen bleibt intern; Status per geheimem Token-Link; Roh-IPs werden
  nicht gespeichert (nur HMAC fürs Rate-Limit). Studierendenausweis ist nie
  öffentlich abrufbar.
- **Skalierung:** Rate-Limiting läuft in-memory (eine Instanz). Bei horizontaler
  Skalierung geteilten Speicher (Redis) ergänzen.
- Weitere bewusste Design-/Sicherheitsentscheidungen: siehe Abschnitt
  „Sicherheits-/Design-Entscheidungen" in [CLAUDE.md](CLAUDE.md).

---

## Sicherheit (kurz)

- Login ausschließlich über **SSO/OIDC** (PKCE, `state`/`nonce`, `iss`/`aud`/`exp`,
  JIT-Provisioning) — kein lokales Passwort in dieser App.
- Sessions als **verschlüsseltes, HttpOnly-, in Produktion Secure-Cookie**
  (iron-session). HMAC-Schlüssel je Zweck per HKDF aus `AUTH_SECRET` abgeleitet.
- Board-Nextcloud-Zugangsdaten **AES-256-GCM-verschlüsselt** in der DB; ausgehende
  WebDAV-Requests sind SSRF-gehärtet (DNS-Pinning, kein Redirect, https-Pflicht).
- REST-API ist eine **Teilmenge** der Web-Rechte (nie mehr).
- Öffentliche Formulare: Honeypot plus **signierte, an den Client gebundene
  Zeitfalle** (6 h gültig). Ratenbegrenzung getrennt je Scope-Familie — ein
  gefluteter öffentlicher Scope kann die Anmeldung nicht aussperren.
- Freie Texte werden an der **Eingangsgrenze** bereinigt (`lib/text.ts`): NUL und
  Steuerzeichen kommen weder in die Datenbank noch in die PDF-Bestätigung.
- Audit vom 04.09.2026: `npm audit` ist einschließlich Entwicklungsabhängigkeiten
  **ohne Befund**. Der veraltete esbuild-Zweig unter `@esbuild-kit/core-utils`
  wird gezielt auf eine korrigierte Version überschrieben; Drizzle bleibt auf
  seiner bisherigen Version. Dies ist ein historischer Auditstand, keine Aussage
  über die heute verfügbaren Sicherheitsmeldungen.
- Befunde, Korrekturen und Prüfgrenzen seit 2.7.0:
  [Security- und Bug-Audit](docs/SECURITY_AUDIT_SINCE_2.7.0.md).
- Aktueller Prüfstand einschließlich Version 4.2.0 und aller späteren Änderungen:
  [Bug- und Security-Audit seit 4.2.0](docs/SECURITY_AUDIT_SINCE_4.2.0.md).
  Produktionsabhängigkeiten ohne npm-Befund; 13 moderate Meldungen im
  Entwicklungswerkzeug bleiben mit Erreichbarkeits- und Kompatibilitätsbewertung dokumentiert.

---

## Lizenz

**GNU Affero General Public License, Version 3** (`AGPL-3.0-only`) — Volltext
siehe [`LICENSE`](LICENSE).

Es gilt **ausschließlich Version 3**. Die sonst übliche Klausel „oder jede
spätere Version" ist bewusst **nicht** Teil dieser Lizenzierung; spätere
Versionen der AGPL gelten für diese Software nur, wenn der Rechteinhaber sie
ausdrücklich freigibt.

Diese Software ist freie Software: Du kannst sie unter den Bedingungen der AGPL
weitergeben und/oder verändern. **Wichtig:** Wer eine modifizierte Version **über
ein Netzwerk** zugänglich macht (z. B. als gehostete Web-App), muss den
**vollständigen Quellcode** dieser Version den Nutzern anbieten.

```
Copyright (C) 2026  Leviora Studio

Dieses Programm ist freie Software: Sie können es unter den Bedingungen der GNU
Affero General Public License, Version 3, wie von der Free Software Foundation
veröffentlicht, weitergeben und/oder modifizieren.
Es wird ohne jede Gewährleistung bereitgestellt; siehe die Lizenz für Details.
```

### Freigaben mit Lese- und Schreibrechten

Migration `0070_board_access_levels` ergänzt Kanban-, Finanz- und
Inventarfreigaben um `access_level`. **Alle bestehenden Personen- und
Gruppenfreigaben erhalten automatisch `write` (Lesend und schreibend).** Die
Migration vor Start der neuen App-Version mit dem regulären Migrationsablauf
anwenden; es ist keine manuelle Neuerfassung bestehender Freigaben erforderlich.
Neue Freigaben können in den Einstellungen als Lesend oder Lesend und schreibend
angelegt und später geändert werden. Die höchste passende direkte oder
Gruppenfreigabe gilt. Einstellungen/Freigaben bleiben Eigentümern und Admins
vorbehalten; Finanz-Schreiber bearbeiten den Haushaltsplan über „Haushaltsplan
bearbeiten“.

### Bürokraft auf einem Board

Unter Board-Einstellungen → **Bürokraft aktivieren** kann ein bereits lesend
berechtigter, aktiver Nutzer ausgewählt werden. Erlaubte Ausgangs- und Zielspalten
werden getrennt festgelegt. Ohne normales Schreibrecht sind ausschließlich diese
Statuswechsel erlaubt; Karteninhalte bleiben schreibgeschützt. Direkte oder
Gruppen-Schreibrechte haben Vorrang. Die Funktion erteilt keine Board-Freigabe.
Migration `0071_board_office_role` ergänzt die standardmäßig inaktive
Konfiguration; beim Update entstehen keine zusätzlichen Rechte.


### System-E-Mails

Admin-Dashboard → **E-Mail / SMTP** (`/admin/email`): Host, Port, TLS/STARTTLS, optional Anmeldung, Absender und Antwortadresse einstellen. SMTP-Passwörter werden mit dem vorhandenen `ENCRYPTION_KEY` verschlüsselt; diesen bei Updates unverändert sichern. Wer Host, Port oder Verschlüsselung ändert, muss das Passwort erneut eingeben, damit das gespeicherte Passwort nie ungefragt an einen anderen Server geht. „Verbindung prüfen“ prüft den gespeicherten Stand ohne Mailversand. Unverschlüsselter SMTP-Versand ist nur für interne Relays vorgesehen. Bei Updates sind Versand und sämtliche Bestätigungen zunächst ausgeschaltet; bestehende Anträge bleiben unverändert.

Board-Einstellungen → **Email-Settings**: pro Spalte aktivieren und bis zu 50 Adressen eingeben (Zeilen, Komma oder Semikolon). Eigentümer/Admin verwalten diese Regeln. Neue Karten und tatsächliche Statuswechsel lösen die Zielspalten-Regel aus; Umsortieren innerhalb einer Spalte löst keine Mail aus. Inventar-Vorgangsboards haben dieselben Regeln in den Inventar-Einstellungen. Jede Adresse erhält eine eigene Mail mit Kartentitel, Board, Status und internem Kartenlink.

Empfangsbestätigungen für öffentliche Finanzanträge, Feedback und Inventaranfragen aktiviert ausschließlich der Admin je Board und Einreichungsart. E-Mail ist unabhängig vom Haken ein Pflichtfeld. Bestätigungen enthalten den persönlichen Status-Link und das Eingangs-PDF; keine Ausweise oder anderen Uploads. Feedback ohne Namen bleibt möglich, die Kontaktadresse ist intern jedoch bekannt.

Der Node-Server verarbeitet die PostgreSQL-Outbox alle 15 Sekunden, auch im lokalen Dev-Betrieb. Produktion benötigt einen dauerhaft laufenden Node-Prozess. Nach Fehlern erfolgen maximal fünf Versuche mit wachsender Wartezeit (2, 4, 8, 16 Minuten zwischen den Versuchen). Terminale Fehler sind im Admin-Bereich sichtbar und erneut anstoßbar. Globale Deaktivierung pausiert ausstehende Mails und verhindert neue Einträge. Nach erfolgreichem Versand werden Empfänger und Inhalt aus der Outbox entfernt; Versandmetadaten nach sieben Tagen. Fehlgeschlagene Inhalte bleiben für erneute Zustellung gespeichert. Bei einem Absturz nach SMTP-Annahme, aber vor Bestätigung in PostgreSQL, sind doppelte Zustellungen möglich; Wiederholungen verwenden dieselbe Message-ID.

Lokale Regression: `tests/system-email-db.test.ts` benötigt eine isolierte, migrierte Datenbank `gremio_workflows_test_*`. Der Test startet einen SMTP-Empfänger ausschließlich auf Loopback und sendet nichts extern.


### Sitzungen und Tagesordnungen

Unter **Sitzungen** (`/intern/sitzungen`, mobil unter „Mehr“) zuerst einen **Sitzungsbereich** anlegen und Personen/Gruppen am Bereich lesend oder schreibend freigeben. Innerhalb des Bereichs Sitzungen mit Termin und Einreichungsfrist anlegen. Die Freigaben gelten automatisch für alle bestehenden und neuen Sitzungen. Der Bereichsname ersetzt das manuelle Feld „Gremium“ und erscheint automatisch in den Sitzungen und PDFs. Lesende Personen können bis zur Frist TOPs vorschlagen; Schreibende planen die Tagesordnung, sortieren per Drag-and-drop und halten behandelte, vertagte oder zurückgezogene Punkte fest. Eigentümer/Admin verwalten Einstellungen und vertrauliche TOPs. Abgeschlossene Sitzungen lassen sich zum Bearbeiten wieder öffnen. Termine verwenden Europe/Berlin.

Im persönlichen Themenspeicher werden Themen ohne Zielauswahl angelegt und per „Zur Sitzung vorschlagen“ einer Sitzung vorgeschlagen. Der private Eintrag bleibt mit Sitzungsverlauf erhalten, und wird nach Behandlung unter „Vergangene Themen“ einsortiert. Der neue Teilnehmerkreis wird ausdrücklich bestätigt. Bei Übernahme eines eingeplanten TOPs verschwindet er aus der bisherigen Übersicht; andere Status bleiben dort nachvollziehbar. TOPs werden mit eigenständigen Dateikopien übernommen. Von einer Karte führt „Für eine Sitzung vorschlagen“ zu einem eigenen TOP mit geschützter Kartenreferenz. Es werden keine Kartentitel oder -inhalte automatisch als TOP-Inhalt übernommen.

Boards können in den Sitzungs-Einstellungen angebunden werden, wenn dieselbe Person beide Seiten verwalten darf. Die Anbindung erleichtert die Kartenauswahl und vergibt **keine Board-Rechte**. Wer nur die Sitzung sehen darf, sieht TOP-Inhalt und ausdrücklich freigegebene Sitzungsunterlagen, keine geschützten Kartendetails. Dateikopien aus Karten müssen ausdrücklich freigegeben werden, erfordern Board-Schreibrechte und bleiben anschließend eigenständig; Studierendenausweise sind ausgeschlossen.

„Tagesordnung als PDF“ exportiert die gemeinsame Teilnehmerfassung ohne vertrauliche TOPs und ohne geschützte Karteninhalte. Die normale Karten-/Anhangberechtigung gilt weiterhin. Das Modul benötigt keine neue Produktionsabhängigkeit. Migrationen `0073` und `0074` laufen beim Produktionsstart automatisch; im lokalen Dev-Betrieb vorher `npm run db:migrate` ausführen. SMTP-Einladungen, Kalenderdateien und ein Protokolleditor sind spätere Erweiterungen.

Die Bereichsumstellung übernimmt bestehende Sitzungen jeweils in einen eigenen Bereich mit unveränderten Rechten. Gleichnamige Sitzungen werden aus Zugriffsschutzgründen nicht automatisch zusammengeführt. Dateien und Links bleiben erhalten. Kalender, Uhrzeitauswahl, Datei-Uploader, Freigabezeilen und Löschdialoge nutzen die vorhandenen App-Komponenten.

PDF-Sitzungsunterlagen öffnen sich im vorhandenen In-App-PDF-Viewer (Leseansicht). Andere Dateitypen werden heruntergeladen. Beide Abrufwege prüfen weiterhin die aktuellen Bereichs-/TOP-Rechte.

Unter-TOPs können durch Personen mit Schreibzugriff beim Einplanen zugeordnet oder direkt an einem eingeplanten Haupt-TOP angelegt werden. Vorschläge bleiben normale TOPs. Die Tagesordnung und ihr PDF nummerieren beispielsweise 2, 2.1 und 2.2. Haupt-TOPs lassen sich samt Unter-TOPs verschieben; innerhalb der Gruppe ist die Reihenfolge ebenfalls per Drag-and-drop änderbar. Zeiten werden addiert. Vertrauliche Haupt-TOPs schützen auch ihre Unterlagen und Unter-TOPs.

### SSO-Sitzungen und lokale Nutzersperre

Unter **Admin Panel → Nutzer** können Admins Nutzer **deaktivieren** und **reaktivieren**. Eine Deaktivierung sperrt weitere Anfragen sofort, macht alle bisherigen Browsersitzungen dauerhaft ungültig. Auch seine bestehenden API-/MCP-Tokens gewähren während der lokalen Sperre keinen Zugriff. Inhalte und Freigaben bleiben erhalten. Nach Reaktivierung ist eine neue Browser-Anmeldung erforderlich. Der eigene Zugang und der letzte aktive Admin sind geschützt. Am SSO-Konto wird nichts geändert.

Browser-Anmeldungen werden beim Login und danach bei aktiver Nutzung spätestens alle fünf Minuten über den OAuth-Introspection-Endpunkt des SSO bestätigt. Innerhalb dieser Frist kann eine ausschließlich im SSO vorgenommene Sperrung noch unbemerkt bleiben. Nach Ablauf der Frist werden weitere Anfragen erst nach erfolgreicher Prüfung zugelassen. Bei SSO-Ausfall gibt es dann ebenfalls keinen weiteren Zugriff; eine Wiederholung ist nach Wiederherstellung möglich. Offene geschützte Live-Streams werden erneut geprüft und bei Ablehnung geschlossen. Bereits geladene Inhalte können nicht zurückgeholt werden.

Browser-Anmeldungen gelten fest für **14 Tage**. Die Fünf-Minuten-Frist ist ausschließlich der Abstand der Statusprüfungen. Beim ersten Login nach diesem Update ist eine neue Anmeldung mit Zustimmung zu `offline_access` nötig. Das Refresh-Token wird ausschließlich im verschlüsselten Browser-Cookie gespeichert; Profilaktionen verlängern die ursprüngliche Gremio-Frist nicht. Ein normaler Logout auf der SSO-Webseite beendet diese Offline-Berechtigung nicht. Gremio-Logout widerruft dagegen sein Refresh-Token.

**SSO-Konfiguration:** Der vertrauliche Client muss `offline_access` (inklusive Nutzerberechtigung, bei Keycloak Rolle/optionaler Client-Scope) sowie Refresh-Tokens erlauben. Die Offline-Leerlauf-/Maximalfristen müssen mindestens 14 Tage abdecken. Discovery muss `introspection_endpoint` unter derselben Origin wie der interne/öffentliche Issuer liefern. Introspection mit Client-ID/Secret muss `active`, `client_id` und gegebenenfalls `exp` liefern und bei Nutzersperre, Löschung oder Widerruf der Offline-Berechtigung ablehnen. Ein vorhandenes `sub` muss passen; fehlt es, wird die beim verifizierten Login versiegelte Identitätsbindung verwendet. Keycloaks Offline-`exp:0` wird unterstützt. Bei älteren Cookies ohne Bindung muss zusätzlich UserInfo die Identität bestätigen. Andere Provider müssen diese Semantik separat verifizieren. Fehlende Offline-Berechtigung führt zu einer verständlichen Login-Fehlermeldung; fehlende Prüfbarkeit sperrt den Zugriff.

Die fünfminütige SSO-Prüfung gilt für Browser-Sitzungen. Separat ausgestellte API-/MCP-Tokens behalten ihren eigenen Lebenszyklus; ihre Nutzung wird weiterhin bei lokaler Deaktivierung gesperrt.

### Eigentümer und Gestaltung von Empfangsbestätigungen

Nach `npm run db:migrate` können normale Boards, Finanzboards und Inventarboards mehrere gleichberechtigte Eigentümer haben. Unter **Einstellungen → Eigentum & Löschen** werden weitere aktive Personen mit `ERNENNEN` bestätigt. Eigentümer können mit `ENTZIEHEN` selbst austreten; nur Admins dürfen anderen die Eigentümerschaft entziehen. Der letzte Eigentümer bleibt geschützt, auch gegenüber Admins. Ein Admin muss sich also ausdrücklich zusätzlich ernennen, bevor er alle anderen entfernt. Bisherige Eigentümer bleiben beim Update unverändert erhalten.

Unter **Admin Panel → Empfangsbestätigungen** lassen sich Organisation und Logo (PNG/JPEG bis 2 MB) hinterlegen oder entfernen. Der gemeinsame Briefkopf erscheint auf den öffentlichen Antrags-/Feedback-PDFs und auf den PDF-Anhängen der Bestätigungs-E-Mails für Anträge, Feedback und Inventaranfragen. Die E-Mail enthält das Logo optional eingebettet, ohne externe Bildabrufe. Das neue Layout bestätigt ausschließlich den Eingang, keine Bewilligung. Versandaktivierung und SMTP bleiben in ihren bisherigen Einstellungen.

### Live-Aktualisierung

Nach `npm run db:migrate` aktualisieren sich die angemeldeten App-Bereiche einschließlich Sitzungen, Eigentümern/Freigaben, Finanzansichten, Vorlagen und Admin-Einstellungen automatisch. Pro Tab wird eine gemeinsame SSE-Verbindung verwendet. Der Reverse Proxy muss `/api/app/stream` wie die vorhandenen Board-Streams ungepuffert durchreichen und lange Verbindungen zulassen; die Antwort setzt `X-Accel-Buffering: no`. Es wird keine zusätzliche Infrastruktur benötigt. Technische Token-Nutzungszeitstempel sind bewusst von automatischen Neuabfragen ausgenommen.

Offene Dialoge und ungespeicherte Eingaben werden nicht für externe Aktualisierungen geschlossen oder verworfen. Stattdessen erscheint gegebenenfalls ein Hinweis; nach Speichern, Zurücksetzen oder Schließen wird aktualisiert. Nach Offline-Zeiten oder der Rückkehr in den Tab wird der Stand nachgezogen. Öffentliche Statusseiten behalten ihre bisherigen tokengebundenen Live-Verbindungen.

### Finanzanträge in Sitzungen einplanen

Unter **Sitzungsbereich → Bereichseinstellungen → Finanzanträge** lässt sich ein
Antragsboard mit angebotenen Quellspalten und einer Zielspalte verknüpfen.
Anschließend einen eingeplanten Haupt-TOP der Sitzung öffnen und **Als
Finanzanträge-TOP festlegen** wählen. Dort werden Karten direkt als Unter-TOPs
eingeplant, in die Zielspalte verschoben und – sofern das Kartenfeld aktiv ist –
mit dem Sitzungsdatum versehen. Erforderlich sind Schreibrechte für Sitzung und
Antragsboard. Pro Sitzung ist genau ein Finanzanträge-TOP möglich.

Die Tagesordnung und ihr PDF zeigen Antragsnummer, Kartentitel und Finanzangaben
nur mit den jeweiligen Board- und Feldrechten; die PDF enthält zusätzlich den
internen Kartenlink. Bereichsfreigaben geben keine Karten frei. Beim Entfernen
eines Unter-TOPs bleiben die Karte, ihr Status und ihr Sitzungsdatum bestehen.

Die Gestaltung von Empfangsbestätigungen lässt sich unter **Admin → Standorte**
und **Admin → Umfragen** direkt beim jeweiligen Eintrag über
**Empfangsbestätigung gestalten** aufklappen. Mit **Eigene Gestaltung verwenden**
werden Gremienname und Logo nur für diese Formularquelle verwendet – auch wenn
mehrere Standorte oder Umfragen dasselbe Ziel-Board haben. Ohne eigenes Logo
erscheint diese Gestaltung ohne Logo. Ohne eigenen Namen gilt die Bezeichnung
des Eintrags. Beim Ausschalten gilt wieder der instanzweite Standard; die eigenen
Einstellungen bleiben gespeichert. PDFs und Bestätigungs-E-Mails verwenden die
persönliche Du-Ansprache. Die SMTP- und Versandregeln bleiben separat.

In der Sitzungsübersicht lässt sich der Status jedes bearbeitbaren TOPs direkt
ändern. **Vertagt** und **Zurückgezogen** haben getrennte Reiter. Beim Übernehmen
in eine andere Sitzung verschwinden bisher eingeplante TOPs aus der alten
Übersicht; TOPs mit anderem Status bleiben dort mit Zielverweis sichtbar.
Historische weitergegebene TOPs werden in der neuen Sitzung weiterbearbeitet.
Im persönlichen Themenspeicher zeigen die Themen ihren Vorschlags-, Einplanungs-
und Vertagungsverlauf. Nach **Behandelt** findest du sie unter **Vergangene Themen**.
Der Sitzungsstatus **Abgeschlossen (Protokoll veröffentlicht)** sperrt weiterhin
Änderungen; Übernahmen in offene Folgesitzungen bleiben möglich.

Vertagte TOPs bleiben zusätzlich in der Tagesordnung an ihrer bisherigen Stelle
mit roter Kennzeichnung **Vertagt** sichtbar – auch nach der Übernahme in eine
andere Sitzung. Der Reiter **Vertagt** enthält dieselben Einträge weiterhin.
Das Tagesordnungs-PDF bewahrt diese TOPs ebenfalls mit ihrem Status.

Der Verlauf im persönlichen Themenspeicher protokolliert jeden Schritt mit
Zeitpunkt und Sitzung einzeln: **Vorgeschlagen → Eingeplant → Vertagt → erneut
vorgeschlagen**. Spätere Statusänderungen ersetzen frühere Aktivitäten nicht.
Bei vorhandenen Themen ist nur der noch bekannte Altstand als solcher
übernehmbar; früher bereits überschriebene Zwischenschritte sind nicht
rückwirkend rekonstruierbar.

Unter **Mein Themenspeicher → Vergangene Themen** findest du deine behandelten
Themen weiterhin mit ihrem gesamten Aktivitätsverlauf. Sie werden nicht gelöscht.
Wird die Behandlung zurückgenommen, erscheint das Thema wieder unter den
aktuellen Themen.

Auch **Zurückgezogen** bleibt rot in Tagesordnung und PDF sowie im eigenen Reiter
sichtbar. Zurückgezogene TOPs werden nicht in Folgesitzungen übernommen.
Die einreichende Person findet ihr Thema im Themenspeicher und kann es entweder
als neuen Vorschlag einreichen oder **Als erledigt markieren**. Dann steht es
unter **Vergangene Themen** als **Erledigt**, einschließlich Aktivitätsverlauf.
Der ursprüngliche Sitzungs-TOP bleibt in beiden Fällen zurückgezogen. Das gilt
auch für direkt in einer Sitzung eingereichte eigene Themen, sofern weiterhin
Zugriff auf die Sitzung besteht.

Im Themenspeicher steht **Thema anlegen** oben, gefolgt von aktuellen und
vergangenen Themen. Jedes Thema lässt sich einzeln aufklappen; sein Verlauf
ist standardmäßig eingeklappt.
