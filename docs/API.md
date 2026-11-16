# Gremio REST-API (v1)

Externe Tools können Boards/Karten **lesen** und Karten **anlegen, ändern,
verschieben und löschen**. Zusätzlich stehen boardgebundene Auswahlkataloge,
Suche/Filter/Pagination, interne Kommentare, der lesbare Aktivitätsverlauf und
Kartenanhänge (auflisten, herunterladen, hochladen) zur Verfügung.
PDF-Bearbeitung/Signaturen und administrative Einstellungen
bleiben ausgeschlossen. Der integrierte [MCP-Zugang](MCP.md) deckt dieselben
Funktionen mit OAuth-Freigaben ab.

Abgleich seit `v2.7.7`, einschließlich des aktuellen Arbeitsstands:
[API_PARITY_AUDIT.md](API_PARITY_AUDIT.md).

## Haushaltspositionen

Karten liefern zusätzlich `budgetMode` (`single`/`positions`) und `budgetRevision`.
`GET /api/v1/cards/{id}`, `PATCH` und die POST-Antwort liefern neben `card` ein geordnetes Array
`budgetPositions`. Es enthält stabile UUIDs, `position`, `budgetTitle`, `description`,
`accountId` und `requestedAmount`/`approvedAmount`/`actualAmount` in **Cent**. Die
Positionsbeträge heißen bewusst ohne `Cents`-Suffix; sie sind trotzdem ganzzahlige
Centwerte. Auf dem Board ausgeblendete Felder werden auch dort nicht ausgegeben.

Neue Karten können mit `budgetPositions` direkt in einem POST angelegt werden.
Dabei `budgetRevision` weglassen oder `0` setzen. Ohne Positionen bleibt die
bisherige Einzelkarten-Anlage unverändert; `budgetRevision` ist dann unzulässig.
Validierungsfehler hinterlassen keine teilweise angelegte Karte.
Per PATCH kann
`budgetPositions` gemeinsam mit der zuletzt gelesenen `budgetRevision` gesetzt
werden (vollständiger atomarer Ersatz, Array-Reihenfolge ist maßgeblich). Jede
Position braucht ein existierendes Konto, andere Felder dürfen `null` sein.
Je Karte sind höchstens 100 Positionen zulässig (400). JSON-Bodies von
`POST /api/v1/boards/{id}/cards` und `PATCH /api/v1/cards/{id}` sind auf 1 MB
begrenzt; größere Bodies ergeben 413, auch ohne `Content-Length`.
Beim ersten Wechsel füllt der Editor Position 1 mit den bisherigen Kartenwerten
vor. Sichtbare Werte dürfen bereits im ersten PATCH geändert werden; ein bislang
fehlendes Konto muss ergänzt werden. ID, Titel, Beschreibung und Konto müssen im
Schreibobjekt enthalten sein; ausgelassene Beträge bleiben erhalten (bei neuen
Positionen leer; bei der ersten Zeile im Wechsel vom Einzelmodus gelten die
bisherigen Kartenbeträge). `position` ist nur Teil der Leseantwort und muss vor
dem Zurücksenden entfernt werden; `cardId` ist kein API-Feld. Ausgeblendete Beträge
auslassen; sie dürfen weder geändert noch durch Positionslöschung entfernt werden.

Im Mehrfachmodus sind die drei Kartenbeträge berechnete Gesamtsummen;
`card.accountId` und `card.budgetTitle` sind `null`. Direkte Änderungen dieser fünf
Kartenfelder sowie deren Kombination mit `budgetPositions` werden mit 400 abgewiesen.
Eine falsche Revision oder ungültige/ausgeblendete Felder ergeben ebenfalls 400.
Eine verbleibende Position wird nur bei leerer Beschreibung verlustfrei zum
Einzelmodus zurückgeführt; sonst bleibt ihre Positionsdarstellung bestehen.
Die allgemeinen Board- und Token-Rechte gelten unverändert. Limits je Betrag und
Gesamtsumme: 2.000.000.000 Cent, nicht negativ; alle Werte leer ergibt `null`,
ausdrückliche Null bleibt `0`.

Detailantworten lesen Karte, Revision und Positionen aus einem gemeinsamen
Datenbank-Snapshot. Listen enthalten weiterhin nur die Karten mit Summen;
für einzelne Titel/Kontozuordnungen die Detailroute abrufen. Im Einzelmodus ist
`budgetPositions` leer. Für Positionsänderungen müssen `budget_title` und
`account` am Board aktiviert sein.

Beispiel für eine Anlage mit zwei Kontenzuordnungen (IDs ersetzen):

```json
{
  "title": "Veranstaltung",
  "budgetPositions": [
    { "id": "dd8e6b4b-6e8b-4449-b1c5-f2bce4a05f84", "budgetTitle": "12345", "description": "Material", "accountId": 1, "approvedAmount": 15000 },
    { "id": "e7e59154-1f05-4a28-a5eb-ce52c6a0d478", "budgetTitle": "12344", "description": null, "accountId": 2, "approvedAmount": 20000 }
  ]
}
```

Für einen späteren PATCH dieselben UUIDs verwenden und die zuletzt gelesene
`card.budgetRevision` als `budgetRevision` mitsenden. Ein PATCH ohne
`budgetPositions` darf keine `budgetRevision` enthalten.

> **Nicht zu verwechseln:** Für native Android-/iOS-Apps gibt es zusätzlich eine
> **öffentliche, nicht authentifizierte** API zum Einreichen von Anträgen unter
> `/api/public/v1` — siehe [PUBLIC_API.md](PUBLIC_API.md). Sie hat einen eigenen
> Namespace, eigene Rate-Limits und verlangt einen `Idempotency-Key`.

## Interaktive Dokumentation (Swagger UI)

| Was | Adresse | Zugang |
|-----|---------|--------|
| **Swagger UI (intern)** | `/api/v1/docs` | **Anmeldung erforderlich** (Gremio-Web-Session) |
| **OpenAPI-JSON (intern)** | `/api/v1/openapi.json` | **Anmeldung erforderlich**, sonst `401` |
| YAML im Repo | [`openapi-v1.yaml`](openapi-v1.yaml) | generiert, nicht von Hand pflegen |

Die Oberfläche zeigt alle Endpunkte dieser Seite mit Schemas, Beispielen und
Fehlerantworten und erlaubt „Try it out" direkt im Browser.

**Zwei getrennte Stufen — die Anmeldung ersetzt den Token nicht:**

1. Die **Web-Session** berechtigt nur dazu, die Dokumentation zu *öffnen*. Ohne
   Anmeldung leitet `/api/v1/docs` auf `/login`, und `/api/v1/openapi.json`
   antwortet mit `401`.
2. Für **„Try it out"** hinterlegst du oben rechts über **Authorize** deinen
   eigenen API-Token. Er bleibt im Browser; der Server erzeugt zu keinem
   Zeitpunkt selbst einen Token aus deiner Session.
3. Die aufgerufene Route prüft den Bearer-Token **unabhängig davon** erneut —
   inklusive Rechtestufe, Board-Beschränkung und aller Board-, Gruppen- und
   Rollenrechte. Ein Aufruf ohne oder mit ungültigem Token ergibt `401`, ein
   Schreibzugriff mit einem `read`-Token `403`.

Swagger sendet den Token als:

```
Authorization: Bearer grm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

YAML neu erzeugen (aus `lib/openapi-v1.ts`):

```bash
npm run openapi:internal:yaml
```

`npm run openapi:yaml` erzeugt beide Spezifikationen, `npm run openapi:public:yaml`
nur die öffentliche. Öffentliche und interne Spezifikation bleiben bewusst
**getrennte Dokumente** — die öffentliche Doku unter
[`/api/public/docs`](PUBLIC_API.md) enthält keine internen Routen, und
umgekehrt.

## Authentifizierung

Jede Anfrage benötigt einen **persönlichen API-Token** im Header:

```
Authorization: Bearer grm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Tokens werden unter **Mein Konto → API-Tokens** (`/intern/konto`) erstellt und
  widerrufen.
- Ein Token ist an **einen Nutzer** gebunden und erbt **alle** dessen
  Board-Zugriffe: eigene Boards + Freigaben (direkt als Nutzer **oder** über eine
  Gruppe) + (bei Admins) alle Boards. Ein Token reicht also für sämtliche Boards
  des Nutzers.
- Der Klartext wird **nur einmal** bei der Erstellung angezeigt; gespeichert wird
  nur ein SHA-256-Hash.
- Ohne/mit ungültigem Token → `401`. Widerrufene Tokens sind **sofort** ungültig.

### Scopes (pro Token wählbar)

- **Rechtestufe** — `write` (lesen **und** schreiben) oder `read` (nur `GET`).
  Mit einem `read`-Token werden `POST`/`PATCH`/`DELETE` mit `403` abgelehnt.
- **Board-Beschränkung** — optional auf bestimmte Boards begrenzen. Ohne
  Auswahl gilt der Token für **alle** Boards des Nutzers (auch künftige). Beim
  Erstellen werden veraltete oder unzulässige Board-Auswahlen vollständig
  abgewiesen, damit keine gewählte Beschränkung verloren geht. Maximal 20 Tokens
  pro Nutzer werden auch bei paralleler Anlage durchgesetzt. Die
  Beschränkung wirkt **zusätzlich** zur Live-Zugriffsprüfung: Ein Token gewährt
  nie mehr, als der Nutzer selbst aktuell darf. Nicht erlaubte Boards →
  `404`.

`GET /api/v1` zeigt den aktiven Scope des Tokens (`token.scope`,
`token.boards`).

### CORS (optional)

Ohne Konfiguration setzt `/api/v1` keine CORS-Header. Mit
`CORS_ALLOWED_ORIGINS` in der `.env` (kommagetrennte, exakte Origins wie
`https://app.example.org`) dürfen diese Seiten die API aus dem Browser aufrufen:
Preflights erlauben `GET, POST, PATCH, DELETE` sowie die Header
`Authorization, Content-Type`; `Retry-After` und `Content-Disposition` sind
lesbar. `Access-Control-Allow-Credentials` wird nie gesetzt — der Browser
schickt keine Gremio-Sitzung mit, jede Anfrage braucht weiterhin einen
Bearer-Token mit passendem Scope. `*` ist nicht erlaubt. Dieselbe Liste gilt für
die öffentliche API (siehe `docs/PUBLIC_API.md`); MCP und OAuth bleiben davon
unberührt.

## Konventionen

- Alle Bodies und Antworten sind `application/json`.
- Geldbeträge sind **Integer in Cent** (`requestedAmountCents`, `approvedAmountCents`, `actualAmountCents`).
- Datumsfelder sind Strings im Format `YYYY-MM-DD` (oder `null`).
- Zeitstempel (`createdAt`, `updatedAt`) sind ISO-8601.
- Unbekannte Body-Felder werden mit `400` abgelehnt (Tippfehler-Schutz).
- IDs sind positive int32-Werte. Ungültige Pfad-IDs ergeben `404`, ungültige
  `statusId`-/`archived`-Filter `400` statt stillschweigend ungefilterter Ergebnisse.
- Fehler: `{ "error": "…", "issues"?: [...] }`.

## Endpunkte

### `GET /api/v1`
Discovery: bestätigt den Token und listet die Endpunkte.

### `GET /api/v1/boards`
Alle zugänglichen Boards.

```json
{ "boards": [
  { "id": 1, "name": "Antragsboard", "description": null,
    "ownerId": 3, "role": "owner", "createdAt": "2026-01-02T…" }
] }
```
`role` ∈ `owner` | `admin` | `member`.

### `GET /api/v1/boards/{id}`
Board mit Spalten und sichtbaren Kartenfeldern.

```json
{
  "board": { "id": 1, "name": "…", "role": "owner", … },
  "statuses": [
    { "id": 10, "name": "Eingegangen", "position": 0,
      "isArchiveTrigger": false, "isInstructionTrigger": false,
      "isTransferTrigger": false, "isReceiptTrigger": true }
  ],
  "visibleFields": ["applicant", "priority", "deadline", …]
}
```

`ownerId`, `receiptToStatusId` und `resubmitStatusId` am Board sowie
`isInstructionTrigger`, `isTransferTrigger` und `isReceiptTrigger` an den
Spalten erscheinen nur für Eigentümer/Admins. `isArchiveTrigger` bleibt für
Mitglieder sichtbar. Archiv- und Quittungsquellen können auf mehreren Spalten
aktiv sein. Quittungen benötigen zusätzlich eine Zielspalte; die Archiv-Sperre
hat Vorrang. Diese Angaben sind lesende Metadaten, keine neuen Schreibrechte
für Board-Einstellungen.

### `GET /api/v1/boards/{id}/cards`
Karten des Boards, sortiert nach Spalte und Position.
Optionaler Filter `?statusId=10`. Standardmäßig **ohne** archivierte
(erledigte) Karten — `?archived=true` zeigt nur archivierte, `?archived=all`
beide; `?archived=false` entspricht dem Standard. Antwort-Karten enthalten
`archivedAt` (null = aktiv).

```json
{ "cards": [ { "id": 42, "boardId": 1, "statusId": 10,
  "statusName": "Eingegangen", "title": "Grillabend am FB5", … } ] }
```

### `POST /api/v1/boards/{id}/cards`
Neue Karte anlegen. Pflicht: `title`. Ohne `statusId` landet sie in der
ersten Spalte. Ist die Board-Nummerierung aktiv, wird automatisch eine
Antragsnummer vergeben.

```bash
curl -X POST -H "Authorization: Bearer grm_…" \
  -H "Content-Type: application/json" \
  -d '{"title":"Grillabend am FB5","applicant":"Max Mustermann","priorityId":3}' \
  https://deine-app.de/api/v1/boards/1/cards
```
→ `201 { "card": { … }, "budgetPositions": [] }` (Positionen bei Mehrfachmodus)

### `GET /api/v1/me/cards`
Alle dem Token-Nutzer **zugewiesenen** Karten board-übergreifend (inkl.
`boardName`, `statusName`). Standardmäßig ohne archivierte; `?archived=true|all`
wie oben.

### `GET /api/v1/cards/{id}`
Einzelne Karte (inkl. `statusName`, `boardName`).

### `PATCH /api/v1/cards/{id}`
Felder ändern und/oder Karte **verschieben**. Alle Felder optional; nur
übergebene Felder werden geändert (`null` löscht ein Feld).

- **Spalte wechseln:** `statusId` setzen → Karte landet am Ende der Zielspalte,
  Aktivität wird protokolliert, weiterhin verfügbare Trigger (Nextcloud-Archiv auf normalen Boards und Antragsboards; Done nur auf normalen Boards) greifen wie in der UI — einschließlich der in den
  Board-Einstellungen hinterlegten Trigger-Zuweisungen (Zuweisungen entfernen
  und/oder Nutzer zuweisen). Wird im selben Request `assigneeUserIds`
  übergeben, gilt diese Liste. Nachreichungsmarkierung und
  Done-Archivierungsfrist werden entsprechend aktualisiert.
- **Innerhalb/zwischen Spalten einsortieren:** zusätzlich `position` (0-basiert).

```bash
# Karte in Spalte 12 an die zweite Position verschieben
curl -X PATCH -H "Authorization: Bearer grm_…" \
  -H "Content-Type: application/json" \
  -d '{"statusId":12,"position":1}' \
  https://deine-app.de/api/v1/cards/42
```
→ `200 { "card": { … }, "budgetPositions": […] }`

Schreibbare Felder: `title`, `applicant`, `budgetTitle` (max. 60 Zeichen),
`number`, `statusId`, `position`, `priorityId`, `accountId`, `assigneeUserIds`
(Array, ersetzt die Zuweisungen vollständig; `[]` entfernt alle, auch bei einem
PATCH mit ausschließlich diesem Feld), `creatorUserId`, `deadline`,
`meeting`, `decisionRef`, `instructionDate`, `transferDate`,
`requestedAmountCents`, `approvedAmountCents`, `actualAmountCents`, `notes`, `applicantNote`,
`budgetPositions` und `budgetRevision` (Regeln siehe oben),
`archived` (nur `false` = wiederherstellen; `true`/manuelles Archivieren wird
mit 400 abgelehnt, da es im Web ebenfalls keine manuelle Archivierung gibt).
`number`, `instructionDate` und `transferDate` dürfen — wie im Web — von jedem
Nutzer mit Board-Schreibrecht geändert werden. Wiederherstellen (`archived: false`)
erfordert ebenfalls Board-Schreibrecht.
Deaktivierte Board-Felder werden mit 400 abgelehnt.

Referenzen werden geprüft: `statusId` muss zum Board gehören; `priorityId`/
`accountId` müssen existieren; `assigneeUserIds`/`creatorUserId` müssen
Board-Zugriff haben (sonst `400`).

### `DELETE /api/v1/cards/{id}`
Karte und ihre Anhänge löschen. → `200 { "ok": true }`

## Statuscodes

| Code | Bedeutung |
|------|-----------|
| 200  | OK |
| 201  | Karte erstellt |
| 400  | Ungültige Eingabe |
| 401  | Token fehlt/ungültig |
| 403  | Token hat nur Lese-Rechte (`scope=read`) oder der Nutzer hat nur lesenden Board-Zugriff |
| 404  | Board/Karte nicht gefunden **oder** kein Zugriff (auch Board-Scope) |
| 409  | Leihvorgang-Board: Karten dort sind über die API nur lesbar (Anlegen/Ändern/Löschen läuft übers Inventar) |

> Zugriffskontrolle: Wer ein Board nicht sehen darf, bekommt `404` (nicht `403`)
> — die Existenz wird nicht preisgegeben.

## Erweiterungen: Auswahlkataloge, Suche, Kommentare und Anhänge

Alle folgenden Routen verwenden dieselben persönlichen Tokens, Live-Boardrechte,
Board-Beschränkungen und Feldsichtbarkeiten. Die öffentliche API bleibt unverändert.

| Methode / Pfad unter `/api/v1` | Funktion |
| --- | --- |
| `GET /boards/{id}/users` | Aktive zuweisbare Nutzer (`id`, `username`, `name`), Suchtext `q`, `limit`, `offset`. Ersteller oder Zuständige müssen am Board aktiviert sein. |
| `GET /boards/{id}/accounts` | Gemeinsamer auswählbarer Kontenkatalog (`id`, `name`, `position`), wenn Konto am Board aktiviert ist. Keine Kontostände/Finanzübersichten. |
| `GET /boards/{id}/priorities` | Prioritäten (`id`, `label`, `color`, `position`), wenn Priorität aktiviert ist. |
| `GET /cards` | Boardübergreifende Suche innerhalb des erlaubten Zugriffs; immer paginiert. |
| `GET /cards/{id}/comments` | Kommentare, neueste zuerst, inklusive Autor-Anzeigename/-Benutzername; paginiert. |
| `POST /cards/{id}/comments` | Kommentar hinzufügen: `{ "body": "…" }` (1–5000 bereinigte Zeichen). |
| `PATCH /cards/{id}/comments/{commentId}` | Eigenen Kommentar bearbeiten: gleicher Body; auch Verwalter können keine fremden Kommentare umschreiben. Erstellungszeit bleibt erhalten. |
| `DELETE /cards/{id}/comments/{commentId}` | Eigener Kommentar oder Board-Verwalter; zusätzlich Schreib-Scope. |
| `GET /cards/{id}/activity` | Unveränderlicher Verlauf, neueste zuerst; paginiert. |
| `GET /cards/{id}/attachments` | Sichtbare Anhänge mit Metadaten und geschütztem `downloadPath`; paginiert. |
| `GET /cards/{id}/attachments/{attachmentId}` | Binärdownload mit Bearer-Token, `no-store`, `nosniff` und sicherem Dateinamen. |
| `POST /cards/{id}/attachments` | Multipart-Upload mit genau `file` und `kind`. |

**Suche/Filter** gelten für `/cards`, `/boards/{id}/cards` und `/me/cards`:
`q`, `boardId`, `statusId`, `priorityId`, `accountId`, `assigneeUserId`,
`unassigned=true|false`, `archived=false|true|all`, `deadlineBefore=YYYY-MM-DD`,
`deadlineAfter=YYYY-MM-DD`, `overdue=true|false`, `sort=position|updated|deadline`,
`limit` und `offset`. Datumsschranken sind exklusiv. `overdue=true` bedeutet:
Deadline vor heute (Europe/Berlin), nicht archiviert und auf normalen Boards nicht in einer wirksamen Done-Spalte. Auf Antragsboards werden alte Done-Einstellungen ignoriert.
`accountId` berücksichtigt auch Haushaltspositionen. `q` sucht einen wörtlichen,
case-insensitiven Teilstring in Titel und sichtbarer Nummer, Antragsteller, Notizen
und Haushaltstitel; `%` und `_` sind keine Wildcards. Verborgene Felder können auch
über Filter oder Deadline-Sortierung nicht erschlossen werden. Unbekannte oder
ungültige Suchparameter ergeben 400; ein unerlaubter expliziter Boardfilter 404.

**Pagination:** `limit=1..100` (Standard 50), `offset=0..1000000` (Standard 0).
Antworten ergänzen `pagination: { limit, offset, hasMore }`. Bei `hasMore=true`
`offset` um `limit` erhöhen. Die alten Board-/Meine-Kartenlisten bleiben ohne
`limit`/`offset` ungekappt, um vorhandene Integrationen nicht still zu verkürzen.
Der neue `/cards`-Endpunkt und die neuen Kommentar-/Datei-/Verlaufs-/Nutzerlisten
sind standardmäßig paginiert. Sortierungen haben einen stabilen ID-Tiebreaker;
Offset-Seiten bilden keinen gemeinsamen Snapshot über parallele Änderungen.

**Verlauf:** Änderungsdaten werden nicht umgeschrieben oder gelöscht. Details zu
inzwischen ausgeblendeten Zuständigen/Deadlines sind `null`. Datei- und
Archiv-Ereignisse erhalten allgemeine Texte statt alter Dateinamen oder interner
Pfade; unbekannte Ereignisdetails werden vorsichtshalber nicht ausgegeben.

**Dateien:** Maximal 25 MiB je Datei. `kind` ist `finance_request`, `annex_a`,
`annex_b`, `student_card` oder `other`. PDF ist überall erlaubt; `student_card`
erlaubt zusätzlich PNG/JPEG. Benannte Slots ersetzen vorhandene Dateien; die vorherige Datei bleibt 30 Tage im Datei-Papierkorb des Boards wiederherstellbar.
`other` fügt hinzu. Ein deaktiviertes Anhangfeld ergibt beim Upload 400, beim
Download 404 und wird in Listen ausgelassen. Generierte Anweisungsdateien folgen
der bestehenden Sichtbarkeitsausnahme. Antwort: 201 `{ attachment: … }` ohne
Speicherpfad. Zu große Request-Bodies ergeben 413. Schreibende Aktionen auf
Inventar-Systemboards bleiben auch für Kommentare und Anhänge gesperrt (409).

Kommentare sind interne Diskussionen, keine öffentlichen Antragstellerhinweise.
Die API bietet keine freie Bearbeitung der Aktivitätshistorie und keine
PDF-Bearbeitung, digitale Signatur oder externe Datei-URL-Importe.

### PDF-Inhalt als Text

`GET /api/v1/cards/{id}/attachments/{attachmentId}/text` benötigt Leserechte auf
das Board und einen sichtbaren PDF-Anhang. `startPage` beginnt bei 1 (Standard 1);
`pageLimit` ist 1–20 (Standard 10). Die Antwort enthält `attachmentId`, `filename`,
`totalPages`, `pages` mit Seitentext und `formFields` (`name`, `type`, `value`),
zusammengefassten `text`, `nextPage`, `truncated` und `warnings`. Formularwerte
entsprechen den gespeicherten PDF-Werten, z. B. `Yes`/`Off` bei Checkboxen.

Keine OCR oder Veränderung der Datei. Bildseiten ohne Textebene werden durch
Warnungen gekennzeichnet; Signaturgültigkeit wird nicht geprüft. Pro Aufruf
höchstens 200.000 Zeichen, 500 Formularfelder je Seite und 15 Sekunden; maximal
zwei parallele Extraktionen pro Prozess und 30 Anfragen pro Nutzer/Minute.
Nicht-PDF: 415; Datei über 25 MiB: 413; Passwortschutz, reine XFA-Formulare oder
unlesbares PDF: 422; ungültige Seitenauswahl: 400; Auslastung/Rate-Limit: 429.
Bei `nextPage` weitere Seiten abrufen, `truncated` niemals als vollständige
Extraktion interpretieren. Vertrauliche Antworten verwenden `Cache-Control: no-store`.

### Live read/write grants

Board, finance and inventory sharing supports `read` and `write` grants for
individual users and groups. Any matching write grant wins; owners and admins
retain full access. Existing grants are migrated to `write` by migration 0070.
All internal REST/MCP mutations require both live board write access and token
`scope=write`. A read-only board grant returns HTTP 403 for writes, even with a
write-scoped token. Reading and downloads remain available. Full management remains owner/admin-only. Explicit board delegates may configure
the limited settings listed below through the session-bound UI; this adds no
external sharing/settings endpoints.

### Restricted office status moves

An optional office assignment on a normal board supplements an existing reader's
permissions with explicitly configured source-to-target status changes. It never
grants board read access. A direct or group write grant always takes precedence.
Without full write access, the only additional REST/MCP operation is
`PATCH /cards/{id}` with exactly `{ "statusId": targetId }`, a write-scoped token,
an active card and an allowed current source and target. Other fields (including
`position` or `archived`), mixed payloads and every other mutation remain denied.
The current source is rechecked under the card lock. Restricted moves append to
the target column, run normal status triggers and never reorder other cards.
Office configuration is owner/admin-only in Board settings; no sharing endpoint
is added. Revoked read access also revokes the supplemental movement permission.


### Spalten-E-Mails

Instanzweites SMTP und Bestätigungen werden ausschließlich im Admin-Dashboard verwaltet. Board-Einstellungen erlauben Eigentümern/Admins sowie ausdrücklich ernannten Board-Verwaltern Spaltenregeln mit Empfangsadressen. Neue Karten oder echte Statuswechsel über UI, REST oder MCP erzeugen atomar eine Nachricht pro Empfänger in der Outbox, sofern SMTP und die Zielspalten-Regel aktiviert sind. Positionsänderungen und No-op-Statusupdates senden nichts. Versand läuft nach dem Commit; API-Antworten und Berechtigungen bleiben unverändert. Es gibt keine neuen SMTP-Konfigurationsendpunkte und keine Kontaktadressen in öffentlichen Karten-/Statusantworten.


### Sitzungen: getrennte Berechtigungen und sessiongebundene Downloads

Sitzungen und TOPs werden in dieser Version ausschließlich über authentifizierte Seiten/Server Actions verwaltet. Es gibt keine neuen v1-Bearer- oder MCP-Funktionen. Bestehende Kartenantworten und ihre Berechtigungen bleiben unverändert; Sitzungsfreigaben gewähren keinen Board-Zugriff. Kartenreferenzen werden nach aktuellen Board-Rechten gefiltert, einschließlich RSC-Daten und Auswahllisten.

`GET /api/meetings/{id}/pdf`, `GET /api/meetings/{id}/word`, `GET /api/meeting-areas/{id}/word-template` und `GET /api/meeting-document/{id}` akzeptieren ausschließlich eine aktive Benutzersession. Fehlende Anmeldung ergibt 401, unzugängliche oder fehlende Ressourcen 404. Antworten sind private/no-store/no-referrer. Ein API-Token ersetzt die Session nicht. PDF- und Wordexport sowie der Originalvorlagen-Download sind ausschließlich für Eigentümer/Admins verfügbar; gewöhnliche Lesende und Schreibende erhalten 404. Die Tagesordnungsexporte enthalten auch vertrauliche TOPs und Unterlagen-Dateinamen. Das PDF behält seine bisherige Gestaltung. Word wird nur bei hinterlegter DOCX-/DOTX-Vorlage angeboten und verwendet die zugeordneten Absatzformatvorlagen des Bereichs. Ein fehlender oder ungeeigneter Vorlagenstand ergibt beim Wordexport für bereits autorisierte Verwaltungsnutzer 422 mit Fehlermeldung. Finanz-Unter-TOPs ergänzen Antragsnummer/Titel, Antragsteller, Konto, Haushaltstitel, beantragten Betrag und internen Kartenlink ausschließlich nach aktuellen Board-/Feldrechten des Exportierenden. Gewöhnliche Kartenreferenzen werden nicht expandiert. Finanzanträge-Einplanung benötigt Sitzungs- und Board-Schreibrechte und aktualisiert Karte und Unter-TOP gemeinsam; diese Aktionen sind keine Bearer-/MCP-Endpunkte. Eigenständige Dateikopien folgen TOP-/Sitzungsrechten, ihre Quelldateien unverändert Board-/Feldrechten.

Sitzungsrechte werden über `meeting_areas` und `meeting_area_access` vergeben, nicht pro Sitzung. Berechtigungsprüfungen von TOPs, Referenzen, PDF-Export und Unterlagen folgen bei jedem Zugriff den aktuellen Bereichsfreigaben. Neue Sitzungen gewähren ihrem Ersteller keine zusätzlichen Eigentümerrechte; die Bereichsrechte bleiben maßgeblich. Bereichsfreigaben erweitern niemals Board-/API-Token-/MCP-Rechte. Der Bereichsname wird als Gremienbezeichnung abgeleitet.

Beide Tagesordnungsexporte enthalten auch gespeicherte TOP-Ergebnisse/Notizen. Wordvorlagen mit aktiven Office-Inhalten, externen Datenfeldern oder externen Ressourcen werden beim Upload und Export abgewiesen; sichere HTTP(S)-/E-Mail-/Telefon-Hyperlinks bleiben erlaubt. Eine bereits gespeicherte ungeeignete Vorlage erzeugt für die berechtigte Verwaltung weiterhin 422 beim Wordexport. Leere Sitzungs-Metadaten ersetzen alte Musterwerte durch leere Inhalte. Die öffentlichen und Bearer-/MCP-Verträge bleiben unverändert.

### Lokale Nutzersperre und Browser-Sitzungen

Administratoren können Nutzer lokal deaktivieren. Die vorhandene Prüfung des aktuellen `users.is_active` sperrt auch Bearer-API-/MCP-Zugriffe während dieser Sperre. Browser-Sitzungen gelten mit `offline_access` fest 14 Tage und werden zusätzlich spätestens alle fünf Minuten über SSO-Introspection bestätigt (die Prüffrist ist keine Sitzungsablauffrist) und durch `users.session_version` bei lokaler Sperre dauerhaft widerrufen. Die SSO-Prüfung ist keine neue Abhängigkeit für separat ausgestellte Bearer-Token; deren Scopes und Verträge bleiben unverändert.

### Mehrere Board-Eigentümer

Zusätzliche Eigentümer haben dieselben Live-Rechte wie der unter `ownerId` geführte Eigentümer. Boardlisten, `role`, geschützte Felder und Managementprüfungen verwenden diese Rechte auch bei Bearer-API-/MCP-Zugriffen; Token-Scopes und Boardbeschränkungen bleiben verbindlich. `ownerId` bleibt aus Kompatibilitätsgründen ein tatsächlicher Eigentümer und wechselt gegebenenfalls beim Austritt dieser Person. Die Ernennung und Entfernung erfolgt ausschließlich über die authentifizierten Einstellungen mit Texteingabe, nicht über eine neue externe API. Der letzte Eigentümer bleibt serverseitig geschützt.

Die Gestaltung öffentlicher Empfangsbestätigungen wird instanzweit durch Admins gepflegt. `/api/receipt-logo` ist ausschließlich eine private Admin-Session-Vorschau und akzeptiert keine Bearer-API-Token. Öffentliche Bestätigungs-PDFs behalten ihre bisherigen Token-, Cache- und Datenschutzregeln; das neue Layout erweitert keine öffentlich sichtbaren Einreichungsdaten.

### Appweite Live-Invalidierung (nur Browser-Session)

`GET /api/app/stream` benötigt eine aktive Browser-Sitzung; Bearer-Token allein ergeben 401. Der Stream überträgt ausschließlich `data: change` ohne fachliche Daten. Lokale Aktivierung, Sitzungsversion und SSO werden während der Verbindung erneut geprüft. Der anschließende Seitenabruf prüft sämtliche aktuellen Board-/Bereichs-/Rollenrechte. Änderungen aus REST/MCP und Hintergrundprozessen werden über DB-Commit-Benachrichtigungen ebenfalls sichtbar; vorhandene externe API-/MCP-Verträge und Scopes bleiben unverändert. Öffentliche Status-Streams behalten ihre eigene Token-/Zugriffsprüfung.

Die Admin-Vorschau `GET /api/receipt-logo` kann optional die Parameter
`kind=location|feedback` und `id` für ein eigenes Standort-/Umfragelogo erhalten.
Sie bleibt ausschließlich admin-sessiongebunden (sonst 404) und private/no-store;
keine Bearer-/MCP-Erweiterung. Empfangs-PDFs und Bestätigungs-E-Mails lösen das
Branding nach der tatsächlich gewählten Formularquelle auf. Die bestehenden
öffentlichen JSON-Antworten enthalten keine neuen Branding-Felder.

TOP-Statuswechsel und Übernahmen bleiben sessiongebundene Server Actions. Die
persönliche Ursprungsreferenz gewährt keine zusätzlichen Sitzungsrechte;
Verlaufsanzeigen und Zielverweise werden nach aktueller TOP-/Sitzungsberechtigung
gefiltert. Lesende dürfen eigene Themenspeicher-Einträge innerhalb der
Einreichungsfrist als neue Sitzungsvorschläge einreichen, ohne den privaten
Ursprung zu verschieben. Historische übernommene TOPs sind schreibgeschützt.
Die externen Bearer- und MCP-Verträge bleiben unverändert.

Der persönliche TOP-Aktivitätsverlauf ist eine sessiongebundene Anzeige mit
chronologischen, transaktional erfassten Zustandsereignissen. Jeder Eintrag wird
nach aktuellen TOP-/Sitzungsrechten gefiltert; es gibt keine neue öffentliche
oder Bearer-/MCP-Schnittstelle und keine Ereignis-Bearbeitungsroute.

Eigene zurückgezogene Themen können über sessiongebundene persönliche Aktionen
neu vorgeschlagen oder privat erledigt werden. Der ursprüngliche Sitzungs-TOP
bleibt beim persönlichen Abschluss zurückgezogen. Sein Status bleibt über die
normalen Schreibrechte änderbar; solange er zurückgezogen ist, wird er nicht in
eine andere Sitzung übernommen. Private Erledigung erweitert keine
Sitzungs-/Boardrechte und ist keine neue Bearer-/MCP-Funktion.

Das Board-Metadatenfeld `visibleFields` kann auch `submitter_email` enthalten.
Die Kontaktadresse bleibt ein internes UI-Feld und wird über REST/MCP weder
ausgegeben noch als Karten-Schreibfeld akzeptiert.

### Dauerhaft gesperrte Antragskarten

Die sessiongebundene Weboberfläche kann Antragskarten nach ausdrücklicher
Bestätigung dauerhaft sperren. Auch API-/MCP-Schreibrechte heben diese Sperre
nicht auf: Inhalte, Zuordnungen, Kommentare, bestehende Anhänge, Haushaltspositionen
und Löschung sind danach geschützt. Spaltenwechsel bleiben nach den vorhandenen
Board- und Tokenrechten möglich. Der interne Kartenstatus kann vor der
Sperrbestätigung vom noch bestätigten öffentlichen Status abweichen.
`POST /api/v1/cards/{id}/lock` sperrt mit `{ "confirm": true,
"expectedStatusId": 123 }` ausdrücklich und unwiderruflich. Erforderlich sind ein
aktives Antragsboard, die aktuelle Sperrspalte, Schreib-Token und aktuelles
Board-Schreibrecht. Es gibt keinen Weg zum Entsperren. `card.lockedAt`, `lockedBy`
und `publicStatusId` sind ausschließlich lesbare Metadaten; Board/Spalten liefern
`isApplicationBoard`, `completedStatusId` und `isLockColumn`.

Bei aktivierter Nextcloud-Archivierung startet ein Archiv-Trigger erst mit dem
bestätigten öffentlichen Status. Ein Wechsel in eine unbestätigte Sperrspalte
archiviert noch nicht; der Sperraufruf startet die Archivierung nach dem Commit.
Normale Archivspalten und spätere Wechsel bereits gesperrter Karten archivieren
sofort. Archivlink und Wiederholungszustand werden ausschließlich intern gepflegt;
dadurch werden keine gesperrten Karteninhalte bearbeitbar.

`GET /api/v1/cards/{id}/budget-plan` liefert `{ revision, allocations }` mit
`{ amountCents, accountId, budgetTitle }` je Zeile. PATCH ersetzt diese separate Einplanung
vollständig mit der zuletzt gelesenen Revision; `allocations: []` entfernt sie.
Die Buchhaltungspositionen und Kartenbeträge werden dabei nicht verändert.
Gesperrte Karten erlauben ausschließlich einen begründeten Korrektureintrag für die Einplanung; andere gesperrte Schreibvorgänge und veraltete Revisionen ergeben 409 ohne Teiländerungen.

Quittungen werden über den bestehenden Multipart-Upload mit `kind=other` und
`uploadPurpose=receipt` ergänzt und automatisch nach dem Q-Schema benannt.
`uploadPurpose` wird in der internen Anhangsliste mitgeliefert. Alle anderen
Uploads, Kommentare, Zuweisungen und Löschungen gesperrter Karten werden
abgewiesen; bestehende Dateien bleiben erhalten. Kombinierte Kartenänderungen
werden einschließlich expliziter Zuweisungen atomar geprüft.

MCP bietet dieselben drei neuen Antragsmethoden (`lock_application_card`,
`get_budget_plan`, `update_budget_plan`) und den Quittungszweck beim bestehenden
`upload_attachment`. Token-Scope, Board-Beschränkung und aktuelle Rechte gelten
unverändert. Der öffentliche Vertrag erhält keine dieser internen Methoden.

**Kassenbücher bleiben vollständig außerhalb der Bearer-API und von MCP:** keine
Erstellung, Abfrage, Bearbeitung, Freigabe, Buchung, Signatur oder Korrektur.
Die für die Oberfläche notwendigen Datei-/ZIP-Routen unter `/api/cashbook/`
verlangen eine aktive Webanmeldung und eigene Kassenbuchrechte; weder persönliche
API-Tokens noch MCP-Zugänge ersetzen diese Sitzung. Sie sind keine REST-Funktionen
für externe Clients und werden in keiner OpenAPI- oder MCP-Liste angeboten.

### Konten und Korrektureinträge der Einplanung

`GET/PATCH /api/v1/cards/{id}/budget-plan` enthält je Zeile `amountCents`,
`budgetTitle` und `accountId`. Fehlt `accountId` beim Schreiben, wird das
Standardkonto des Boards verwendet (bei Altboards ersatzweise das Kartenkonto).
Ein vorhandenes Konto ist für jede neue/aktualisierte Zeile Pflicht. Kontowechsel
gegenüber dem bisherigen Stand oder Standardkonto erfordern
`confirmAccountChange: true`.

Eine gesperrte Karte darf ihre Einplanung ausschließlich mit
`correction: { "reason": "Begründung", "confirmation": "BESTÄTIGEN" }`
und aktueller `revision` korrigieren. Der normale Karten-PATCH, die alten
Budgetpositionen und alle sonstigen Kartendetails bleiben gesperrt. Original und
jede Korrektur bleiben mit Person, Zeitpunkt, Begründung und vollständigen
Vorher-/Nachher-Werten erhalten. `update_budget_plan` im MCP verwendet denselben
Vertrag und dieselben Schreibrechte, Scopes und Boardeinschränkungen.

Neue Boards besitzen keine optionalen Einzelfelder `account`, `budget_title`,
`approved_amount`, `actual_amount`, `instruction_date` und `transfer_date` mehr. Bestehende Boards behalten diese Felder und ihre bisherigen
Werte und Funktionen. Das Standardkonto bleibt bei allen Boards einstellbar.
Die öffentliche API erhält keine Konten-, Planungs- oder Korrekturdaten hinzu.

### Session-bound exports

`GET /intern/kassenbuch/{id}/export` and the existing
`GET /finanzen/{id}/export` are browser-session downloads, not bearer API or MCP
methods. They require current read access; an office-only cashbook assignment is
insufficient. XLSX always contains the complete ledger/view, with optional
pre-export sorting and random-password sheet protection. PDF accepts validated
filters, sort criteria and column selection. Neither download mutates data or
expands the external API contracts. The public API remains unchanged.

### Fixed board types and attachment areas

New application boards are created by admins in the session-bound Admin Panel.
Ordinary board creation cannot create or convert application boards. Board type
and configured special attachment areas are fixed at creation. Existing board
values and attachment areas survive upgrades. Only the general file area remains
toggleable; receipt uploads require the independent receipts area, even when
other_pdfs is disabled. Internal REST/MCP uploads use the same field projection
and database guards and cannot add unconfigured attachment types. No new bearer
or MCP methods are introduced for board or public-module administration.

### Begrenzte Board-Verwaltung (sessiongebunden)

Normale Boards und Antragsboards können aktive Personen mit bestehendem direktem oder Gruppen-Schreibzugriff als begrenzte Board-Verwalter ernennen. Die Vergabe/der Entzug erfolgt ausschließlich durch Eigentümer/Admins über die authentifizierten Einstellungen. Freigegeben sind Sperrspalten/Zahlungsabschluss, Email-Settings, Freigaben, Spalten, Kartenfelder, automatische Antragsnummer, Trigger-Spalten, Standard-Konto und Nextcloud-Archiv. Ohne aktuellen Schreibzugriff ruht die Ernennung, bei erneutem Schreibzugriff gilt sie wieder; ihr ausdrücklicher Entzug entfernt sie vollständig.

Allgemein/Umbenennen, Bürokraft, Anweisungsformular, Eigentümerschaft/Löschen und die Ernennung selbst bleiben geschützt. Finanzboards, Kassenbücher und Leih-System-Boards erhalten keine delegierten Verwaltungsrechte. Der Bearer-Vertrag bleibt unverändert: keine neuen Einstellungs- oder Ernennungsendpunkte, kein `owner`-Status durch Delegation, unveränderte Sichtbarkeit geschützter Verwaltungsmetadaten. MCP verwendet dieselben bestehenden API-Grenzen; die öffentliche API bleibt unverändert.

### Entfernte Datums-Trigger und Done nur auf normalen Boards

Statuswechsel über Oberfläche, Sitzungsplanung, REST und MCP setzen weder Anweisungsdatum noch Überweisungsdatum automatisch. Bestehende Werte und die manuellen Schreibrechte alter Boards bleiben erhalten. `isInstructionTrigger`/`isTransferTrigger` bleiben als kompatible Verwaltungsmetadaten für Eigentümer/Admins enthalten, liefern aber stets `false`.

`isArchiveTrigger` funktioniert auf normalen Boards und Antragsboards wie bisher, einschließlich automatischer Nextcloud-Archivierung, öffentlicher Uploadsperre und Vorlagenübernahme. Ausschließlich die Done-Spalte entfällt auf Antragsboards: `doneStatusId` ist dort immer `null`, der Done-Sweep und die dazugehörigen Zuweisungen sind inaktiv. Historische Done-Konfigurationen bleiben gespeichert; Suchfilter/Statistiken behandeln die Spalte als gewöhnliche Spalte. Vorhandene archivierte Karten bleiben zugänglich. Normale Boards behalten Done und Nextcloud; Zahlungsabschluss bleibt unabhängig davon erhalten. Keine neuen API-/MCP-Funktionen.

### Begrenzte Inventar-Verwaltung (sessiongebunden)

Eigentümer/Admins können aktive Personen mit bestehendem direktem oder Gruppen-Schreibzugriff als Inventar-Verwalter ernennen. Die Delegation gilt ausschließlich für Email-Settings des tatsächlich verknüpften Leihvorgangsboards, Freigaben, Felder und automatische Inventarnummer. Umbenennen, Aufgabentracking, Eigentümerschaft, Löschen und Vergabe/Entzug der Verwaltungsrechte bleiben Eigentümer/Admin vorbehalten. Jeder Aufruf prüft aktuelle Schreibrechte; ohne diese ruhen die Rechte. Eine spätere Schreibfreigabe aktiviert eine bestehende Ernennung erneut; ausdrücklicher Entzug löscht sie.

Die vier Bereiche und die Ernennung verwenden ausschließlich authentifizierte Server Actions, keine neuen Bearer-/MCP-Endpunkte. `canManageInventoryBoard` und `canManageBoard` bleiben volle Eigentümerprüfungen; Delegation ändert die REST/MCP-Rolle eines System-Boards nicht. Normale Board-Verwaltung und Inventar-Verwaltung sind getrennt; Rechte anderer Ressourcen sowie öffentliche Token bleiben unverändert.

### Finanzübersichten anlegen

Die Anlage ist ausschließlich über das Admin-Panel und seine authentifizierte Server Action für aktive Administrationskonten verfügbar. Ein bestehender Finanzboard-Eigentümer oder Schreiber ohne globale Adminrolle darf keine neue Übersicht anlegen. Die bisherige `/finanzen/neu`-Seite leitet nur Admins ins Admin-Panel weiter; es gibt keine neuen Bearer-/MCP-Funktionen. Bestehende Finanzboard-Rechte bleiben unverändert. Die Navigation zeigt Finanzen nur mit aktuellem Zugriff auf mindestens eine Übersicht, einschließlich direkter/Gruppen-Lesefreigaben und Eigentümerschaften.

### Entfernen eines Inventar-Aufgabentrackingboards

Die sessiongebundene Server Action erfordert weiterhin vollständige Inventar-Verwaltung durch Eigentümer/Admin und zusätzlich die Bestätigung `LÖSCHEN`. Die tatsächlich eingegebene Bestätigung wird geprüft, bevor Verknüpfungen oder Daten verändert werden. Es gibt keinen neuen Bearer-Endpunkt. Das Board und seine Karten einschließlich Kartenkommentaren/-verlauf und nur dort abgelegten Anhängen werden gelöscht; laufende und alte Inventar-Leihvorgänge, Stückzuordnungen und Inventar-Dokumente bleiben erhalten. Nur die Tracking-Kartenverknüpfung entfällt.

### Haushaltstitel aus dem zugeordneten Haushaltsplan

Neue bzw. geänderte Haushaltstitel der Einplanung müssen als Ausgabentitel im
Finanzboard des jeweiligen Kontos vorhanden sein. Fehlende Zuordnung oder fremde
Titel ergeben 409 ohne Teiländerung; dies gilt auch für Korrektureinträge und MCP.
Ein zuvor gespeichertes Konto/Titel-Paar darf unverändert erhalten bleiben, auch
wenn es inzwischen nicht mehr im Plan steht. Solche historischen Zeilen dürfen
nicht durch zusätzliche Kopien vermehrt werden. Es gibt keinen neuen öffentlichen
oder Bearer-Endpunkt für die Titelkataloge; die interne Oberfläche bietet die
konfigurierten Nummern und Bezeichnungen zur Auswahl. Planbeträge werden dadurch
nicht freigegeben. Kassenbuch-Zuordnungen und Buchungen bleiben sessiongebunden.


## Papierkorb und Verfügbarkeit

Mit Worteingabe gelöschte Ressourcen werden 30 Tage intern aufbewahrt. Währenddessen sind sie und ihre abhängigen Inhalte über normale Ansichten, direkte Downloads sowie API/MCP nicht verfügbar (bei bestehenden Einzelressourcen-Endpunkten wie nicht vorhandene Daten, in Listen ausgelassen). Dies gilt auch für öffentliche Antrags-/Status-Tokens; dort werden keine Papierkorb-Metadaten offengelegt. Gelöschte Gruppen vermitteln keine Berechtigungen. Eine Wiederherstellung durch Admins reaktiviert die erhaltenen Daten und Freigaben, ohne Inhalte neu zu erzeugen. Antragsboards und Kassenbücher dürfen nur Admins in den Papierkorb verschieben.

Es wurden keine Bearer- oder MCP-Funktionen für Löschen ganzer Ressourcen, Papierkorbverwaltung oder Kassenbuch hinzugefügt. Wiederherstellen (`WIEDERHERSTELLEN`) und endgültiges Löschen (`ENDGÜLTIG`) sind geschützte, sessiongebundene Admin-Aktionen. Nach 720 Stunden ist die Wiederherstellung gesperrt; die automatische endgültige Bereinigung läuft täglich ab 03:00 Uhr Europe/Berlin. Öffentliche API-Felder und Token-Grenzen bleiben unverändert.


Der Datei-Papierkorb eines Boards ist ausschließlich über geschützte, sessiongebundene Board-Aktionen zugänglich. Gelöschte bzw. ersetzte Anhänge fehlen sofort in API-/MCP-Listen und liefern beim Download 404. Bestehende Upload-Endpunkte ändern weder Umfang noch Antwortschema. Schreibrechte und Anhangsfeld-Sichtbarkeit gelten auch bei Wiederherstellung/endgültiger Löschung; gesperrte Karten werden dabei nicht wieder bearbeitbar. Öffentliche Statusabfragen und ZIPs geben Papierkorbdateien nicht aus.


Nextcloud-Archivaufträge werden bei bestätigten Status-/Sperränderungen transaktional in einer internen Auftragsliste gespeichert. Ein Serverabbruch oder ein paralleler Upload verliert den Auftrag nicht; der interne Worker übernimmt ihn erneut. Erfolgsvermerk, Aktivität und Bestätigung des Auftrags sind atomar. Bestätigter öffentlicher Status, Sperren und Live-Anwendbarkeit bleiben Voraussetzung. Die Auftragsliste und ihre Bearbeitung erhalten keine externen REST-/MCP-Endpunkte; öffentliche Antworten enthalten weiterhin weder Archivpfade noch Auftrags- oder Zugangsdaten.


Die optionale Nextcloud-Archivierung von Kassenbuch-Anweisungen ist ausschließlich ein interner, sessiongebundener Ablauf. Nur der Kassenbucheigentümer verwaltet die verschlüsselte Verbindung. Beim Erteilen der Anweisung wird ein dauerhafter Auftrag gespeichert; keine externen REST-/MCP-Endpunkte erlauben Konfiguration, Buchen oder Bearbeiten der Archivaufträge. Öffentliche Antrags-/Status-Token geben weder Kassenbuchdateien noch Archivpfade, Zugangsdaten oder Jobmetadaten aus. Bestehende Buchungswerte und ihre Unveränderlichkeit bleiben erhalten.


Sitzungsbereiche unterstützen zusätzlich persönliche Verwaltungsfreigaben für
aktuelle Schreibberechtigte (`meeting_area_managers`). Diese erweitern nur die
sessiongebundenen Einstellungsaktionen und den Original-Wordvorlagen-Download.
Sie verleihen keine Eigentümerschaft, Lösch-/Ernennungsrechte, vertraulichen
TOP-Zugriff oder vertraulichen Sitzungsexporte. REST-/MCP-Scope bleibt unverändert.


Kartenlöschen nutzt seit dem Board-Kartenpapierkorb die 30-Tage-Aufbewahrung:
`DELETE /api/v1/cards/{id}` verlangt den JSON-Body
`{"confirmation":"LÖSCHEN"}`. Fehlende, falsche und zusätzliche Eingabefelder
werden mit 400 abgewiesen. Weiterhin sind Scope `write`, aktueller Board-Schreibzugriff
und ein zulässiges Board erforderlich; gesperrte Karten bleiben geschützt.
Nach Erfolg bleiben Inhalte/Dateien gespeichert, sind aber über normale
API-/öffentliche Abfragen nicht mehr abrufbar. Wiederherstellung und endgültiges
Löschen erfolgen im Board-Papierkorb über die Oberfläche.
