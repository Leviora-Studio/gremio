# Gremio REST-API (v1)

Externe Tools können Boards/Karten **lesen** und Karten **anlegen, ändern,
verschieben und löschen**. Der Umfang bleibt bewusst auf diese Funktionen
begrenzt; Protokolle, Dokumenteditoren, Uploads und administrative Einstellungen
erhalten keine zusätzlichen externen REST-Endpunkte.

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
  Auswahl gilt der Token für **alle** Boards des Nutzers (auch künftige). Die
  Beschränkung wirkt **zusätzlich** zur Live-Zugriffsprüfung: Ein Token gewährt
  nie mehr, als der Nutzer selbst aktuell darf. Nicht erlaubte Boards →
  `404`.

`GET /api/v1` zeigt den aktiven Scope des Tokens (`token.scope`,
`token.boards`).

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
  Aktivität wird protokolliert, Trigger (Anweisungsdatum, Überweisungsdatum,
  Nextcloud-Archiv) greifen wie in der UI. Nachreichungsmarkierung und
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
Nutzer mit Board-Zugriff geändert werden. Wiederherstellen (`archived: false`)
darf ebenfalls jedes Board-Mitglied.
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
| 403  | Token hat nur Lese-Rechte (`scope=read`) bei Schreibzugriff |
| 404  | Board/Karte nicht gefunden **oder** kein Zugriff (auch Board-Scope) |
| 409  | Leihvorgang-Board: Karten dort sind über die API nur lesbar (Anlegen/Ändern/Löschen läuft übers Inventar) |

> Zugriffskontrolle: Wer ein Board nicht sehen darf, bekommt `404` (nicht `403`)
> — die Existenz wird nicht preisgegeben.
