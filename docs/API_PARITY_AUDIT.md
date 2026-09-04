# API-Abgleich seit v2.7.7

Stand: 4. September 2026. Geprüft wurden `v2.7.7..HEAD` sowie die vorhandenen,
noch nicht veröffentlichten Änderungen (Haushaltspositionen, öffentliche Uploads,
PDF-Kompatibilität). Dies ist keine neue Versionsfreigabe.

Der beauftragte Umfang bleibt die bestehende REST-API: Boards/Karten mit
persönlichen Tokens und öffentliche Anträge/Feedback. Nicht jede Webfunktion
wird dadurch zu einer externen API.

## Ergebnis nach Funktionsbereich

| App-Änderung / Vertrag | API-Abdeckung und Ergebnis |
| --- | --- |
| v2.7.8: Erklärung zur Standortauswahl | Reine Formularanzeige; Standortliste und Routing verwenden unverändert dieselben fachlichen Grundlagen. Kein neuer API-Parameter nötig. |
| v2.7.9: Kartenfelder für Mitglieder | Aktivierte Nummer/Anweisungsdatum/Überweisungsdatum bereits schreibbar. Veraltete Eigentümer/Admin-Beschränkungen in OpenAPI und Fachkonzept korrigiert. |
| Mehrere Haushaltstitel/Konten je Karte | `budgetMode`, `budgetRevision`, Detailpositionen und PATCH vorhanden. POST um atomare Anlage inklusive Positionen ergänzt; Einzelkarten-Anlage bleibt kompatibel. |
| Positionsdaten und Summen | Gemeinsamer Writer mit UI: Reihenfolge, stabile UUIDs, Konto-Pflicht, Cent-/Summenlimits, `null` vs. `0`, sichtbare Werte bereits beim ersten Wechsel editierbar, ausgeblendete Werte geschützt. Fremde Positions-IDs werden als Eingabefehler abgewiesen. |
| Parallele Budgetänderungen | PATCH verlangt die zuletzt gelesene Revision. Karte, Summen, Revision und Detailpositionen werden bei GET/POST/PATCH aus demselben lesenden DB-Snapshot ausgegeben. Fehler hinterlassen keine teilweise Budgetänderung. |
| Zuständige und persönliche Kartenliste | Fehler korrigiert: Ein PATCH nur mit `assigneeUserIds` wurde als leer behandelt. Setzen und vollständiges Entfernen mit `[]` wirken jetzt auch ohne weitere Felder. |
| Mehrere Archiv-/Quittungsspalten | `isArchiveTrigger` bereits vollständig pro Spalte. `isReceiptTrigger`, der fehlende `isTransferTrigger` und Board-Ziele `receiptToStatusId`/`resubmitStatusId` ergänzt; Einstellungen nur für Eigentümer/Admins sichtbar. |
| Spaltenwechsel | Bestehende gemeinsamen Helfer setzen Anweisungs-/Überweisungsdatum, stoßen Archivierung an und aktualisieren Nachreichungsmarkierung sowie Done-Frist. |
| Öffentlicher Antragsstatus | Genehmigte Gesamtsumme und unabhängige `canResubmit`/`canReceipt` bereits angebunden. Schema-Pflichtfelder und Beispiele nachgezogen. Archiv-Sperre und gültige Quittungs-Zielspalte bleiben maßgeblich. |
| Öffentliche Einreichung / Feedback | Keine neue Eingabe erforderlich. Routing, Idempotenz, Token-Typtrennung und Limits bleiben bestehen; Feedback hat weiterhin weder Upload-Aktionen noch Budgetdaten. |
| Ungültige IDs / Filter | Pfad-IDs außerhalb positiver int32-Werte ergeben 404; ungültige Status-/Archivfilter 400. Schreib-IDs werden vor DB-Zugriff auf den Wertebereich geprüft. |
| API-Spezifikationen | Getrennte Schreib-/Lese-Positionsschemas, Pflicht-Titel beim POST, aktuelle Berechtigungen und Antwortfelder; beide YAML-Dateien aus den TS-Quellen neu generiert. |

## Bewusste Grenzen

- Protokollbereiche, Nextcloud-Dateien, Logos, Markdown-Editor, Sitzungsdaten und
  PDF-Export/-Bearbeitung bleiben Webfunktionen mit Session-/Bereichsprüfung und
  Server Actions. Die neuen `/api/protokolle/...`-Routen sind keine Erweiterung
  der externen Bearer-API. Die PDF-Kompatibilitätskorrektur wirkt über den
  gemeinsamen PDF-Helfer auch in den vorhandenen sessiongeschützten Feldrouten.
- Datei-Uploads auf Statusseiten und das abschließende Einreichen bleiben
  Webaktionen. Die öffentliche Status-API meldet deren Verfügbarkeit und liefert
  Download-Links, führt diese Aktionen aber nicht selbst aus.
- Board-/Finanz-/Inventarverwaltung erhält keine neuen REST-Schreibendpunkte.
  Karten auf Inventar-Systemboards bleiben über REST nur lesbar.
- Listen liefern Karten mit Gesamtsummen; Positionskonten und einzelne Titel
  stehen in der Detailantwort. Öffentliche Antworten enthalten niemals diese
  internen Zuordnungen. Konto-/Prioritätskataloge bleiben außerhalb des Vertrags;
  die bestehenden Schreibfelder verwenden bekannte IDs.

## Kompatibilität und Betrieb

Keine zusätzliche Migration über die für die App bereits notwendige `0062`
hinaus, keine neue Produktionsabhängigkeit. Der bestehende Namespace `/api/v1`
bleibt erhalten. Bestehende gültige Einzelkarten-Aufrufe funktionieren weiter.
Ungültige Filter, alleinstehende `budgetRevision` und übergroße IDs werden nun
explizit abgewiesen statt ignoriert bzw. an die Datenbank weitergereicht.

Für Positions-PATCHes `position` aus Leseobjekten entfernen und die zuletzt
gelesene `card.budgetRevision` mitsenden. UUIDs nur für dieselbe Position
wiederverwenden. Neue Karten/Positionen benötigen neue UUIDs. Keine vertraulichen
Status-Tokens, Nextcloud-Zugangsdaten oder echten Dokumente in Tests kopieren.

## Regressionen und Pflege

- `tests/api-parity.test.ts`: echte versionierte Route Handler mit isolierten
  DB-Fixtures und Bearer-Tokens; Rechte, Sichtbarkeit, Positionen, Rollbacks,
  Zuständige, Trigger, Filter, Widerruf und Löschen.
- `tests/api-contract.test.ts`: vollständiges Routen-/Methodeninventar beider
  Namespaces, Eingabefelder, Beispiele und Gleichheit der generierten YAML-Dateien.
- `tests/public-budget-workflows-db.test.ts`: gemeinsame Budget-/Workflow-Logik,
  öffentliche Summen/Gates, mehrere Quellen, Archiv-Vorrang und Upload-Quota.
- `tests/browser/workflows-production.cjs`: reale Next-HTTP-/Server-Action-Checks
  gegen eine isolierte Testdatenbank, einschließlich öffentlicher Statusantworten.
- Bestehende Routing-, Idempotenz-, Public-Origin-, Leihkarten- und
  PDF-Kompatibilitätsregressionen bleiben Teil von `npm test`.

Bei künftigen fachlichen Änderungen gemeinsame Helfer, REST-Eingaben/-Ausgaben,
Rechte und beide OpenAPI-Quellen prüfen; anschließend `npm run openapi:yaml` und
die relevanten Tests ausführen. `AGENTS.md` verweist auf diese Pflegepflicht.

### Durchgeführte Prüfung dieses Arbeitsstands

- `npm test`: 162 Tests, davon 161 erfolgreich und 1 übersprungen; keine Fehler.
  Der separate Migrationstest wurde ohne `TEST_MIGRATION_DATABASE_URL` nicht
  erneut ausgeführt. Dieser API-Abgleich verändert keine Migration.
- `npx tsc --noEmit`, `npm run lint`, `git diff --check`: erfolgreich.
- `npm run build`: erfolgreich in einer separaten temporären Projektkopie,
  ohne den `.next`-Ordner des laufenden Entwicklungsservers zu verwenden.
- `workflows-production.cjs`: erfolgreich am separat gestarteten Next-Server
  mit realen HTTP-Aufrufen, Browser, lokaler Dateispeicherung und isolierter DB.

Keine Produktion, echte Nextcloud-Archivierung oder externes OIDC-System wurde
für diese Tests angesprochen. Keine zusätzlichen Abhängigkeiten, Commits oder
Veröffentlichungen im Rahmen des Abgleichs.
