# Gremio REST-API (v1)

Externe Tools können über eine versionierte REST-API auf Boards und Karten
zugreifen. Die API ist bewusst schmal gehalten: Boards/Karten **lesen** und
Karten **anlegen, ändern, verschieben und löschen**.

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
- Geldbeträge sind **Integer in Cent** (`approvedAmountCents`, `actualAmountCents`).
- Datumsfelder sind Strings im Format `YYYY-MM-DD` (oder `null`).
- Zeitstempel (`createdAt`, `updatedAt`) sind ISO-8601.
- Unbekannte Body-Felder werden mit `400` abgelehnt (Tippfehler-Schutz).
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
      "isArchiveTrigger": false, "isInstructionTrigger": false }
  ],
  "visibleFields": ["applicant", "priority", "deadline", …]
}
```

### `GET /api/v1/boards/{id}/cards`
Karten des Boards, sortiert nach Spalte und Position.
Optionaler Filter `?statusId=10`. Standardmäßig **ohne** archivierte
(erledigte) Karten — `?archived=true` zeigt nur archivierte, `?archived=all`
beide. Antwort-Karten enthalten `archivedAt` (null = aktiv).

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
→ `201 { "card": { … } }`

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
  Aktivität wird protokolliert, Trigger (Anweisungsdatum, Nextcloud-Archiv)
  greifen wie in der UI.
- **Innerhalb/zwischen Spalten einsortieren:** zusätzlich `position` (0-basiert).

```bash
# Karte in Spalte 12 an die zweite Position verschieben
curl -X PATCH -H "Authorization: Bearer grm_…" \
  -H "Content-Type: application/json" \
  -d '{"statusId":12,"position":1}' \
  https://deine-app.de/api/v1/cards/42
```
→ `200 { "card": { … } }`

Schreibbare Felder: `title`, `applicant`, `budgetTitle` (max. 60 Zeichen),
`number`, `statusId`, `position`, `priorityId`, `accountId`, `assigneeUserIds`
(Array, ersetzt die Zuweisungen vollständig), `creatorUserId`, `deadline`,
`meeting`, `decisionRef`, `instructionDate`, `transferDate`,
`approvedAmountCents`, `actualAmountCents`, `notes`, `applicantNote`,
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
