# Gremio — Öffentliche API (`/api/public/v1`)

Öffentliche, **nicht authentifizierte** API zum Einreichen von Anträgen. Sie ist
für **direkte native Android-/iOS-Clients** gedacht: kein zwischengeschalteter
Backend-Server, kein API-Token.

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

Druckbares ASCII, 16–128 Zeichen; empfohlen ist eine **UUID v4**. Fehlt der
Header oder ist er ungültig → `400`. Gespeichert wird nur ein SHA-256-Hash, nie
der Klartext.

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

## Idempotenz — so muss die App es machen

Mobile Netze brechen Verbindungen ab. Ohne Idempotenz entstünde bei jedem Retry
ein **weiterer Antrag**. Deshalb ist der Header Pflicht.

1. Für einen neuen Antragsentwurf **eine UUID** als `Idempotency-Key` erzeugen.
2. Key und Entwurf **lokal auf dem Gerät speichern**.
3. Antrag absenden.
4. Bei **Timeout oder Netzwerkfehler denselben Key und dieselben Daten** erneut
   senden.
5. **Erst nach erfolgreicher Antwort** den Status-Link speichern und den lokalen
   Entwurf als abgeschlossen markieren.
6. Für einen wirklich neuen Antrag einen **neuen** Key erzeugen.
7. **Niemals** denselben Key für unterschiedliche Anträge verwenden.

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

### Was zählt als „identisch"?

Verglichen wird ein kanonischer SHA-256-Fingerprint aus:

* normalisierter `locationId`, `title`, `applicant`,
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
| `POST /applications` (Backstop) | 5.000 pro IP und 24 Stunden |
| `GET /locations` | 300 pro IP und Minute |

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

---

## Betrieb

Bei großen Uploads muss der Reverse-Proxy mitspielen. Die Beispielkonfiguration
[`deploy/nginx.conf.example`](../deploy/nginx.conf.example) setzt
`client_max_body_size 105m` (4 × 25 MB + Overhead) — dieselbe Grenze gilt für
diese API. Ohne passende Einstellung antwortet **nginx** mit `413`, bevor die
Anwendung den Request überhaupt sieht.
