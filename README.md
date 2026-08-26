# Gremio

**Gremio** ist eine Web-App zur Verwaltung von Anträgen in Gremien — z. B.
Studierendenvertretungen, Vereinen, Verbänden oder Ausschüssen. Ein
**öffentliches Antragsformular** speist Anträge je nach Standort in **interne
Kanban-Boards** ein, auf denen das Gremium sie bearbeitet — mit Rollen & Gruppen,
optionaler Nextcloud-Archivierung und einer schmalen REST-API.

Vier Module teilen sich Nutzer, Gruppen und dasselbe Freigabemodell:

| Modul | Bereich | Kurz |
|-------|---------|------|
| **Kanban / Anträge** | `/intern/board/{id}` | Anträge und beliebige andere Vorgänge auf Boards |
| **Finanzen** | `/finanzen` | Haushaltsplan und Ausgabenauswertung über Quell-Boards |
| **Inventar & Ausleihe** | `/intern/inventar`, `/inventar` | Gegenstände, Leihvorgänge, Anlagenverzeichnis |
| **Vorlagen** | `/vorlagen` | Board- und Finanz-Templates |

Dazu kommt öffentliches **Feedback** (`/feedback`) als zweiter Eingangskanal
neben dem Antragsformular.

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
  Deadline, Sitzung, Beträge, Konto, Anweisungsdatum, automatische **Antragsnummer**,
  Haushaltstitel, Anhänge u. v. m.) — Erstellen/Bearbeiten speichert automatisch.
- **Standort-Routing**: pro Standort legt der Admin Ziel-Board + Ziel-Spalte fest;
  nur Standorte mit Ziel sind aktivierbar.
- **Finanzübersichten** mit Haushaltsplan (Einnahmen/Ausgaben), Live-/Ist-Ausgaben
  und Antragsübersicht; **XLSX-Export**.
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
Vorlagen), `user` (eigene Boards + Freigaben). Board-Zugriff ist binär; Verwalten
bleibt Eigentümer/Admin vorbehalten.

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

Die Tests unter `tests/` halten je EINEN behobenen Fehler fest und schlagen ohne
den zugehörigen Fix fehl. Die datenbankgestützten überspringen sich selbst, wenn
`DATABASE_URL` auf keine erreichbare Instanz zeigt:

```bash
DATABASE_URL=postgres://gremio:PASSWORT@localhost:5432/gremio npm test
```

---

## Umgebungsvariablen (`.env`)

Vorlage: [`.env.example`](.env.example) (ausführlich kommentiert in
[`.env.example.read`](.env.example.read)). **Ohne gültige Secrets startet die App
bewusst nicht.**

| Variable | Beschreibung |
|----------|--------------|
| `APP_BASE_URL` | Kanonische öffentliche URL — Quelle für Status-Links **und** die OIDC-`redirect_uri`. Muss exakt der beim SSO registrierten URL entsprechen. |
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
`GREMIO_TAG=2.7.6 docker compose up -d`; ohne Angabe gilt `:latest`. Wer aus dem
lokalen Quellstand bauen will, ergänzt einen `build:`-Abschnitt in einer
`docker-compose.override.yml`.

- Beim Start laufen automatisch **nur die Migrationen** (Instrumentation-Hook) —
  **kein** Auto-Seed. Startbestand bei Bedarf einmalig mit `npm run db:seed`.
- Daten liegen in `./pgdata` (PostgreSQL) und `./uploads` (Dateien) — **beides
  sichern**.
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
- **DSGVO:** Keine Antragsteller-E-Mail; Status nur per Token-Link; Roh-IPs werden
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
- `npm audit --omit=dev` ist **ohne Befund**; verbleibende Funde betreffen nur
  den Build-/Dev-Baum (esbuild über drizzle-kit).

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
