# Gremio — Öffentliche API (`/api/public/v1`)

Öffentliche, **nicht authentifizierte** API zum Einreichen von **Anträgen** und
**Feedback**. Sie ist für **direkte native Android-/iOS-Clients** gedacht: kein
zwischengeschalteter Backend-Server, kein API-Token.

> **Abgrenzung:** Die authentifizierte Bearer-Token-API für interne Werkzeuge
> liegt unter `/api/v1` und ist in [API.md](API.md) beschrieben. Sie hat mit
> dieser hier nichts zu tun.

**Interaktive Doku:** `/api/public/docs` (Swagger UI, Assets lokal, kein CDN)
**Maschinenlesbar:** `GET /api/public/v1/openapi.json` (OpenAPI 3.1)
**Versionierte Spezifikation:** [`openapi-public.yaml`](openapi-public.yaml)
(generiert aus `lib/openapi-public.ts` via `npm run openapi:yaml`)

---

## CORS

Diese API setzt **bewusst keine CORS-Header** — insbesondere kein
`Access-Control-Allow-Origin: *`. Native Clients unterliegen keinem
Browser-CORS und brauchen sie nicht; ein pauschales Freigeben würde die
Endpunkte nur unnötig aus beliebigen Webseiten heraus aufrufbar machen.
Aus einem Browser ist die API damit nicht cross-origin nutzbar. Das ist gewollt.

---

## `GET /api/public/v1/locations`

Liefert genau die Standorte, die auch im öffentlichen Formular zur Auswahl
stehen: **aktiviert** und **vollständig geroutet** (Ziel-Board und Zielspalte
gesetzt, Zielspalte gehört zum Ziel-Board). Reihenfolge wie im Formular.

```bash
curl "https://gremio.example/api/public/v1/locations"
```

```json
{
  "locations": [
    { "id": 1, "name": "Standort A" },
    { "id": 4, "name": "Zentrale" }
  ]
}
```

| Code | Bedeutung |
|------|-----------|
| 200  | OK |
| 429  | Rate-Limit |
| 500  | Interner Fehler |

---

## `POST /api/public/v1/applications`

Reicht einen Antrag ein. **Nur `multipart/form-data`** — andere Content-Types
werden mit `415` abgelehnt.

### Felder

Dieselben Feldnamen wie im öffentlichen Formular:

| Feld | Typ | Pflicht | Erlaubt |
|------|-----|---------|---------|
| `locationId` | Text/Zahl | ✅ | ID aus `GET /locations` |
| `title` | Text | ✅ | max. 200 Zeichen |
| `applicant` | Text | ✅ | max. 200 Zeichen |
| `finance_request` | Datei | ✅ | PDF |
| `student_card` | Datei | ✅ | PDF, PNG, JPG |
| `annex_a` | Datei | ❌ | PDF |
| `annex_b` | Datei | ❌ | PDF |

**Uploadlimit:** 25 MB pro Datei. Größere Dateien → `413`.

### `Idempotency-Key` (Pflicht)

```
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

Druckbares ASCII **ohne Leerzeichen**, 16–128 Zeichen; empfohlen ist eine
**UUID v4**. Fehlt der Header oder ist er ungültig → `400`. Gespeichert wird
nur ein SHA-256-Hash, nie der Klartext.

### Beispiel

```bash
curl -X POST "https://gremio.example/api/public/v1/applications" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -F "locationId=1" \
  -F "title=Grillabend am FB5" \
  -F "applicant=Max Mustermann" \
  -F "finance_request=@finanzantrag.pdf;type=application/pdf" \
  -F "student_card=@ausweis.jpg;type=image/jpeg"
```

```json
{
  "statusUrl": "https://gremio.example/status/abc123",
  "receiptPdfUrl": "https://gremio.example/status/abc123/pdf",
  "number": "A_0042_2026"
}
```

`number` ist `null`, wenn die Nummerierung des Ziel-Boards deaktiviert ist.

Die Antwort enthält **bewusst nicht**: interne Karten-ID, `/intern/card/{id}`,
Ziel-Board, Zielspalte, Dateipfade oder Nextcloud-Informationen. `statusUrl` und
`receiptPdfUrl` werden ausschließlich aus der kanonischen `APP_BASE_URL`
gebildet — nie aus `Host` oder `X-Forwarded-Host`.

### Statuscodes

| Code | Bedeutung |
|------|-----------|
| 201  | Antrag neu angelegt |
| 200  | Idempotenz-Replay (zusätzlich `Idempotency-Replayed: true`) |
| 400  | Ungültige Eingabe, fehlende Pflichtdatei, unzulässiger Dateityp, fehlender/ungültiger `Idempotency-Key` |
| 404  | Standort nicht verfügbar |
| 409  | `Idempotency-Key` bereits für eine **andere** Einreichung verwendet |
| 413  | Datei oder Request zu groß |
| 415  | Content-Type ist nicht `multipart/form-data` |
| 429  | Rate-Limit (mit `Retry-After`) |
| 500  | Interner Fehler (generische Meldung) |

### Fehlerformat

```json
{ "error": "Der gewählte Standort ist nicht verfügbar." }
```

Bei Feldvalidierungen zusätzlich:

```json
{
  "error": "Bitte einen Antragsgegenstand angeben.",
  "issues": [
    { "field": "title", "message": "Bitte einen Antragsgegenstand angeben." }
  ]
}
```

Fehlermeldungen enthalten nie Stacktraces, SQL-Fehler, Dateipfade,
Status-Tokens, interne URLs oder Secrets.

---

## `GET /api/public/v1/feedback-areas`

Liefert genau die Feedback-Bereiche, die auch im öffentlichen Formular unter
`/feedback` zur Auswahl stehen: **aktiviert** und **vollständig geroutet**
(Ziel-Board und Zielspalte vorhanden, Zielspalte gehört zum Ziel-Board).
Sortiert nach `position` aufsteigend.

```json
{ "areas": [ { "id": 1, "name": "Bibliothek" } ] }
```

Statuscodes: `200`, `429`, `500`.

---

## `POST /api/public/v1/feedback`

Nimmt **ausschließlich `application/json`** entgegen (anders als der
Antrags-Endpunkt, der Dateien überträgt). Body-Grenze: **32 KiB**.

### Felder

| Feld | Typ | Pflicht | Regeln |
|------|-----|---------|--------|
| `areaId` | integer | ✅ | ID aus `GET /feedback-areas` |
| `submitterName` | string | — | getrimmt, max. 200 Zeichen. **Optional:** fehlt das Feld oder ist es leer, wird `Anonym` gespeichert |
| `feedback` | string | ✅ | getrimmt, 1–10.000 Zeichen |

Feedback ist damit auch **anonym** möglich. Für die Idempotenz gelten ein
fehlender Name und ein explizites `"Anonym"` als **derselbe** Request — ein
Retry, der das Feld einmal weglässt und einmal mitsendet, ergibt also einen
Replay (`200`) und keinen Konflikt.

Zeilenenden werden auf `\n` normalisiert; **innere** Absätze bleiben erhalten.
Der Kartentitel entsteht automatisch aus den ersten 120 Zeichen des Feedbacks
(mit `…` gekürzt) — der vollständige Text steht im Kartenfeld „Notizen" und
unverändert in der öffentlichen Statusansicht.

### Beispiel

```bash
curl -X POST "https://gremio.example/api/public/v1/feedback" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{"areaId":1,"submitterName":"Max Mustermann","feedback":"Die Öffnungszeiten sollten verlängert werden."}'
```

Anonym — `submitterName` einfach weglassen:

```bash
curl -X POST "https://gremio.example/api/public/v1/feedback" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{"areaId":1,"feedback":"Die Öffnungszeiten sollten verlängert werden."}'
```

```json
{
  "statusUrl": "https://gremio.example/feedback/status/abc123",
  "receiptPdfUrl": "https://gremio.example/feedback/status/abc123/pdf",
  "number": "F_0042_2026"
}
```

`number` ist `null`, wenn die Board-Nummerierung deaktiviert ist. Die Antwort
enthält bewusst **nichts Internes**: keine Karten-ID, kein Board, keine Spalte,
keine Notizen.

> **Eigene Statusrouten:** Feedback nutzt `/feedback/status/{token}` — die
> Antragsroute `/status/{token}` liefert für einen Feedback-Token `404` (und
> umgekehrt). Beide Seiten zeigen unterschiedliche Dinge; eine Verwechslung
> würde Feedback als Antrag darstellen.

### Statuscodes

| Code | Bedeutung |
|------|-----------|
| `201` | Feedback neu angelegt |
| `200` | Idempotenz-Replay (Header `Idempotency-Replayed: true`) |
| `400` | Ungültige oder unbekannte Felder, fehlender/ungültiger `Idempotency-Key` |
| `404` | Bereich nicht verfügbar |
| `409` | `Idempotency-Key` mit anderen Daten wiederverwendet |
| `413` | Body größer als 32 KiB |
| `415` | Content-Type ist nicht `application/json` |
| `429` | Rate-Limit (siehe unten) |
| `500` | Unerwarteter interner Fehler (generische Meldung) |

---

## `POST /api/public/v1/status`

Liefert den aktuellen Stand eines Antrags oder Feedbacks anhand des
Status-Links. **Keine Anmeldung, kein API-Token, kein `Idempotency-Key`** — der
Endpunkt ist ausschließlich lesend.

### Warum POST für einen lesenden Abruf?

Der Status-Link ist ein Geheimnis. Als Query-Parameter (`?statusUrl=…`) landete
er in Browser-Historien, Proxy- und Access-Logs, Monitoring-URLs und
Referrer-Headern. Im JSON-Body bleibt er davon verschont.

Der Aufruf **verändert nichts**: keine Karte, kein Zeitstempel, keine Aktivität,
keine Datei. Er ist beliebig oft wiederholbar.

### Unterstützte Links

| Form | Typ |
|------|-----|
| `{APP_BASE_URL}/status/{token}` | Antrag |
| `{APP_BASE_URL}/feedback/status/{token}` | Feedback |

**Nicht unterstützt** (ergibt `400`): Ausleih-/Inventarstatus
(`/inventar/status/…`), PDF-Links, Attachment- und Stream-URLs, interne
Kartenlinks, fremde Hosts, Links mit Query-Parametern, Fragment oder
Zugangsdaten.

Der Server ruft den übergebenen Link **niemals** ab. Er wird nur lokal geparst,
strukturell gegen `APP_BASE_URL` geprüft und dann als Token gegen die eigene
Datenbank verwendet.

### Anfrage

```bash
curl -X POST "https://gremio.example/api/public/v1/status" \
  -H "Content-Type: application/json" \
  -d '{"statusUrl":"https://gremio.example/status/abc123"}'
```

Nur `application/json`, Body maximal 8 KiB, nur das Feld `statusUrl`.

### Antwort — Antrag

```json
{
  "type": "application",
  "statusUrl": "https://gremio.example/status/abc123",
  "receiptPdfUrl": "https://gremio.example/status/abc123/pdf",
  "number": "A_0042_2026",
  "submittedAt": "2026-08-04T10:15:00.000Z",
  "updatedAt": "2026-08-05T08:30:00.000Z",
  "application": {
    "title": "Grillabend am FB5",
    "applicant": "Max Mustermann"
  },
  "status": {
    "name": "In Bearbeitung",
    "resubmittedAt": null,
    "archived": false
  },
  "publicNote": "Bitte reiche noch eine Quittung nach.",
  "documents": [
    {
      "kind": "finance_request",
      "label": "Finanzantrag",
      "filename": "Finanzantrag.pdf",
      "mimeType": "application/pdf",
      "downloadUrl": "https://gremio.example/api/status/abc123/attachment/12"
    }
  ],
  "availableActions": {
    "canUploadDocuments": true,
    "submitMode": "receipt"
  }
}
```

`availableActions` spiegelt, was die Webansicht gerade anbietet:
`submitMode` ist `resubmission` (Nachreichung), `receipt` (Quittung) oder
`null` (kein Einreichen-Knopf). Bei archivierten Anträgen ist
`canUploadDocuments` `false` und `submitMode` `null`. Die Aktionen selbst laufen
über die Weboberfläche — dieser Endpunkt stellt nur den Status bereit.

### Antwort — Feedback

```json
{
  "type": "feedback",
  "statusUrl": "https://gremio.example/feedback/status/xyz789",
  "receiptPdfUrl": "https://gremio.example/feedback/status/xyz789/pdf",
  "number": "F_0042_2026",
  "submittedAt": "2026-08-04T10:15:00.000Z",
  "updatedAt": "2026-08-05T08:30:00.000Z",
  "feedback": {
    "area": "Bibliothek",
    "submitterName": "Max Mustermann",
    "text": "Die Öffnungszeiten sollten verlängert werden."
  },
  "status": { "name": "In Bearbeitung" },
  "publicNote": null,
  "documents": [],
  "availableActions": { "canUploadDocuments": false, "submitMode": null }
}
```

Bereich, Name und Text stammen aus dem **Snapshot** der Einreichung — bearbeitet
das Gremium intern, ändert sich die Antwort nicht. Feedback hat keine Anhänge
und keine öffentlichen Aktionen.

### Was NICHT ausgegeben wird

Karten-, Board- und Status-IDs, Positionen, interne Notizen, Kommentare,
Aktivitätsverlauf, Zuweisungen, Prioritäten, Dateisystem- oder Nextcloud-Pfade,
der hochladende interne Nutzer — und der **Studierendenausweis**, weder als
Eintrag noch als Download-Link.

Der Token erscheint nicht als eigenes Feld; er steckt bereits in `statusUrl`.

### Fehler

| Code | Bedeutung |
|------|-----------|
| `400` | Fehlender oder ungültiger Link, fremder Origin, nicht unterstützter Pfad, ungültiges JSON, unbekanntes Feld |
| `404` | Vorgang nicht gefunden |
| `413` | Body größer als 8 KiB |
| `415` | Content-Type ist nicht `application/json` |
| `429` | Rate-Limit — `Retry-After` beachten |
| `500` | Unerwarteter interner Fehler (generische Meldung) |

`404` ist bewusst **identisch** für unbekannten Token, gelöschten Vorgang und
Token des falschen Typs (Feedback-Token auf dem Antragspfad und umgekehrt).
Fehlermeldungen enthalten weder Token noch Link.

### Polling

Die App darf regelmäßig abfragen — das Limit von 600 Anfragen pro IP und Minute
ist dafür ausgelegt. Bei `429` den Header `Retry-After` beachten. Antworten
tragen `Cache-Control: no-store` und `Referrer-Policy: no-referrer` und dürfen
nicht zwischengespeichert werden.

---

## Idempotenz — so muss die App es machen

Mobile Netze brechen Verbindungen ab. Ohne Idempotenz entstünde bei jedem Retry
ein **weiterer Antrag** bzw. ein weiteres Feedback. Deshalb ist der Header bei
`POST /applications` **und** `POST /feedback` Pflicht. Beide nutzen dieselbe
Mechanik, aber **getrennte Scopes** (`public-application` bzw. `public-feedback`)
— derselbe Key kann also einmal für einen Antrag und einmal für ein Feedback
verwendet werden, ohne zu kollidieren.

> `POST /status` braucht **keinen** `Idempotency-Key`: Der Endpunkt ist rein
> lesend und legt nichts an. Er ist beliebig oft wiederholbar.

1. Für einen neuen Entwurf **eine UUID** als `Idempotency-Key` erzeugen.
2. Key und Entwurf **lokal auf dem Gerät speichern**.
3. Antrag absenden.
4. Bei **Timeout oder Netzwerkfehler denselben Key und dieselben Daten** erneut
   senden.
5. **Erst nach erfolgreicher Antwort** den Status-Link speichern und den lokalen
   Entwurf als abgeschlossen markieren.
6. Für einen wirklich neuen Antrag bzw. ein neues Feedback einen **neuen** Key
   erzeugen.
7. **Niemals** denselben Key für unterschiedliche Einreichungen verwenden.

### Verhalten im Detail

| Fall | Ergebnis |
|------|----------|
| Neuer Key | Antrag wird angelegt → `201` |
| Bekannter Key, **identische** Daten | Nichts wird erneut angelegt → `200` + `Idempotency-Replayed: true`, dieselbe `statusUrl`/`receiptPdfUrl`/`number` |
| Bekannter Key, **veränderte** Daten | `409 Conflict` |

Ein Replay legt **keine** zweite Karte an, speichert **keine** Dateien erneut,
schreibt **keinen** weiteren Aktivitätseintrag und verbraucht **keine** weitere
Antragsnummer.

Zwei wirklich parallele Requests mit demselben Key erzeugen genau **eine** Karte
(serialisiert über einen PostgreSQL-Transaktions-Advisory-Lock).

Nach einem fehlgeschlagenen und vollständig zurückgerollten Request ist derselbe
Key **weiterhin verwendbar** — es bleibt kein blockierender Datensatz zurück.

### Aufbewahrungsfrist: 30 Tage

Ein Idempotenz-Datensatz wird **30 Tage** nach seiner Anlage automatisch
entfernt. Danach verhält sich derselbe Key wie ein neuer: Ein Retry **nach**
Ablauf der Frist legt eine **zweite** Einreichung an und liefert `201` statt
`200`. Für den vorgesehenen Zweck — Wiederholung nach Timeout, Netzabbruch oder
Offline-Phase — ist die Frist mehr als ausreichend; ein Client sollte einen
Entwurf ohnehin nicht wochenlang unabgeschlossen liegen lassen.

Der Wert ist absichtlich endlich: Ohne Frist wüchse die Schlüsseltabelle
unbegrenzt mit.

### Was zählt als „identisch"?

Verglichen wird ein kanonischer SHA-256-Fingerprint aus den **geprüften** Werten
— also genau denen, die in der Karte landen (bereinigt und getrimmt):

* `locationId`, `title`, `applicant`,
* Vorhandensein jedes der vier Datei-Slots,
* serverseitig ermitteltem MIME-Typ und **Inhalts-Hash** jeder vorhandenen Datei.

Bewusst **nicht** enthalten sind Dateiname, Multipart-Boundary und Feld-
reihenfolge. Ein logisch identischer Retry ergibt also denselben Fingerprint,
auch wenn der HTTP-Client die Multipart-Kodierung anders zusammensetzt.

---

## Rate-Limits

Bewusst großzügig, weil native Geräte hinter gemeinsam genutzten
Mobilfunk-/Carrier-NAT-Adressen erscheinen (viele Nutzer teilen sich eine IP).

| Endpunkt | Grenze |
|----------|--------|
| `POST /applications` (Burst) | 60 pro IP und Minute |
| `POST /applications` (Backstop) | 500 pro IP und Stunde |
| `GET /locations` | 300 pro IP und Minute |
| `POST /feedback` (Burst) | 100 pro IP und Minute |
| `POST /feedback` (Backstop) | 500 pro IP und Stunde |
| `GET /feedback-areas` | 300 pro IP und Minute |
| `POST /status` | 600 pro IP und Minute (kein Tageslimit) |

Anträge und Feedback haben **eigene Buckets**: Ein Ansturm auf die
Feedback-API verbraucht nichts vom Kontingent der Antrags-API und umgekehrt.

Burst und Backstop haben **getrennte Buckets** — ein Treffer des einen ersetzt
den anderen nicht. Bei Überschreitung: `429` als JSON mit `Retry-After`.

Die API-Limits sind **vollständig getrennt** vom Limit des Browserformulars: Ein
Treffer hier lässt das Formular unberührt und umgekehrt. Idempotenz ersetzt das
Rate-Limit nicht.

IP-Adressen werden nicht im Klartext gespeichert, sondern nur als HMAC
pseudonymisiert (siehe `lib/rate-limit.ts`).

---

## Sicherheit des Status-Links

`statusUrl` ist ein **geheimer öffentlicher Bearer-Link**: Wer ihn hat, sieht die
öffentliche Statusansicht des Antrags. Er nutzt denselben kryptografisch
zufälligen 30-stelligen Token wie das Browserformular — es gibt keinen
zusätzlichen, schwächeren API-Token.

Für die App bedeutet das:

* Den Link **lokal und vertraulich** speichern.
* **Nicht loggen**, nicht in Absturzberichte oder Analytics geben, nicht teilen.
* Er ist der **einzige** Zugang zum Antrag — er wird nicht per E-Mail verschickt
  und kann nicht wiederhergestellt werden.

Öffentlich abrufbar sind über den Token nur Finanzantrag, Anlage A/B und
nachgereichte Dateien. Der **Studierendenausweis bleibt intern** und wird über
keine token-basierte Route ausgeliefert.

Beim **Feedback** gilt dasselbe für den Link. Die Feedback-Statusseite zeigt den
**Snapshot der Einreichung** (`feedback_submissions`), nicht die womöglich
später intern bearbeiteten Kartendaten — interne Notizen werden dadurch nicht
versehentlich öffentlich. Ausnahme ist `applicantNote`, der bewusst öffentliche
Hinweis des Gremiums.

---

## Betrieb

Bei großen Uploads muss der Reverse-Proxy mitspielen. Die Beispielkonfiguration
[`deploy/nginx.conf.example`](../deploy/nginx.conf.example) setzt
`client_max_body_size 105m` (4 × 25 MB + Overhead) — dieselbe Grenze gilt für
diese API. Ohne passende Einstellung antwortet **nginx** mit `413`, bevor die
Anwendung den Request überhaupt sieht. Für `POST /feedback` (reines JSON, 32 KiB)
spielt das keine Rolle.

**Migrationen:** Die Feedback-Tabellen kommen mit Migration `0054`; sie wird beim
Containerstart automatisch angewendet und ist rein additiv.
